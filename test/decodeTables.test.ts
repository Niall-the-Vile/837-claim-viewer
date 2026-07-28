import { describe, it, expect } from 'vitest';

import { PLACE_OF_SERVICE } from '../src/data/placeOfService.js';
import { REVENUE_CODES } from '../src/data/revenueCodes.js';
import { DISCHARGE_STATUS } from '../src/data/dischargeStatus.js';
import { CONDITION_CODES } from '../src/data/conditionCodes.js';
import { OCCURRENCE_CODES, OCCURRENCE_SPAN_CODES } from '../src/data/occurrenceCodes.js';
import { VALUE_CODES } from '../src/data/valueCodes.js';
import { MODIFIERS } from '../src/data/modifiers.js';
import { TOB_FREQUENCY, TOB_FACILITY_TYPE, TOB_BILL_CLASSIFICATION } from '../src/data/typeOfBill.js';
import { decodeRevenueCode, decodeOccurrenceCode, decodeOccurrenceSpanCode } from '../src/model/decode.js';

/**
 * Accuracy tests for the eight public code tables under src/data/.
 *
 * These exist because of the Build 2 audit (docs/AUDIT_BUILD2.md). Build 2
 * shipped confirmed wrong decodes in FOUR tables — including a three-code
 * transcription shift through the occurrence-code therapy series and two
 * value codes decoding to one identical string — against a fully green
 * suite, because the only decode tests in the repo pinned four values total
 * across all eight tables.
 *
 * Decoding is the one feature whose entire value is factual accuracy: these
 * labels render inline beside real dates and dollar figures on claims used
 * in negotiation. A wrong label is worse than no label, so the tables get
 * pinned values AND mechanical structural checks.
 *
 * Every assertion below was confirmed to FAIL against the pre-fix data files
 * (tag build-2-green) before the corrections landed — a test that passes
 * both before and after proves nothing.
 */

/** The structural invariants any of these tables must satisfy, whatever its contents. */
function checkTableShape(name: string, table: Record<string, string>): void {
  const seen = new Map<string, string>();
  for (const [code, label] of Object.entries(table)) {
    expect(label.trim(), `${name}[${code}] must not be blank`).not.toBe('');
    expect(label, `${name}[${code}] must not be a placeholder`).not.toMatch(/^(unknown|n\/a|payer code|days)$/i);

    // Two codes decoding to one string is always a transcription error: it
    // means one of them is carrying its neighbour's label. This single check
    // would have caught VALUE_CODES 42/62 and CONDITION_CODES 61/81
    // mechanically, with no code-set knowledge at all.
    const prior = seen.get(label);
    expect(prior, `${name}[${code}] duplicates the label already on ${name}[${prior}]: "${label}"`).toBeUndefined();
    seen.set(label, code);
  }
}

describe('code table structure', () => {
  const tables: Array<[string, Record<string, string>]> = [
    ['PLACE_OF_SERVICE', PLACE_OF_SERVICE],
    ['REVENUE_CODES', REVENUE_CODES],
    ['DISCHARGE_STATUS', DISCHARGE_STATUS],
    ['CONDITION_CODES', CONDITION_CODES],
    ['OCCURRENCE_CODES', OCCURRENCE_CODES],
    ['OCCURRENCE_SPAN_CODES', OCCURRENCE_SPAN_CODES],
    ['VALUE_CODES', VALUE_CODES],
    ['MODIFIERS', MODIFIERS],
    ['TOB_FREQUENCY', TOB_FREQUENCY],
    ['TOB_FACILITY_TYPE', TOB_FACILITY_TYPE],
    ['TOB_BILL_CLASSIFICATION', TOB_BILL_CLASSIFICATION],
  ];

  for (const [name, table] of tables) {
    it(`${name} has no blank, placeholder or duplicated labels`, () => {
      checkTableShape(name, table);
    });
  }
});

