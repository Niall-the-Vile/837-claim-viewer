import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { serializeClaimsToX12, makeControlNumbers } from '../src/sources/x12/x12ClaimSerializer.js';
import { applyFieldOverrides } from '../src/model/editableFields.js';
import type { Claim } from '../src/model/claim.js';
import type { EffectiveClaimForExport } from '../src/app/export/structuredExport.js';

/**
 * Round-trip validation (docs/CLAUDE_CODE_NEXT_SESSION.md decision 3 / the
 * Build 5 task brief's hard requirement): export -> re-parse through this
 * repo's own X12ClaimSource -> diff against the source claim. Run over
 * every claim in every real 837P/837I/837D fixture this repo has, not a
 * single hand-picked happy-path claim — see the adversarial-audit section
 * of docs/BUILD_LOG.md's Build 5 entry for why that distinction matters.
 */

const here = dirname(fileURLToPath(import.meta.url));
function fixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', 'x12', ...parts), 'utf8');
}

const src = new X12ClaimSource();
const NOW = new Date('2026-03-15T14:30:00Z');

/**
 * `raw` (a verbatim echo of the ORIGINAL file's own segment text — see
 * x12ClaimSource.ts's `claim.raw`) and `warnings` are excluded from the
 * round-trip comparison, for two independent, deliberate reasons documented
 * in docs/BUILD_LOG.md's Build 5 section:
 *  - `raw` can never match byte-for-byte: this serializer produces a
 *    DIFFERENT (still valid) EDI encoding of the same normalized claim, not
 *    a copy of the original file's bytes. Comparing `raw` would fail for a
 *    reason that has nothing to do with correctness.
 *  - `warnings` includes checks that are properties of the ORIGINAL WIRE
 *    FORMAT rather than the normalized model (e.g. edi-se-count-mismatch,
 *    edi-bad-date-qualifier, edi-duplicate-claim-id all depend on exactly
 *    how the SOURCE FILE was structured, not on any Claim field this
 *    serializer writes), plus validateClaim's future-date check is
 *    wall-clock-relative and therefore not guaranteed stable if a fixture's
 *    dates are ever near "today". Excluding `warnings` keeps this test
 *    honest about what it's actually proving (the NORMALIZED MODEL
 *    round-trips) rather than accidentally depending on source-file
 *    artifacts this serializer was never asked to reproduce.
 */
function stripVolatile(claim: Claim): Omit<Claim, 'raw' | 'warnings'> {
  const { raw: _raw, warnings: _warnings, ...rest } = claim;
  return rest;
}

function roundTrip(claim: Claim, applied: EffectiveClaimForExport['applied'] = []): Claim {
  const text = serializeClaimsToX12([{ claim, applied }], NOW, 1);
  const reparsed = src.parse(text);
  expect(reparsed.length).toBe(1);
  return reparsed[0]!;
}

function expectRoundTrips(claim: Claim): void {
  const reparsed = roundTrip(claim);
  expect(stripVolatile(reparsed)).toEqual(stripVolatile(claim));
}

