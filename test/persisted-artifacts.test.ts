import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadClaims, renderClaim } from '../src/app/claimService.js';
import { addRecentFile, loadSession, saveOpenTabs } from '../src/app/persistence/sessionStore.js';
import { setFieldOverride, getArtifact } from '../src/app/persistence/correctedClaimStore.js';

/**
 * Verification for every `userData` writer (docs/BUILD_QUEUE.md rule 12).
 * `ALLOWED_USERDATA_FILES` below is the SINGLE allowlist a build may only
 * APPEND to — never delete or weaken an existing predicate. Build 1
 * (docs/TABS_BUILD_PLAN.md §2e, session restore + recent files) adds
 * exactly one file: `session.json`, written by the Electron-free
 * `src/app/persistence/sessionStore.ts` module.
 *
 * `test/phi-at-rest.test.ts` stays unchanged (per rule 12 and
 * TABS_BUILD_PLAN.md §2e/§3): it imports only `src/app/claimService.js` and
 * spies on in-process fs write primitives, so it structurally cannot
 * observe a `userData` write and covers a different guarantee (claimService
 * itself never touches disk). This file is the one that actually drives a
 * `userData` write and inspects what landed on disk.
 *
 * electron/main.ts can't be imported directly under vitest (it imports the
 * `electron` package at module scope — see test/no-updater.test.ts's header
 * for the same constraint on other main-process-adjacent tests), so this
 * test drives the exact same Electron-free primitives electron/main.ts's
 * IPC handlers call — claimService for open/export, sessionStore for the
 * userData write — directly, against a throwaway temp directory standing in
 * for `app.getPath('userData')`.
 *
 * Uses the same PHI canary constants as test/phi-at-rest.test.ts so a future
 * userData writer that starts serializing claim CONTENT (not just paths)
 * fails this test immediately.
 */

// Synthetic SSN: area number 919 falls in the 900-999 block the SSA has
// never issued — shaped like a real SSN without being one. See
// test/phi-at-rest.test.ts for the same constants/reasoning.
const SSN_CANARY_DIGITS = '919001234';
const SSN_CANARY_DASHED = '919-00-1234';
const NAME_CANARY = 'CanaryPhiTestPatient';

function syntheticClaimJson(): string {
  return JSON.stringify({
    claimid: 'phi-canary-1',
    claim_form: '1500',
    pat_name_l: NAME_CANARY,
    pat_name_f: 'Synthetic',
    pat_dob: '1990-01-01',
    pat_sex: 'M',
    bill_name: 'CANARY TEST CLINIC',
    bill_npi: '1234567893',
    bill_taxid: SSN_CANARY_DIGITS,
    bill_taxid_type: 'S',
    narrative: `SSN on file: ${SSN_CANARY_DASHED}`,
    total_charge: '100.00',
    amount_paid: '0.00',
    charge: [{ proc_code: '99213', charge: '100.00', diag_ref: 'A', units: '1' }],
    diag_1: 'A001',
  });
}

function noCanary(text: string): boolean {
  return !text.includes(SSN_CANARY_DIGITS) && !text.includes(SSN_CANARY_DASHED) && !text.includes(NAME_CANARY);
}