describe('OCCURRENCE_CODES — the therapy series Build 2 shifted', () => {
  // The failure was a clean three-code leftward shift: 39/44/45 carried the
  // labels belonging to 44/45/46, and 46 was absent entirely. Pinning the
  // whole run (not just the wrong keys) is what makes a future re-shift fail.
  it('38 and 39 are the home-IV pair, not a therapy code', () => {
    expect(OCCURRENCE_CODES['38']).toBe('Date treatment started for home IV therapy');
    expect(OCCURRENCE_CODES['39']).toBe('Date discharged on a continuous course of IV therapy');
  });

  it('44/45/46 are occupational, speech and cardiac rehab in that order', () => {
    expect(OCCURRENCE_CODES['44']).toBe('Date treatment started for occupational therapy');
    expect(OCCURRENCE_CODES['45']).toBe('Date treatment started for speech therapy');
    expect(OCCURRENCE_CODES['46']).toBe('Date treatment started for cardiac rehabilitation');
  });

  it('35 remains the physical-therapy start date', () => {
    expect(OCCURRENCE_CODES['35']).toBe('Date treatment started for physical therapy');
  });

  it('27, 28 and 41 carry their own definitions', () => {
    expect(OCCURRENCE_CODES['27']).toBe('Date of hospice certification or recertification');
    expect(OCCURRENCE_CODES['28']).toBe('Date comprehensive outpatient rehabilitation plan established or last reviewed');
    expect(OCCURRENCE_CODES['41']).toBe('Date of first test for pre-admission testing');
  });

  it('does not carry occurrence SPAN codes', () => {
    // 70-82 belong to a different NUBC list. A merged table answers
    // "70 = qualifying stay dates" for an FL31 occurrence code.
    for (const span of ['70', '71', '74', '80', '82']) {
      expect(OCCURRENCE_CODES[span], `occurrence table must not carry span code ${span}`).toBeUndefined();
    }
  });

  it('omits the payer-internal codes rather than labelling them', () => {
    for (const payerOnly of ['23', '48', '49']) {
      expect(OCCURRENCE_CODES[payerOnly]).toBeUndefined();
    }
  });
});

describe('OCCURRENCE_SPAN_CODES', () => {
  it('decodes spans against its own table', () => {
    expect(decodeOccurrenceSpanCode('70').decoded).toBe('Qualifying stay dates (skilled nursing facility)');
    expect(decodeOccurrenceSpanCode('M0').decoded).toBe('QIO/UR approved stay dates');
  });

  it('does not decode an occurrence code as if it were a span', () => {
    expect(decodeOccurrenceSpanCode('44').decoded).toBeNull();
  });

  it('does not decode a span code as if it were an occurrence code', () => {
    expect(decodeOccurrenceCode('70').decoded).toBeNull();
  });
});

describe('VALUE_CODES — the 17-69 block Build 2 got wrong', () => {
  it('17 is the operating outlier amount', () => {
    expect(VALUE_CODES['17']).toBe('Operating outlier amount');
  });

  it('42 is Veterans Affairs and nothing else shares that label', () => {
    expect(VALUE_CODES['42']).toBe('Veterans Affairs');
    const vaCodes = Object.entries(VALUE_CODES).filter(([, label]) => label === 'Veterans Affairs');
    expect(vaCodes).toHaveLength(1);
  });

  it('67 is peritoneal dialysis and 68 is EPO units — not shifted by one key', () => {
    expect(VALUE_CODES['67']).toBe('Peritoneal dialysis hours');
    expect(VALUE_CODES['68']).toBe('EPO units administered or supplied');
  });

  it('55 and 69 are the charity-care pair', () => {
    expect(VALUE_CODES['55']).toBe('Eligibility threshold for charity care');
    expect(VALUE_CODES['69']).toBe('State charity care percent');
  });

  it('omits the payer-internal and reserved codes', () => {
    for (const payerOnly of ['62', '63', '73', '74', '75']) {
      expect(VALUE_CODES[payerOnly], `value code ${payerOnly} is payer-internal or reserved`).toBeUndefined();
    }
  });
});

describe('CONDITION_CODES — gestational-age series vs cost outliers', () => {
  it('81-83 are the C-section/induction attestations', () => {
    expect(CONDITION_CODES['81']).toBe('C-section or induction at less than 39 weeks gestation — medical necessity');
    expect(CONDITION_CODES['82']).toBe('C-section or induction at less than 39 weeks gestation — elective');
    expect(CONDITION_CODES['83']).toBe('C-section or induction at 39 weeks gestation or later');
  });

  it('no condition code in the 80s mentions an outlier', () => {
    for (const code of ['80', '81', '82', '83', '84']) {
      expect(CONDITION_CODES[code] ?? '', `condition code ${code}`).not.toMatch(/outlier/i);
    }
  });

  it('60 and 61 are the two distinct operating cost outliers', () => {
    expect(CONDITION_CODES['60']).toBe('Operating cost day outlier');
    expect(CONDITION_CODES['61']).toBe('Operating cost outlier');
  });
});