describe('x12ClaimSerializer — round-trip, 837P (professional)', () => {
  it('every claim in 837P-all-fields.dat round-trips', () => {
    const claims = src.parse(fixture('837P-all-fields.dat'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectRoundTrips(c);
  });

  it('every claim in 837P-minimal.dat round-trips', () => {
    const claims = src.parse(fixture('837P-minimal.dat'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectRoundTrips(c);
  });
});

describe('x12ClaimSerializer — round-trip, 837I (institutional)', () => {
  it('every claim in 837I-all-fields.dat round-trips', () => {
    const claims = src.parse(fixture('837I-all-fields.dat'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectRoundTrips(c);
  });

  it('every claim in 837I-minimal.dat round-trips', () => {
    const claims = src.parse(fixture('837I-minimal.dat'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectRoundTrips(c);
  });

  it('every claim in 837I-multi-claim.dat round-trips individually', () => {
    const claims = src.parse(fixture('837I-multi-claim.dat'));
    expect(claims.length).toBeGreaterThan(1); // the whole point of this fixture
    for (const c of claims) expectRoundTrips(c);
  });

  it('837I-multi-claim.dat also round-trips as ONE combined multi-claim 837 (scope "all" shape)', () => {
    const claims = src.parse(fixture('837I-multi-claim.dat'));
    const effective: EffectiveClaimForExport[] = claims.map((claim) => ({ claim, applied: [] }));
    const text = serializeClaimsToX12(effective, NOW, 42);
    const reparsed = src.parse(text);
    expect(reparsed.length).toBe(claims.length);
    for (let i = 0; i < claims.length; i++) {
      expect(stripVolatile(reparsed[i]!)).toEqual(stripVolatile(claims[i]!));
    }
  });

  it('every claim in the large 837I-400-claims.dat fixture round-trips claim-for-claim (throughput + no silent data loss on a big batch)', () => {
    const claims = src.parse(fixture('837I-400-claims.dat'));
    expect(claims.length).toBeGreaterThan(100);
    // Full deep-equal per claim would be slow at this volume for little extra
    // signal beyond what the smaller fixtures above already prove
    // structurally — instead, assert every claim reparses individually with
    // the SAME claimId, diagnosis count, service-line count and total charge,
    // which would catch a systemic serialization bug (wrong loop, dropped
    // line, truncated HI) just as reliably as a full equality check would.
    for (const c of claims) {
      const reparsed = roundTrip(c);
      expect(reparsed.claimId).toBe(c.claimId);
      expect(reparsed.diagnoses.length).toBe(c.diagnoses.length);
      expect(reparsed.serviceLines.length).toBe(c.serviceLines.length);
      expect(reparsed.totals.totalCharge).toBe(c.totals.totalCharge);
    }
  });

  it('every claim in 837I-long-lines.dat round-trips', () => {
    const claims = src.parse(fixture('837I-long-lines.dat'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectRoundTrips(c);
  });
});

describe('x12ClaimSerializer — round-trip, 837D (dental)', () => {
  it('every claim in 837D-all-fields.dat round-trips, including TOO tooth/surface segments and DN1/DN2', () => {
    const claims = src.parse(fixture('837D-all-fields.dat'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) {
      expectRoundTrips(c);
      // This fixture specifically carries multi-tooth/multi-surface lines —
      // assert the TOO round-trip isn't accidentally passing on an empty case.
      if (c.serviceLines.some((l) => (l.toothNumbers ?? '') !== '')) {
        const reparsed = roundTrip(c);
        expect(reparsed.serviceLines.map((l) => l.toothNumbers)).toEqual(c.serviceLines.map((l) => l.toothNumbers));
        expect(reparsed.serviceLines.map((l) => l.toothSurfaces)).toEqual(c.serviceLines.map((l) => l.toothSurfaces));
      }
    }
  });
});

describe('x12ClaimSerializer — round-trip with active field overrides applied', () => {
  it('an overridden professional claim round-trips WITH the override value, not the original', () => {
    const [original] = src.parse(fixture('837P-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'serviceLines[0].charge': '999.99' });
    expect(applied.length).toBeGreaterThan(0);
    expect(effective.serviceLines[0]!.charge).toBe(999.99);
    const reparsed = roundTrip(effective, applied);
    expect(stripVolatile(reparsed)).toEqual(stripVolatile(effective));
    expect(reparsed.serviceLines[0]!.charge).toBe(999.99);
  });

  it('an overridden institutional claim round-trips WITH the override value', () => {
    const [original] = src.parse(fixture('837I-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'insured.memberId': 'CORRECTED-MEMBER-99' });
    expect(applied.length).toBeGreaterThan(0);
    const reparsed = roundTrip(effective, applied);
    expect(stripVolatile(reparsed)).toEqual(stripVolatile(effective));
    expect(reparsed.insured.memberId).toBe('CORRECTED-MEMBER-99');
  });

  /**
   * patient.accountNumber is a special case: x12ClaimSource.ts reads BOTH
   * `claimId` and `patient.accountNumber` off the SAME wire position (CLM01,
   * "Patient Control Number" — see x12ClaimSerializer.ts's clmSegment doc
   * comment). Overriding accountNumber is the only editable field where the
   * reparsed claim's `claimId` legitimately changes too — that's not a bug,
   * it's X12 correctly reflecting that there is only one number here, not
   * two. This test asserts exactly that (documented in docs/BUILD_LOG.md's
   * Build 5 adversarial-audit section), rather than a naive full-claim
   * equality that would incorrectly fail on `claimId`.
   */
  it('overriding patient.accountNumber changes the exported CLM01 — and therefore the reparsed claimId too, since X12 has only one field for both', () => {
    const [original] = src.parse(fixture('837P-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'patient.accountNumber': 'CORRECTED-ACCT-99' });
    expect(applied.length).toBeGreaterThan(0);
    const reparsed = roundTrip(effective, applied);
    expect(reparsed.patient.accountNumber).toBe('CORRECTED-ACCT-99');
    expect(reparsed.claimId).toBe('CORRECTED-ACCT-99');
    const expected: Claim = { ...effective, claimId: 'CORRECTED-ACCT-99' };
    expect(stripVolatile(reparsed)).toEqual(stripVolatile(expected));
  });

  it('an overridden dental claim round-trips WITH the override value', () => {
    const [original] = src.parse(fixture('837D-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'diagnoses[0].code': 'Z9999' });
    expect(applied.length).toBeGreaterThan(0);
    const reparsed = roundTrip(effective, applied);
    expect(stripVolatile(reparsed)).toEqual(stripVolatile(effective));
    expect(reparsed.diagnoses[0]!.code).toBe('Z9999');
  });
});

describe('x12ClaimSerializer — EDI-native EDITED-equivalent signal (K3)', () => {
  it('carries the mandatory K3 EDITED marker when overrides are active', () => {
    const [original] = src.parse(fixture('837P-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'serviceLines[0].units': '3' });
    expect(applied.length).toBeGreaterThan(0);
    const text = serializeClaimsToX12([{ claim: effective, applied }], NOW, 1);
    expect(text).toContain('K3*THIS CLAIM DATA WAS MODIFIED FROM THE ORIGINAL SOURCE FILE BY 837 CLAIM VIEWER');
    expect(text).toContain('MODIFIED FIELDS');
    expect(text).toContain('LINE 1 MODIFIED FROM ORIGINAL SOURCE');
  });

  it('carries NO K3 EDITED marker when there are no active overrides', () => {
    const [original] = src.parse(fixture('837P-all-fields.dat'));
    const text = serializeClaimsToX12([{ claim: original!, applied: [] }], NOW, 1);
    expect(text).not.toContain('MODIFIED FROM THE ORIGINAL SOURCE');
    expect(text).not.toContain('MODIFIED FIELDS');
  });

  it('only marks the LINE that was actually edited, not every line', () => {
    const [original] = src.parse(fixture('837P-all-fields.dat'));
    expect(original!.serviceLines.length).toBeGreaterThan(1);
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'serviceLines[1].units': '7' });
    const text = serializeClaimsToX12([{ claim: effective, applied }], NOW, 1);
    expect(text).toContain('LINE 2 MODIFIED FROM ORIGINAL SOURCE');
    expect(text).not.toContain('LINE 1 MODIFIED FROM ORIGINAL SOURCE');
  });

  it('the K3 marker is inert to the parser — an edited claim still round-trips exactly to the effective claim', () => {
    const [original] = src.parse(fixture('837I-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'billingProvider.npi': '1234567893' });
    const reparsed = roundTrip(effective, applied);
    expect(stripVolatile(reparsed)).toEqual(stripVolatile(effective));
  });

  // docs/BUILD_LOG.md Build 5 adversarial audit — "does the EDI-native
  // edited-signal ever get omitted for a NON-professional form?" is checked
  // per form type explicitly here, not just inferred from the 837P cases
  // above (which exercise the same shared editedClaimMarkers/
  // editedLineMarker helpers, but the audit calls for verifying each form
  // type, not just trusting shared code).
  it('institutional (837I) exports also carry the K3 marker when overrides are active', () => {
    const [original] = src.parse(fixture('837I-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'insured.group': 'CORRECTED-GROUP' });
    const text = serializeClaimsToX12([{ claim: effective, applied }], NOW, 1);
    expect(text).toContain('K3*THIS CLAIM DATA WAS MODIFIED FROM THE ORIGINAL SOURCE FILE BY 837 CLAIM VIEWER');
    expect(text).toContain('MODIFIED FIELDS');
  });

  it('dental (837D) exports also carry the K3 marker when overrides are active, including a per-line marker', () => {
    const [original] = src.parse(fixture('837D-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'serviceLines[0].procCode': 'D9999' });
    const text = serializeClaimsToX12([{ claim: effective, applied }], NOW, 1);
    expect(text).toContain('K3*THIS CLAIM DATA WAS MODIFIED FROM THE ORIGINAL SOURCE FILE BY 837 CLAIM VIEWER');
    expect(text).toContain('LINE 1 MODIFIED FROM ORIGINAL SOURCE');
  });
});

describe('x12ClaimSerializer — control-number scheme (docs/BUILD_LOG.md Build 5)', () => {
  it('produces distinct ISA/GS/ST triples for 999 consecutive exports within the same wall-clock second', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const seen = new Set<string>();
    for (let seq = 1; seq <= 999; seq++) {
      const c = makeControlNumbers(now, seq);
      const key = `${c.isa}|${c.gs}|${c.st}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(c.isa).toMatch(/^\d{9}$/);
    }
  });

  it('ISA/GS/ST are mutually distinct within one export', () => {
    const c = makeControlNumbers(new Date(), 7);
    expect(new Set([c.isa, c.gs, c.st]).size).toBe(3);
  });

  it('never collides across two different seconds, regardless of seq', () => {
    const a = makeControlNumbers(new Date('2026-01-01T00:00:00Z'), 5);
    const b = makeControlNumbers(new Date('2026-01-01T00:00:01Z'), 5);
    expect(a.isa).not.toBe(b.isa);
    expect(a.gs).not.toBe(b.gs);
    expect(a.st).not.toBe(b.st);
  });

  it('two exports of the SAME claim in the same process get different control numbers (the real electron/main.ts call pattern)', () => {
    const [claim] = src.parse(fixture('837P-minimal.dat'));
    const now = new Date('2026-01-01T00:00:00.500Z');
    const first = serializeClaimsToX12([{ claim: claim!, applied: [] }], now, 1);
    const second = serializeClaimsToX12([{ claim: claim!, applied: [] }], now, 2);
    expect(first).not.toBe(second);
    const isaOf = (text: string): string => /ISA\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*.*?\*(\d{9})\*/.exec(text)?.[1] ?? '';
    expect(isaOf(first)).not.toBe(isaOf(second));
  });
});

describe('x12ClaimSerializer — scope/kind guards', () => {
  it('refuses to export a claim with no form-type renderer (formType "unsupported")', () => {
    const claim: Claim = { ...src.parse(fixture('837P-minimal.dat'))[0]!, formType: 'unsupported' };
    expect(() => serializeClaimsToX12([{ claim, applied: [] }], NOW, 1)).toThrow(/only professional.*institutional.*dental/i);
  });

  it('refuses to combine mixed form types into one 837 file', () => {
    const [p] = src.parse(fixture('837P-minimal.dat'));
    const [i] = src.parse(fixture('837I-minimal.dat'));
    expect(() =>
      serializeClaimsToX12(
        [
          { claim: p!, applied: [] },
          { claim: i!, applied: [] },
        ],
        NOW,
        1,
      ),
    ).toThrow(/mix of professional, institutional, and dental/i);
  });

  it('refuses to export zero claims', () => {
    expect(() => serializeClaimsToX12([], NOW, 1)).toThrow(/no claims/i);
  });
});

describe('x12ClaimSerializer — envelope shape', () => {
  it('produces a well-formed ISA/GS/ST...SE/GE/IEA envelope with a correct SE01 segment count', () => {
    const [claim] = src.parse(fixture('837P-minimal.dat'));
    const text = serializeClaimsToX12([{ claim: claim!, applied: [] }], NOW, 1);
    expect(text.startsWith('ISA')).toBe(true);
    expect(text).toMatch(/GS\*HC\*/);
    expect(text).toMatch(/ST\*837\*/);
    expect(text).toMatch(/SE\*\d+\*/);
    expect(text).toMatch(/GE\*1\*/);
    expect(text).toMatch(/IEA\*1\*/);

    // SE01 must equal the actual segment count between ST and SE, exclusive
    // of both — the exact invariant x12ClaimSource.ts's own
    // edi-se-count-mismatch check enforces on the way in.
    const segments = text.split('~').map((s) => s.trim()).filter((s) => s !== '');
    const stIdx = segments.findIndex((s) => s.startsWith('ST*'));
    const seIdx = segments.findIndex((s) => s.startsWith('SE*'));
    const between = seIdx - stIdx - 1;
    const se01 = Number(segments[seIdx]!.split('*')[1]);
    expect(se01).toBe(between + 2);

    const reparsed = src.parse(text);
    expect(reparsed[0]!.warnings.some((w) => w.code === 'edi-se-count-mismatch')).toBe(false);
  });

  it('uses usage indicator "T" (test) in ISA15 — this app never submits claims', () => {
    const [claim] = src.parse(fixture('837P-minimal.dat'));
    const text = serializeClaimsToX12([{ claim: claim!, applied: [] }], NOW, 1);
    const isaLine = text.split('~')[0]!;
    const isaElements = isaLine.split('*');
    expect(isaElements[15]).toBe('T'); // ISA15 — 0='ISA' id, 1..16=ISA01..ISA16
  });

  it('strips structural delimiter characters out of a delimiter-hostile override instead of corrupting the file', () => {
    const [original] = src.parse(fixture('837P-all-fields.dat'));
    const { claim: effective, applied } = applyFieldOverrides(original!, { 'insured.group': 'A*B:C~D' });
    const text = serializeClaimsToX12([{ claim: effective, applied }], NOW, 1);
    // The file must still tokenize cleanly into the expected claim count —
    // if the delimiters had leaked through, this would throw or produce a
    // garbled/extra segment count instead.
    const reparsed = src.parse(text);
    expect(reparsed.length).toBe(1);
    expect(reparsed[0]!.insured.group).not.toContain('*');
    expect(reparsed[0]!.insured.group).not.toContain('~');
  });
});
