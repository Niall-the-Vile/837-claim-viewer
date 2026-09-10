import { describe, it, expect } from 'vitest';
import {
  validateClaim,
  isValidNpi,
  fmtCents,
  normalizeTob,
  isValidToothToken,
  isValidToothSurfaceToken,
  DUPLICATE_SUPPRESSING_MODIFIERS,
} from '../src/model/validate.js';
import type { Claim, ServiceLine, Institutional, Dental } from '../src/model/claim.js';

/**
 * Direct unit tests for the Build 3.1 rules in src/model/validate.ts — both
 * the pure-move refactor (isValidNpi/fmtCents/validateClaim's original six
 * codes stay covered by test/jsonClaimSource.test.ts's existing tests,
 * unchanged) and every new rule (a)-(g) from docs/BUILD_QUEUE.md Build 3.1.
 * Builds a bare Claim object directly rather than going through a source
 * parser, so each rule is exercised in isolation from parsing concerns.
 */

function emptyName() {
  return { last: '', first: '', middle: '' };
}
function emptyAddress() {
  return { line1: '', line2: '', city: '', state: '', zip: '' };
}

function baseLine(overrides: Partial<ServiceLine> = {}): ServiceLine {
  return {
    fromDate: '2026-01-05',
    thruDate: '2026-01-05',
    placeOfService: '11',
    procCode: '99213',
    modifiers: [],
    diagPointers: [],
    charge: 100,
    units: '1',
    chargeId: 'L1',
    patientResponsibility: 0,
    ...overrides,
  };
}

function baseClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    claimId: 'CLM001',
    formType: 'cms1500',
    claimFormRaw: '1500',
    patient: { name: emptyName(), dob: '', sex: '', address: emptyAddress(), phone: '', relationshipToInsured: '18', accountNumber: '' },
    insured: { name: emptyName(), memberId: '', group: '', plan: '', dob: '', sex: '', address: emptyAddress(), employer: '' },
    payer: { name: '', id: '', address: emptyAddress(), order: '' },
    otherInsurance: null,
    billingProvider: { name: 'CLINIC', npi: '1234567893', taxId: '990000000', taxIdType: 'E', address: emptyAddress(), phone: '', taxonomy: '207Q00000X' },
    renderingProvider: { name: emptyName(), npi: '', taxonomy: '' },
    referringProvider: null,
    facility: null,
    diagnoses: [{ pointer: 'A', ordinal: 1, code: 'J020', poa: '' }],
    serviceLines: [baseLine()],
    totals: { totalCharge: 100, amountPaid: 0 },
    flags: { acceptAssignment: false, autoAccident: false, autoAccidentState: '', employmentRelated: false, priorAuth: '' },
    hospitalization: null,
    narrative: '',
    cliaNumber: '',
    raw: {},
    warnings: [],
    ...overrides,
  };
}

function baseInstitutional(overrides: Partial<Institutional> = {}): Institutional {
  return {
    typeOfBill: '111',
    statementFrom: '',
    statementThrough: '',
    admissionDate: '',
    admissionType: '',
    admissionSource: '',
    patientStatus: '',
    conditionCodes: [],
    occurrenceCodes: [],
    occurrenceSpans: [],
    valueCodes: [],
    admittingDiagnosis: '',
    principalProcedure: null,
    drg: '',
    ...overrides,
  };
}

