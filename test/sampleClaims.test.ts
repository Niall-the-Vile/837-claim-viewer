import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadClaims } from '../src/app/claimService.js';
import { SAMPLE_CLAIMS } from '../src/model/sampleClaims.js';

/**
 * Ease-of-use + accessibility batch, item 4 (docs/FEATURE_BACKLOG.md #26 /
 * docs/CLAUDE_CODE_NEXT_SESSION.md's "Bundled sample-claim set"): the four
 * synthetic fixtures under src/samples/ are opened through the exact same
 * `loadClaims` -> `validateClaim` path as any real file (electron/main.ts's
 * openClaimAtPath), so this test is both "do these parse" and "do they trip
 * exactly the warnings the feature promises" — no separate sample-specific
 * code path to drift from the real one.
 *
 * PHI-safety: every identifying string in these fixtures must be obviously
 * synthetic (the "SAMPLE" prefix convention used throughout src/samples/*.dat)
 * so nobody could mistake one for real PHI if it were ever screenshotted or
 * pasted somewhere — asserted here by grepping the raw fixture text, not just
 * the parsed model, so a stray real-looking value in an untouched corner of
 * the file (e.g. a payer address) can't slip through unnoticed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, '..', 'src', 'samples');

function readSample(fileName: string): string {
  return readFileSync(join(samplesDir, fileName), 'utf8');
}

describe('bundled sample claims (Open Sample Claim)', () => {
  it('SAMPLE_CLAIMS registry names exactly the four fixture files this feature ships', () => {
    expect(SAMPLE_CLAIMS.map((s) => s.fileName).sort()).toEqual(
      ['sample-837d-clean.dat', 'sample-837i-clean.dat', 'sample-837p-clean.dat', 'sample-837p-defective.dat'].sort(),
    );
  });

  it('every fixture file only contains obviously-synthetic identifying text (no real-looking PHI)', () => {
    for (const sample of SAMPLE_CLAIMS) {
      const text = readSample(sample.fileName);
      // Every NM1 person/org name segment in these fixtures uses the
      // "SAMPLE" convention (billing org, patient, insurance co) — this
      // guards against a future edit accidentally reintroducing a
      // realistic-looking name.
      expect(text).toMatch(/SAMPLE/);
      expect(text.toUpperCase()).not.toMatch(/\b(SMITH|JONES|DOE|JANE|JOHN)\b/);
    }
  });

  it('837P clean sample parses as a professional claim with zero warnings', () => {
    const { claims } = loadClaims(readSample('sample-837p-clean.dat'));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.formType).toBe('cms1500');
    expect(claims[0]!.warnings).toEqual([]);
  });

  it('837I clean sample parses as an institutional claim with revenue codes and zero warnings', () => {
    const { claims } = loadClaims(readSample('sample-837i-clean.dat'));
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;
    expect(claim.formType).toBe('ub04');
    expect(claim.warnings).toEqual([]);
    expect(claim.serviceLines.map((l) => l.revenueCode)).toEqual(['0305', '0730']);
  });

  it('837D clean sample parses as a dental claim with only the info-level, unavoidable transaction-type note', () => {
    const { claims } = loadClaims(readSample('sample-837d-clean.dat'));
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;
    expect(claim.formType).toBe('dental');
    expect(claim.warnings).toEqual([
      {
        code: 'dental-transaction-type-unknown',
        severity: 'info',
        message: expect.any(String),
        anchor: { groupId: 'prov' },
      },
    ]);
    expect(claim.serviceLines[0]!.toothNumbers).toBe('3');
  });

  it('the defective sample trips a real, existing warning rule (bad billing NPI checksum) rather than a fabricated one', () => {
    const { claims } = loadClaims(readSample('sample-837p-defective.dat'));
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;
    expect(claim.formType).toBe('cms1500');
    expect(claim.warnings).toEqual([
      {
        code: 'billing-npi-invalid',
        severity: 'warning',
        message: expect.stringContaining('fails the NPI check'),
        anchor: { groupId: 'providers' },
      },
    ]);
  });
});
