import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * E2E coverage for plain-English decoding of public CMS/NUBC code sets
 * (docs/BUILD_QUEUE.md Build 2.2): the real, sandboxed renderer actually
 * shows a decoded value alongside its raw code, and copying a decoded row
 * still emits the RAW code only — not the pure formatter/decoder unit
 * tests (test/decode.test.ts), the real inspector.ts DOM. Drives
 * dist/electron/main.js exactly like e2e/copy.spec.ts / e2e/app.spec.ts —
 * see those files' header comments for why (profile isolation, the
 * CLAIM_VIEWER_E2E_OPEN seam, clipboard read-back working against this
 * Electron build with no permission handler registered).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
// Institutional (UB-04) fixture with real, decodable codes: CLM05 "14:A:1"
// (type of bill), CL1 patient status "01", condition code "09" (HI*BG:09),
// and revenue codes 0305/0730 on its two service lines (see
// test/fixtures/x12/837I-minimal.dat).
const FIXTURE_837I_MINIMAL = join(repoRoot, 'test', 'fixtures', 'x12', '837I-minimal.dat');

function requireBuiltApp(): void {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`Built app not found at "${MAIN_ENTRY}". Run "npm run build" before the e2e suite (npm run verify does this for you).`);
  }
}

function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Expands an inspector `<details class="inspGroup">` group by setting
 * `.open` directly, rather than clicking its `<summary>` — the service-lines
 * group's summary also hosts the "Copy service lines as TSV" button
 * (inspector.ts's buildLinesCopyBtn), and a real click's coordinates landing
 * anywhere near it would trigger a clipboard copy as a side effect of just
 * trying to open the group. Setting `.open` is what the disclosure widget's
 * own `toggle` listener (inspector.ts) reacts to either way.
 */
async function expandGroup(group: import('@playwright/test').Locator): Promise<void> {
  await group.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
    el.dispatchEvent(new Event('toggle'));
  });
}

/** Profile isolation (docs/TABS_BUILD_PLAN.md §2e / guardrail §1.9) — mirrors e2e/app.spec.ts's launchApp(); see that file's header comment for the full rationale. */
async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-'));
  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
      env: { ...definedEnv(process.env), ...env },
    });
  } catch (err) {
    rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }
  const originalClose = app.close.bind(app);
  app.close = async () => {
    try {
      await originalClose();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  };
  return app;
}