function baseDental(overrides: Partial<Dental> = {}): Dental {
  return {
    transactionType: '',
    predeterminationNumber: '',
    placeOfTreatment: '',
    missingTeeth: [],
    orthodontics: null,
    treatingDentist: emptyName(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Original 6 codes — pinned once more here to prove the refactor didn't
// change validateClaim's behavior (test/jsonClaimSource.test.ts already
// covers these through the JSON source; this pins them directly too).
// ---------------------------------------------------------------------------

describe('validateClaim — original codes still fire (byte-identical after the 3.1 move)', () => {
  it('a clean claim has no warnings', () => {
    const claim = baseClaim();
    claim.warnings = validateClaim(claim, '2026-06-01');
    expect(claim.warnings).toEqual([]);
  });

  it('charge-total-mismatch', () => {
    const claim = baseClaim({ totals: { totalCharge: 999, amountPaid: 0 } });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('charge-total-mismatch');
  });
});

// ---------------------------------------------------------------------------
// normalizeTob
// ---------------------------------------------------------------------------

describe('normalizeTob', () => {
  it('strips exactly one leading 0 and requires 3 remaining digits', () => {
    expect(normalizeTob('111')).toBe('111');
    expect(normalizeTob('0111')).toBe('111');
    expect(normalizeTob('00111')).toBeNull(); // two leading zeros -> 4 remaining chars, not 3
    expect(normalizeTob('11')).toBeNull();
    expect(normalizeTob('')).toBeNull();
    expect(normalizeTob('11A')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3.1(a) — institutional line missing revenue/proc, or malformed revenue code
// ---------------------------------------------------------------------------

describe('3.1(a) institutional line revenue/procedure checks', () => {
  it('flags a line with neither revenue code nor procedure code', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional(),
      serviceLines: [baseLine({ procCode: '' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('institutional-line-missing-revenue-or-proc');
  });

  it('flags a revenue code that is not exactly 4 digits', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional(),
      serviceLines: [baseLine({ revenueCode: '30', procCode: '99213' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('institutional-line-revenue-code-not-4-digits');
  });

  it('does not flag a well-formed institutional line', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional(),
      serviceLines: [baseLine({ revenueCode: '0300', procCode: '85025' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('institutional-line-missing-revenue-or-proc');
    expect(w.map((x) => x.code)).not.toContain('institutional-line-revenue-code-not-4-digits');
  });

  it('does not apply to a non-institutional claim even with a bare line', () => {
    const claim = baseClaim({ serviceLines: [baseLine({ procCode: '' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('institutional-line-missing-revenue-or-proc');
  });

  it('no-ops on a malformed/blank type of bill', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional({ typeOfBill: '' }),
      serviceLines: [baseLine({ procCode: '' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('institutional-line-missing-revenue-or-proc');
  });
});

// ---------------------------------------------------------------------------
// 3.1(b) — date-of-service checks
// ---------------------------------------------------------------------------

describe('3.1(b) date-of-service checks', () => {
  it('flags a line date outside the statement period (institutional only)', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional({ statementFrom: '2026-01-01', statementThrough: '2026-01-10' }),
      serviceLines: [baseLine({ fromDate: '2026-01-15', thruDate: '2026-01-15' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('line-dos-outside-statement-period');
  });

  it('does not flag a line inside the statement period', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional({ statementFrom: '2026-01-01', statementThrough: '2026-01-10' }),
      serviceLines: [baseLine({ fromDate: '2026-01-05', thruDate: '2026-01-05' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('line-dos-outside-statement-period');
  });

  it('skips a blank-date line (valid on inpatient bills) rather than flagging it', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional({ statementFrom: '2026-01-01', statementThrough: '2026-01-10' }),
      serviceLines: [baseLine({ fromDate: '', thruDate: '' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('line-dos-outside-statement-period');
  });

  it('does not apply the statement-period check when the claim states no period', () => {
    const claim = baseClaim({
      formType: 'ub04',
      institutional: baseInstitutional({ statementFrom: '', statementThrough: '' }),
      serviceLines: [baseLine({ fromDate: '2099-01-01', thruDate: '2099-01-01' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('line-dos-outside-statement-period');
  });

  it('flags a future date of service, string-compared against the injected today', () => {
    const claim = baseClaim({ serviceLines: [baseLine({ fromDate: '2026-07-01', thruDate: '2026-07-01' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('line-dos-in-future');
  });

  it('does not flag a past or today date of service', () => {
    const claim = baseClaim({ serviceLines: [baseLine({ fromDate: '2026-06-01', thruDate: '2026-06-01' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('line-dos-in-future');
  });

  it('suppresses future-DOS on a dental claim with a predetermination number', () => {
    const claim = baseClaim({
      formType: 'dental',
      dental: baseDental({ predeterminationNumber: 'PD-1' }),
      serviceLines: [baseLine({ fromDate: '2026-12-01', thruDate: '2026-12-01' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('line-dos-in-future');
  });

  it('suppresses future-DOS on a dental claim with an orthodontics block', () => {
    const claim = baseClaim({
      formType: 'dental',
      dental: baseDental({ orthodontics: { monthsRemaining: '6', appliancePlacedDate: '' } }),
      serviceLines: [baseLine({ fromDate: '2026-12-01', thruDate: '2026-12-01' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('line-dos-in-future');
  });

  it('does NOT suppress future-DOS on a plain dental claim (no predetermination, no orthodontics)', () => {
    const claim = baseClaim({
      formType: 'dental',
      dental: baseDental(),
      serviceLines: [baseLine({ fromDate: '2026-12-01', thruDate: '2026-12-01' })],
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('line-dos-in-future');
  });

  it('never parses to Date — a lexicographically-comparable but not-a-real-date string still compares as a string', () => {
    // '2026-06-01' < '2026-13-40' lexicographically even though the RHS
    // isn't a valid calendar date — proves the comparison is a plain string
    // compare, not routed through `new Date(...)` (which would coerce an
    // invalid date to `Invalid Date` and break the comparison silently).
    const claim = baseClaim({ serviceLines: [baseLine({ fromDate: '2026-13-40', thruDate: '2026-13-40' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('line-dos-in-future');
  });
});

// ---------------------------------------------------------------------------
// 3.1(c) — duplicate service lines
// ---------------------------------------------------------------------------

describe('3.1(c) duplicate service lines', () => {
  it('flags two identical lines and names both 1-based line numbers', () => {
    const line = baseLine();
    const claim = baseClaim({ serviceLines: [line, { ...line }], totals: { totalCharge: 200, amountPaid: 0 } });
    const w = validateClaim(claim, '2026-06-01');
    const dup = w.find((x) => x.code === 'duplicate-service-line');
    expect(dup).toBeDefined();
    expect(dup!.message).toContain('1 and 2');
  });

  it('names all lines in a group of 3+', () => {
    const line = baseLine();
    const claim = baseClaim({ serviceLines: [line, { ...line }, { ...line }], totals: { totalCharge: 300, amountPaid: 0 } });
    const w = validateClaim(claim, '2026-06-01');
    const dup = w.find((x) => x.code === 'duplicate-service-line');
    expect(dup!.message).toContain('1, 2 and 3');
  });

  it('does not flag lines differing only in charge, proc code, or units', () => {
    const line = baseLine();
    const claim = baseClaim({
      serviceLines: [line, { ...line, charge: 101 }, { ...line, procCode: '99214' }, { ...line, units: '2' }],
      totals: { totalCharge: line.charge + 101 + line.charge + line.charge, amountPaid: 0 },
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('duplicate-service-line');
  });

  it('treats modifiers as a sorted set — [76,59] and [59,76] on two lines still count as identical', () => {
    const line = baseLine();
    const claim = baseClaim({
      serviceLines: [{ ...line, modifiers: ['76', '59'] }, { ...line, modifiers: ['59', '76'] }],
      totals: { totalCharge: 200, amountPaid: 0 },
    });
    const w = validateClaim(claim, '2026-06-01');
    // Suppressed anyway (76/59 are suppressing modifiers) — this case exists
    // to prove modifier-order doesn't create two different dedup keys before
    // suppression is even considered; see the next test for the
    // non-suppressed case.
    expect(w.map((x) => x.code)).not.toContain('duplicate-service-line');
  });

  it('suppresses the warning when both (otherwise identical) lines carry a repeat/distinct-procedure modifier', () => {
    const line = baseLine({ modifiers: ['76'] });
    const claim = baseClaim({
      serviceLines: [line, { ...line }],
      totals: { totalCharge: 200, amountPaid: 0 },
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('duplicate-service-line');
  });

  it('every suppression modifier in the spec list actually suppresses an otherwise-exact-duplicate pair', () => {
    for (const m of DUPLICATE_SUPPRESSING_MODIFIERS) {
      const line = baseLine({ modifiers: [m] });
      const claim = baseClaim({
        serviceLines: [line, { ...line }],
        totals: { totalCharge: 200, amountPaid: 0 },
      });
      const w = validateClaim(claim, '2026-06-01');
      expect(w.map((x) => x.code), `modifier ${m} should suppress the duplicate warning`).not.toContain('duplicate-service-line');
    }
  });

  it('a non-suppressing modifier (e.g. 25) does not suppress — both lines share it, so they are still an exact-duplicate pair', () => {
    const line = baseLine({ modifiers: ['25'] });
    const claim = baseClaim({
      serviceLines: [line, { ...line }],
      totals: { totalCharge: 200, amountPaid: 0 },
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('duplicate-service-line');
  });

  it('matches on tooth numbers/surfaces too (dental)', () => {
    const line = baseLine({ toothNumbers: '3', toothSurfaces: 'MO' });
    const claim = baseClaim({
      formType: 'dental',
      serviceLines: [line, { ...line }],
      totals: { totalCharge: 200, amountPaid: 0 },
    });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('duplicate-service-line');

    const claim2 = baseClaim({
      formType: 'dental',
      serviceLines: [line, { ...line, toothNumbers: '4' }],
      totals: { totalCharge: 200, amountPaid: 0 },
    });
    const w2 = validateClaim(claim2, '2026-06-01');
    expect(w2.map((x) => x.code)).not.toContain('duplicate-service-line');
  });
});

describe('3.1(c) DUPLICATE_SUPPRESSING_MODIFIERS — exact set', () => {
  it('matches the spec list exactly, no more no less', () => {
    const expected = [
      '76', '77', '91', '59',
      'XE', 'XS', 'XP', 'XU',
      'LT', 'RT',
      'E1', 'E2', 'E3', 'E4',
      'FA', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
      'TA', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
      'LC', 'LD', 'LM', 'RC', 'RI',
    ];
    expect([...DUPLICATE_SUPPRESSING_MODIFIERS].sort()).toEqual([...expected].sort());
  });
});

// ---------------------------------------------------------------------------
// 3.1(e) — dental tooth/surface validity
// ---------------------------------------------------------------------------

describe('isValidToothToken — every value in and around the valid ranges', () => {
  it('accepts 1-32', () => {
    for (let n = 1; n <= 32; n++) expect(isValidToothToken(String(n)), `tooth ${n}`).toBe(true);
  });
  it('rejects 0 and 33', () => {
    expect(isValidToothToken('0')).toBe(false);
    expect(isValidToothToken('33')).toBe(false);
  });
  it('accepts 51-82 (supernumerary permanent)', () => {
    for (let n = 51; n <= 82; n++) expect(isValidToothToken(String(n)), `tooth ${n}`).toBe(true);
  });
  it('rejects 50 and 83', () => {
    expect(isValidToothToken('50')).toBe(false);
    expect(isValidToothToken('83')).toBe(false);
  });
  it('accepts A-T (primary)', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRST') expect(isValidToothToken(ch), `tooth ${ch}`).toBe(true);
  });
  it('rejects U and Z', () => {
    expect(isValidToothToken('U')).toBe(false);
    expect(isValidToothToken('Z')).toBe(false);
  });
  it('accepts AS-TS (supernumerary primary)', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRST') expect(isValidToothToken(`${ch}S`), `tooth ${ch}S`).toBe(true);
  });
  it('rejects US and blank/garbage', () => {
    expect(isValidToothToken('US')).toBe(false);
    expect(isValidToothToken('')).toBe(false);
    expect(isValidToothToken('99')).toBe(false);
    expect(isValidToothToken('A1')).toBe(false);
  });
});

describe('isValidToothSurfaceToken', () => {
  it('accepts every valid surface letter alone', () => {
    for (const ch of ['M', 'O', 'D', 'F', 'L', 'B', 'I']) expect(isValidToothSurfaceToken(ch)).toBe(true);
  });
  it('accepts a multi-char combination of valid letters', () => {
    expect(isValidToothSurfaceToken('MOD')).toBe(true);
    expect(isValidToothSurfaceToken('FLI')).toBe(true);
  });
  it('rejects a token with any invalid letter, and blank', () => {
    expect(isValidToothSurfaceToken('MX')).toBe(false);
    expect(isValidToothSurfaceToken('Z')).toBe(false);
    expect(isValidToothSurfaceToken('')).toBe(false);
  });
});

describe('3.1(e) dental line validation via validateClaim', () => {
  it('flags an invalid tooth number on a dental line', () => {
    const claim = baseClaim({ formType: 'dental', serviceLines: [baseLine({ toothNumbers: '99' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('dental-invalid-tooth-number');
  });

  it('flags an invalid tooth surface on a dental line', () => {
    const claim = baseClaim({ formType: 'dental', serviceLines: [baseLine({ toothNumbers: '3', toothSurfaces: 'MX' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).toContain('dental-invalid-tooth-surface');
  });

  it('never flags an absent tooth number', () => {
    const claim = baseClaim({ formType: 'dental', serviceLines: [baseLine()] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('dental-invalid-tooth-number');
  });

  it('does not apply to non-dental claims even with a garbage toothNumbers value', () => {
    const claim = baseClaim({ formType: 'cms1500', serviceLines: [baseLine({ toothNumbers: '999' })] });
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('dental-invalid-tooth-number');
  });

  it('handles multiple comma-separated tooth numbers, flagging only the bad one', () => {
    const claim = baseClaim({ formType: 'dental', serviceLines: [baseLine({ toothNumbers: '3, 99' })] });
    const w = validateClaim(claim, '2026-06-01');
    const found = w.find((x) => x.code === 'dental-invalid-tooth-number');
    expect(found!.message).toContain('99');
    expect(found!.message).not.toContain('3,');
  });
});

// ---------------------------------------------------------------------------
// 3.1(f) — billing provider tax ID / taxonomy presence
// ---------------------------------------------------------------------------

describe('3.1(f) billing provider tax ID / taxonomy', () => {
  it('flags a missing tax ID as a warning', () => {
    const claim = baseClaim({ billingProvider: { name: 'CLINIC', npi: '1234567893', taxId: '', taxIdType: '', address: emptyAddress(), phone: '', taxonomy: '207Q00000X' } });
    const w = validateClaim(claim, '2026-06-01');
    const found = w.find((x) => x.code === 'billing-taxid-missing');
    expect(found).toBeDefined();
    expect(found!.severity).toBe('warning');
  });

  it('flags a missing taxonomy as info, worded as situational', () => {
    const claim = baseClaim({ billingProvider: { name: 'CLINIC', npi: '1234567893', taxId: '990000000', taxIdType: 'E', address: emptyAddress(), phone: '', taxonomy: '' } });
    const w = validateClaim(claim, '2026-06-01');
    const found = w.find((x) => x.code === 'billing-taxonomy-missing');
    expect(found).toBeDefined();
    expect(found!.severity).toBe('info');
    expect(found!.message).toContain('situational');
  });

  it('flags neither when both are present', () => {
    const claim = baseClaim();
    const w = validateClaim(claim, '2026-06-01');
    expect(w.map((x) => x.code)).not.toContain('billing-taxid-missing');
    expect(w.map((x) => x.code)).not.toContain('billing-taxonomy-missing');
  });
});

// ---------------------------------------------------------------------------
// isValidNpi / fmtCents — unchanged behavior, pinned again post-move.
// ---------------------------------------------------------------------------

describe('isValidNpi / fmtCents (moved, unchanged)', () => {
  it('isValidNpi checks the 80840-prefixed Luhn', () => {
    expect(isValidNpi('1234567893')).toBe(true);
    expect(isValidNpi('1234567890')).toBe(false);
  });
  it('fmtCents formats integer cents as dollars', () => {
    expect(fmtCents(12345)).toBe('$123.45');
    expect(fmtCents(0)).toBe('$0.00');
  });
});