/**
 * Filename -> predicate over that file's raw on-disk text. A build may only
 * APPEND a row here (docs/BUILD_QUEUE.md rule 12). `session.json` is the
 * only file Build 1 adds: `{ tabs, activeIndex, recentFiles }`, every entry
 * a `{ filePath, fileName }` pair — never a field parsed from claim content.
 *
 * docs/UI_REQUIREMENTS_v3_queued_features.md §9 (Build 2.0, UI text scale)
 * adds one field to this SAME file rather than a new userData file —
 * `uiScale`, one of 100/125/150/175, optional (absent until the user ever
 * cycles it). The predicate below is strengthened accordingly (rule 12: a
 * build may only append/strengthen, never weaken, this allowlist) — it now
 * also rejects a present-but-invalid `uiScale`, while still accepting a
 * session.json that never set one.
 *
 * The editable-fields build (docs/EDITABLE_FIELDS_DESIGN.md) APPENDS one
 * more row: corrected-claims.json, written by the new Electron-free
 * src/app/persistence/correctedClaimStore.ts module -- the ONLY new
 * userData writer this build adds, per docs/BUILD_QUEUE.md rule 12. Its
 * predicate requires the exact shape that module produces: schemaVersion 1,
 * an `artifacts` map keyed by source file path, each artifact carrying
 * schemaVersion/sourceFilePath/sourceFileHash/createdAt/updatedAt plus a
 * fieldOverrides map whose values are always plain strings -- never a
 * nested object, since this store only ever persists the flat field values
 * the user typed.
 */
export const ALLOWED_USERDATA_FILES: Record<string, (content: string) => boolean> = {
  'session.json': (content) => {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj['tabs']) || !Array.isArray(obj['recentFiles']) || typeof obj['activeIndex'] !== 'number') return false;
    const uiScale = obj['uiScale'];
    return uiScale === undefined || (typeof uiScale === 'number' && [100, 125, 150, 175].includes(uiScale));
  },
  'corrected-claims.json': (content) => {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const obj = parsed as Record<string, unknown>;
    if (obj['schemaVersion'] !== 1 || typeof obj['artifacts'] !== 'object' || obj['artifacts'] === null) return false;
    return Object.values(obj['artifacts'] as Record<string, unknown>).every((artifact) => {
      if (typeof artifact !== 'object' || artifact === null) return false;
      const a = artifact as Record<string, unknown>;
      if (
        a['schemaVersion'] !== 1 ||
        typeof a['sourceFilePath'] !== 'string' ||
        typeof a['sourceFileHash'] !== 'string' ||
        typeof a['createdAt'] !== 'string' ||
        typeof a['updatedAt'] !== 'string' ||
        typeof a['fieldOverrides'] !== 'object' ||
        a['fieldOverrides'] === null
      ) {
        return false;
      }
      return Object.values(a['fieldOverrides'] as Record<string, unknown>).every((v) => typeof v === 'string');
    });
  },
};