describe('TOB_FREQUENCY — the adjustment-source series', () => {
  it('K, M and P name their real initiating entity', () => {
    expect(TOB_FREQUENCY['K']).toBe('OIG-initiated adjustment claim');
    expect(TOB_FREQUENCY['M']).toBe('MSP-initiated adjustment claim');
    expect(TOB_FREQUENCY['P']).toBe('QIO adjustment claim');
  });

  it('contains no invented "QIM" acronym', () => {
    for (const [letter, label] of Object.entries(TOB_FREQUENCY)) {
      expect(label, `TOB_FREQUENCY[${letter}]`).not.toMatch(/QIM/);
    }
  });

  it('B is the termination/revocation notice, distinct from D void/cancel', () => {
    expect(TOB_FREQUENCY['B']).toBe('Termination/revocation notice (hospice/home health)');
    expect(TOB_FREQUENCY['B']).not.toBe(TOB_FREQUENCY['D']);
  });

  it('keeps the adjustment-source series that was already correct', () => {
    expect(TOB_FREQUENCY['F']).toBe('Beneficiary-initiated adjustment claim');
    expect(TOB_FREQUENCY['G']).toBe('CWF-initiated adjustment claim');
    expect(TOB_FREQUENCY['H']).toBe('CMS-initiated adjustment claim');
    expect(TOB_FREQUENCY['I']).toBe('Intermediary-initiated adjustment claim');
  });
});

describe('PLACE_OF_SERVICE', () => {
  it('carries POS 27, assigned by CMS effective 2023-10-01', () => {
    expect(PLACE_OF_SERVICE['27']).toBe('Outreach site/street');
  });
});

describe('MODIFIERS', () => {
  it('modifier 63 keeps the weight threshold that is its applicability trigger', () => {
    expect(MODIFIERS['63']).toBe('Procedure performed on infants weighing less than 4 kg');
    expect(MODIFIERS['63']).toMatch(/4 kg/);
  });
});

describe('decodeRevenueCode', () => {
  it('decodes the 3-character form the 837 passes through verbatim', () => {
    const decoded = decodeRevenueCode('450');
    expect(decoded.decoded).toBe(REVENUE_CODES['0450']);
    // raw must survive untouched — the inspector displays and copies it verbatim.
    expect(decoded.raw).toBe('450');
  });

  it('still decodes the 4-character form', () => {
    expect(decodeRevenueCode('0450').decoded).toBe(REVENUE_CODES['0450']);
  });

  it('does not invent a decode for a 3-digit code with no 4-digit entry', () => {
    expect(decodeRevenueCode('999').decoded).toBeNull();
  });

  it('leaves non-numeric values alone', () => {
    expect(decodeRevenueCode('ABC').decoded).toBeNull();
    expect(decodeRevenueCode('ABC').raw).toBe('ABC');
  });
});

describe('DISCHARGE_STATUS — why decoded text must never be clamped by character count', () => {
  // The 81-88 series is systematically the 01-06 series with ", with planned
  // readmission" appended. Every such pair therefore shares a prefix far
  // longer than any plausible truncation length, so a character-count clamp
  // does not shorten these labels — it MERGES them. Build 2 sliced at 64
  // chars and made 05 and 85 render byte-identical.
  //
  // This test documents the data property that makes the renderer rule
  // non-negotiable; the renderer-side guard lives in test/inspector.test.ts.
  const plannedReadmissionPairs: Array<[string, string]> = [
    ['02', '82'],
    ['03', '83'],
    ['04', '84'],
    ['05', '85'],
    ['43', '88'],
  ];

  function sharedPrefixLength(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return i;
  }

  for (const [base, planned] of plannedReadmissionPairs) {
    it(`${base} and ${planned} are distinct labels that a prefix clamp would blur`, () => {
      const a = DISCHARGE_STATUS[base] ?? '';
      const b = DISCHARGE_STATUS[planned] ?? '';
      expect(a).not.toBe('');
      expect(b).not.toBe('');
      expect(a).not.toBe(b);
      // The distinguishing clause is at the END of the longer label, so it is
      // always the first thing a tail-truncating clamp discards.
      expect(sharedPrefixLength(a, b)).toBeGreaterThan(40);
      expect(b.length).toBeGreaterThan(a.length);
    });
  }

  it('05 and 85 collide outright at the 64-character length Build 2 used', () => {
    const a = DISCHARGE_STATUS['05'] ?? '';
    const b = DISCHARGE_STATUS['85'] ?? '';
    expect(sharedPrefixLength(a, b)).toBeGreaterThan(64);
    expect(a.slice(0, 63)).toBe(b.slice(0, 63));
  });
});
