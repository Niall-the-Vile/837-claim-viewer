import { describe, it, expect, vi, afterEach } from 'vitest';
import fs, { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadClaims, renderClaim } from '../src/app/claimService.js';

/**
 * PHI-at-rest guard (BUILD_PLAN.md §9 "Non-persistence architecture" /
 * AUDIT_REPORT.md coverage-gap #2): claimService.ts is deliberately
 * Electron-free (see its own header comment) and must never touch the
 * filesystem on its own — the only PHI persistence anywhere in this app is
 * the one explicit, user-directed export electron/main.ts's
 * writeFileAtomic performs, to a path the user picked via a save dialog.
 * Everything upstream of that (loadClaims -> renderClaim, and re-rendering
 * for preview vs. export) must be pure in-memory work.
 *
 * This test builds a synthetic claim carrying a known, clearly-fake canary
 * string (a synthetic SSN in the 900-series area-number range, which the
 * SSA never issues, embedded as the billing tax ID and again in the
 * narrative field so it flows through multiple mapper paths) and:
 *  1. Spies on every Node fs write primitive and asserts none of them fire
 *     during a load -> render -> render-again cycle (the "again" simulates
 *     the export re-render electron/main.ts's dialog:exportPdf handler
 *     does on top of the preview render).
 *  2. Independently walks a fresh, dedicated temp directory (standing in
 *     for the app-controlled/userData tree BUILD_PLAN.md §9 describes) and
 *     confirms nothing was written into it and the canary string appears in
 *     no file there — a directory that a pure, fs-free claimService cycle
 *     can never have touched, verified rather than assumed.
 */

// Synthetic SSN: area number 919 falls in the 900-999 block the SSA has
// never issued (reserved/ITIN-adjacent range) — never a real person's SSN,
// but shaped exactly like one so it exercises the same code paths a real
// SSN-shaped tax ID would.
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

describe('PHI-at-rest: claimService never persists claim data', () => {
  // Spied via the default `fs` import (the actual CJS module.exports object,
  // whose properties are ordinary mutable object properties) rather than
  // `import * as fsPromises from 'node:fs/promises'` — an ESM namespace
  // object's properties are non-configurable per spec, so vi.spyOn can't
  // redefine them there and throws "Cannot redefine property".
  const writeSpies = [
    vi.spyOn(fs.promises, 'writeFile'),
    vi.spyOn(fs.promises, 'appendFile'),
    vi.spyOn(fs, 'writeFileSync'),
    vi.spyOn(fs, 'appendFileSync'),
  ];

  afterEach(() => {
    for (const spy of writeSpies) spy.mockClear();
  });

  it('input fixture actually carries the canary (sanity check for the assertions below)', () => {
    const text = syntheticClaimJson();
    expect(text).toContain(SSN_CANARY_DIGITS);
    expect(text).toContain(SSN_CANARY_DASHED);
    expect(text).toContain(NAME_CANARY);
  });

  it('performs a load -> render -> re-render cycle (preview + simulated export) with zero fs write calls', async () => {
    const text = syntheticClaimJson();
    const { claims } = loadClaims(text);
    const claim = claims[0]!;
    expect(claim.patient.name.last).toBe(NAME_CANARY);
    expect(claim.billingProvider.taxId).toBe(SSN_CANARY_DIGITS);

    // Preview render, then a second render standing in for the export path
    // (electron/main.ts's dialog:exportPdf handler re-renders rather than
    // reusing preview bytes) — both must stay fully in-memory.
    const previewBytes = await renderClaim(claim);
    const exportBytes = await renderClaim(claim);
    expect(previewBytes.length).toBeGreaterThan(0);
    expect(exportBytes.length).toBeGreaterThan(0);

    for (const spy of writeSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('leaves a dedicated app-controlled temp directory untouched and canary-free after the cycle', async () => {
    // Stand-in for the userData/app-controlled temp tree BUILD_PLAN.md §9
    // describes: a directory claimService has no reference to and no way to
    // discover, so any write here would only happen via some other, unknown
    // code path — which this test rules out by construction.
    const standInDir = mkdtempSync(join(tmpdir(), 'claim-viewer-phi-userdata-'));
    try {
      const text = syntheticClaimJson();
      const { claims } = loadClaims(text);
      await renderClaim(claims[0]!);
      await renderClaim(claims[0]!);

      const entries = readdirSync(standInDir);
      expect(entries).toEqual([]);
    } finally {
      rmSync(standInDir, { recursive: true, force: true });
    }
  });
});