describe('Persisted userData artifacts (docs/BUILD_QUEUE.md rule 12)', () => {
  it('open -> export -> close: only allowlisted files land in userData, none contain the PHI canary, and session.json proves the feature actually recorded the fixture path', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-test-'));
    try {
      // A path that stands in for a real on-disk claim file — never
      // actually written to disk here; sessionStore only ever stores the
      // string, and claimService (below) never looks at the filesystem at
      // all (see test/phi-at-rest.test.ts).
      const fixturePath = join(userDataDir, '..', 'phi-canary-fixture-source', 'phi-canary-fixture.json');
      const fixtureRef = { filePath: fixturePath, fileName: 'phi-canary-fixture.json' };

      // --- "Open": parse (Electron-free, exactly what electron/main.ts's
      // openClaimAtPath does) + the userData writes main's dialog:openClaim
      // handler performs alongside it (session tabs + recent files).
      const { claims } = loadClaims(syntheticClaimJson());
      const claim = claims[0]!;
      expect(claim.billingProvider.taxId).toBe(SSN_CANARY_DIGITS); // sanity: canary actually made it into the model

      await saveOpenTabs(userDataDir, [fixtureRef], 0);
      await addRecentFile(userDataDir, fixtureRef);

      // --- "Export": rendered PDF bytes. Real exports go to a user-chosen
      // path OUTSIDE userData entirely (Build 4.3 remains the only build
      // that writes claim content to a user-chosen, non-userData path; the
      // editable-fields build below is a narrower, deliberate exception --
      // see that describe block -- confined to the fields a user explicitly
      // edited, inside userData, never the source path) -- this step must
      // leave userDataDir untouched; it's exercised here only to prove the
      // full open->export cycle doesn't smuggle anything into userData
      // along the way.
      const pdfBytes = await renderClaim(claim);
      expect(pdfBytes.length).toBeGreaterThan(0);

      // --- "Close": the tab list goes back to empty — same
      // saveOpenTabs() call src/renderer/main.ts's persistSession() drives
      // via the session:save IPC after a tab closes. recentFiles (already
      // written above) is untouched by this call.
      await saveOpenTabs(userDataDir, [], -1);

      // --- Assertions ---------------------------------------------------
      const entries = readdirSync(userDataDir);
      expect(entries.length).toBeGreaterThan(0); // sanity: something was actually written
      for (const entry of entries) {
        expect(Object.keys(ALLOWED_USERDATA_FILES)).toContain(entry);
      }

      for (const [name, predicate] of Object.entries(ALLOWED_USERDATA_FILES)) {
        if (!entries.includes(name)) continue;
        const content = readFileSync(join(userDataDir, name), 'utf8');
        expect(noCanary(content)).toBe(true);
        expect(predicate(content)).toBe(true);
      }

      // Proves the feature actually ran, not merely that nothing leaked:
      // the recent-files entry (added before the tab list was cleared on
      // "close") must still name the fixture's path.
      const session = await loadSession(userDataDir);
      expect(session.tabs).toEqual([]); // cleared by the "close" step
      expect(session.recentFiles).toEqual([fixtureRef]); // survives it
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

describe('Editable fields: corrected-claims.json (docs/EDITABLE_FIELDS_DESIGN.md)', () => {
  it('open -> edit a field -> export -> close: corrected-claims.json is allowlisted, carries no PHI canary, and records the actual edit (proving the feature works, not just that nothing leaked)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-test-'));
    try {
      const fixturePath = join(userDataDir, '..', 'phi-canary-fixture-source', 'phi-canary-fixture.json');
      const text = syntheticClaimJson();
      const { claims } = loadClaims(text);
      const claim = claims[0]!;

      // The user corrects the (canary) tax ID to a non-canary value. The
      // FIELD KEY the store persists never contains the value itself in any
      // way that could be mistaken for the field name — this asserts the
      // stored artifact literally contains the corrected value the user
      // typed, and nothing else.
      const correctedTaxId = '123456789';
      const sourceHash = 'deadbeef'.repeat(8);
      await setFieldOverride(userDataDir, fixturePath, sourceHash, '0::billingProvider.taxId', correctedTaxId);

      // "Export": unaffected by this build — still only ever writes the
      // rendered PDF to a user-chosen path OUTSIDE userData (not exercised
      // here; see the describe block above). What matters for THIS test is
      // that saving an override never touches anything but
      // corrected-claims.json.
      const pdfBytes = await renderClaim(claim);
      expect(pdfBytes.length).toBeGreaterThan(0);

      // --- Assertions ---------------------------------------------------
      const entries = readdirSync(userDataDir);
      expect(entries).toContain('corrected-claims.json');
      for (const entry of entries) {
        expect(Object.keys(ALLOWED_USERDATA_FILES)).toContain(entry);
      }

      const content = readFileSync(join(userDataDir, 'corrected-claims.json'), 'utf8');
      // No canary anywhere -- and specifically, the ORIGINAL (canary) tax ID
      // that the user just corrected away from must not itself be present.
      expect(noCanary(content)).toBe(true);
      expect(content.includes(SSN_CANARY_DIGITS)).toBe(false);
      expect(ALLOWED_USERDATA_FILES['corrected-claims.json']!(content)).toBe(true);

      const artifact = await getArtifact(userDataDir, fixturePath);
      expect(artifact?.fieldOverrides).toEqual({ '0::billingProvider.taxId': correctedTaxId });
      expect(artifact?.sourceFileHash).toBe(sourceHash);
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