test.describe('837 Claim Viewer — E2E — plain-English code decoding (docs/BUILD_QUEUE.md Build 2.2)', () => {
  test('a CMS-1500 service line shows the raw place-of-service code alongside its decoded label', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Service lines group — synthetic-1500.json's lines both carry POS
      // "11" (.first() sidesteps the strict-mode ambiguity of two matching rows).
      const linesGroup = page.locator('details[data-group-id="lines"]');
      await expandGroup(linesGroup);
      const line1Row = linesGroup.locator('.inspRow', { hasText: 'pos 11' }).first();
      await expect(line1Row).toBeVisible();

      // Raw code stays visible verbatim...
      await expect(line1Row.locator('.inspRowValRaw')).toContainText('pos 11');
      // ...with the decoded label rendered as a distinct sibling, never
      // replacing it.
      await expect(line1Row.locator('.inspRowValDecoded')).toContainText('Office');
    } finally {
      await app.close();
    }
  });

  test('an institutional claim decodes type of bill, discharge status, condition codes, and revenue codes — raw value always shown first', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MINIMAL });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // "Billing details" group only exists for institutional claims
      // (docs/BUILD_QUEUE.md Build 2.2 — inspector.ts's renderInspector).
      const billingGroup = page.locator('details[data-group-id="billing"]');
      await expect(billingGroup).toBeAttached();
      await expandGroup(billingGroup);

      // Discharge status: CL1*3**01 -> patientStatus "01".
      const statusRow = billingGroup.locator('.inspRow', { hasText: 'Discharge status' });
      await expect(statusRow.locator('.inspRowValRaw')).toHaveText('01');
      await expect(statusRow.locator('.inspRowValDecoded')).toContainText('Discharged to home or self-care');

      // Type of bill: CLM05 "14:A:1" -> facility "1" (Hospital), classification "4" (Other, Part B), frequency "1".
      const facilityRow = billingGroup.locator('.inspRow', { hasText: 'Facility type' });
      await expect(facilityRow.locator('.inspRowValRaw')).toHaveText('1');
      await expect(facilityRow.locator('.inspRowValDecoded')).toContainText('Hospital');

      // Condition code: HI*BG:09 -> "09".
      const conditionRow = billingGroup.locator('.inspRow', { hasText: 'Condition code' });
      await expect(conditionRow.locator('.inspRowValRaw')).toHaveText('09');
      await expect(conditionRow.locator('.inspRowValDecoded')).toContainText('Neither patient nor spouse employed');

      // Revenue codes on the service lines: SV2*0305 (Laboratory — hematology).
      const linesGroup = page.locator('details[data-group-id="lines"]');
      await expandGroup(linesGroup);
      const revRow = linesGroup.locator('.inspRow', { hasText: 'rev 0305' });
      await expect(revRow.locator('.inspRowValRaw')).toContainText('rev 0305');
      await expect(revRow.locator('.inspRowValDecoded')).toContainText('Laboratory');
    } finally {
      await app.close();
    }
  });

  test('copying a decoded field row (click and Ctrl+C) yields the RAW code, never the decoded text', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MINIMAL });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const billingGroup = page.locator('details[data-group-id="billing"]');
      await expandGroup(billingGroup);
      const statusRow = billingGroup.locator('.inspRow', { hasText: 'Discharge status' });
      // Sanity: the decoded text really is on screen before proving copy skips it.
      await expect(statusRow.locator('.inspRowValDecoded')).toContainText('Discharged to home or self-care');

      // Click-to-copy (the hover/focus icon button).
      await statusRow.locator('.rowCopyBtn').click();
      const viaClick = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(viaClick).toBe('01');
      expect(viaClick).not.toContain('Discharged');

      // Keyboard path: focus the row (roving tabindex) and press Ctrl+C.
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await statusRow.focus();
      await page.keyboard.press('Control+c');
      const viaKeyboard = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(viaKeyboard).toBe('01');
      expect(viaKeyboard).not.toContain('Discharged');
    } finally {
      await app.close();
    }
  });

  test('a code with no decoding shows the raw value alone, never the word "Unknown"', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MINIMAL });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const billingGroup = page.locator('details[data-group-id="billing"]');
      await expandGroup(billingGroup);

      // NOTE: this used to assert that the fixture's occurrence codes
      // (HI*BH:A1/A2/B1/B2) rendered with NO decoded sibling, on the premise
      // that they were payer-specific extensions outside the table. They are
      // not — they are the standard NUBC insured-designation codes, so
      // completing the table per src/data/occurrenceCodes.ts's own refresh
      // instructions turned this red (docs/AUDIT_BUILD2.md). Anchoring on
      // "this code is absent from a table we intend to grow" is brittle by
      // construction. The durable invariant is the one the spec actually
      // states, so that is what is asserted now.
      const occurrenceRow = billingGroup.locator('.inspRow', { hasText: 'Occurrence 1' });
      await expect(occurrenceRow).toBeVisible();

      // A code the table DOES cover renders its decode alongside the raw value.
      await expect(occurrenceRow.locator('.inspRowValDecoded')).toHaveCount(1);
      await expect(occurrenceRow).toContainText('A1');

      // The invariant that can never go stale: no row anywhere in the
      // inspector ever renders the word "Unknown" for a code, no matter how
      // the tables grow (docs/UI_REQUIREMENTS_v3_queued_features.md §2 —
      // "where no decoding exists, show the raw value alone").
      const inspectorText = (await page.locator('#inspectorBody').textContent()) ?? '';
      expect(inspectorText).not.toContain('Unknown');
    } finally {
      await app.close();
    }
  });

  test('decoded text renders in full — never truncated by character count', async () => {
    // Build 2 sliced decoded text at 64 chars before putting it in the DOM.
    // That did not shorten long labels so much as MERGE them: discharge
    // status 05 and 85 differ only by a trailing ", with planned
    // readmission" and rendered byte-identically, and a service line's
    // joined POS + revenue + modifier decodes silently lost its trailing
    // modifiers. The full text was reachable only by hovering for the
    // tooltip (docs/AUDIT_BUILD2.md).
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MINIMAL });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Expand every group so all decoded rows are in play, not just the
      // handful that happen to render open by default.
      const groups = page.locator('#inspectorBody details');
      const groupCount = await groups.count();
      for (let i = 0; i < groupCount; i += 1) await expandGroup(groups.nth(i));

      const decoded = page.locator('.inspRowValDecoded');
      const count = await decoded.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        const el = decoded.nth(i);
        const shown = (await el.textContent()) ?? '';
        // `title` carries the untruncated decode, so it is the oracle for
        // what the DOM text must equal.
        const full = (await el.getAttribute('title')) ?? '';
        expect(full).not.toBe('');
        expect(shown).toBe(`· ${full}`);
        expect(shown).not.toContain('…');
      }
    } finally {
      await app.close();
    }
  });
});
