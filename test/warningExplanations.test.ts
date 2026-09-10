import { describe, it, expect } from 'vitest';
import { WARNING_EXPLANATIONS, explainWarning } from '../src/renderer/warningExplanations.js';

/**
 * Coverage test for src/renderer/warningExplanations.ts, required by
 * docs/BUILD_QUEUE.md Build 3.1: "a test asserting every emitted code has an
 * [explanation] entry." No test previously existed for this file at all.
 *
 * The canonical code list below is the same list documented in
 * warningExplanations.ts's own header comment (kept in sync with the two
 * emitting modules, src/model/validate.ts and src/sources/x12/x12ClaimSource.ts) —
 * checked BOTH directions: every code here must have a real explanation, and
 * every explanation key must be one of these codes (catches a stale entry
 * left behind after a code is renamed or removed, not just a missing one).
 */

const ALL_EMITTED_CODES = [
  // Original seven.
  'charge-total-mismatch',
  'dangling-diag-pointer',
  'billing-npi-invalid',
  'rendering-npi-invalid',
  'diag-overflow',
  'unsupported-form',
  'dental-transaction-type-unknown',
  // Build 3.1 additions.
  'institutional-line-missing-revenue-or-proc',
  'institutional-line-revenue-code-not-4-digits',
  'line-dos-outside-statement-period',
  'line-dos-in-future',
  'duplicate-service-line',
  'dental-invalid-tooth-number',
  'dental-invalid-tooth-surface',
  'billing-taxid-missing',
  'billing-taxonomy-missing',
  'edi-se-count-mismatch',
  'edi-duplicate-claim-id',
  'edi-bad-date-qualifier',
];

describe('WARNING_EXPLANATIONS coverage', () => {
  it('has a non-blank explanation for every emitted warning code', () => {
    for (const code of ALL_EMITTED_CODES) {
      const explanation = explainWarning(code);
      expect(explanation, `missing explanation for warning code "${code}"`).toBeDefined();
      expect(explanation!.trim(), `blank explanation for warning code "${code}"`).not.toBe('');
    }
  });

  it('has no stale entries for codes that are no longer emitted', () => {
    const known = new Set(ALL_EMITTED_CODES);
    for (const code of Object.keys(WARNING_EXPLANATIONS)) {
      expect(known.has(code), `WARNING_EXPLANATIONS has an entry for "${code}", which is not in the known-emitted code list — update ALL_EMITTED_CODES (or remove the stale entry)`).toBe(true);
    }
  });

  it('the table is exactly this many codes (fails loudly if a code is added to one list but not the other)', () => {
    expect(Object.keys(WARNING_EXPLANATIONS)).toHaveLength(ALL_EMITTED_CODES.length);
  });

  it('an unknown code returns undefined rather than throwing', () => {
    expect(explainWarning('not-a-real-code')).toBeUndefined();
  });
});
