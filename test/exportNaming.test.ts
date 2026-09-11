import { describe, it, expect } from 'vitest';
import { sanitizeFileNamePart, sanitizeNamePart, earliestServiceDate, defaultExportFileName, batchExportFileName, uniqueFileName } from '../src/app/export/exportNaming.js';
import type { Claim, ServiceLine } from '../src/model/claim.js';

/**
 * Unit tests for the PHI-free filename builders behind both the
 * single-claim export path (Build 3.3) and the batch-export path
 * (docs/BUILD_QUEUE.md Build 4.1). Pure model-level tests, same pattern as
 * test/validate.test.ts / test/editableFields.test.ts.
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
    billingProvider: { name: 'NATIONWIDE CHILDRENS HOSPITAL', npi: '1234567893', taxId: '990000000', taxIdType: 'E', address: emptyAddress(), phone: '', taxonomy: '207Q00000X' },
    renderingProvider: { name: emptyName(), npi: '', taxonomy: '' },
    referringProvider: null,
    facility: null,
    diagnoses: [],
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

describe('sanitizeFileNamePart', () => {
  it('strips anything outside [a-zA-Z0-9._-] and caps length at 60', () => {
    expect(sanitizeFileNamePart('CLM 001/ABC:*?')).toBe('CLM_001_ABC___');
    expect(sanitizeFileNamePart('a'.repeat(100))).toHaveLength(60);
  });
});

describe('sanitizeNamePart', () => {
  it('keeps spaces, strips Windows-forbidden characters/control chars/commas, collapses whitespace, caps at 70', () => {
    expect(sanitizeNamePart('MILLER, THEODORE Z')).toBe('MILLER THEODORE Z');
    expect(sanitizeNamePart('A\\B/C:D*E?F"G<H>I|J')).toBe('A B C D E F G H I J');
    expect(sanitizeNamePart('  spaced   out  ')).toBe('spaced out');
    expect(sanitizeNamePart('x'.repeat(100))).toHaveLength(70);
  });
});

describe('earliestServiceDate', () => {
  it('returns the earliest non-blank fromDate, or "" when none', () => {
    const claim = baseClaim({ serviceLines: [baseLine({ fromDate: '2026-03-01' }), baseLine({ fromDate: '2026-01-15' }), baseLine({ fromDate: '' })] });
    expect(earliestServiceDate(claim)).toBe('2026-01-15');
    expect(earliestServiceDate(baseClaim({ serviceLines: [baseLine({ fromDate: '' })] }))).toBe('');
  });
});

describe('defaultExportFileName', () => {
  it('is "<billing provider> - <service date>.pdf" when both are present', () => {
    const claim = baseClaim();
    expect(defaultExportFileName(claim)).toBe('NATIONWIDE CHILDRENS HOSPITAL - 2026-01-05.pdf');
  });

  it('falls back to the claim id when neither part is available', () => {
    const claim = baseClaim({ billingProvider: { name: '', npi: '', taxId: '', taxIdType: '', address: emptyAddress(), phone: '', taxonomy: '' }, serviceLines: [baseLine({ fromDate: '' })] });
    expect(defaultExportFileName(claim)).toBe('claim_CLM001.pdf');
  });

  it('never includes the patient name', () => {
    const claim = baseClaim({ patient: { name: { last: 'SECRETPATIENT', first: 'X', middle: '' }, dob: '', sex: '', address: emptyAddress(), phone: '', relationshipToInsured: '18', accountNumber: '' } });
    expect(defaultExportFileName(claim)).not.toContain('SECRETPATIENT');
  });
});

describe('batchExportFileName', () => {
  it('zero-pads the ordinal to the claim count\'s digit width', () => {
    const claim = baseClaim();
    expect(batchExportFileName(claim, 1, 9)).toBe('NATIONWIDE CHILDRENS HOSPITAL - 2026-01-05 - 1.pdf');
    expect(batchExportFileName(claim, 3, 312)).toBe('NATIONWIDE CHILDRENS HOSPITAL - 2026-01-05 - 003.pdf');
    expect(batchExportFileName(claim, 34, 312)).toBe('NATIONWIDE CHILDRENS HOSPITAL - 2026-01-05 - 034.pdf');
    expect(batchExportFileName(claim, 312, 312)).toBe('NATIONWIDE CHILDRENS HOSPITAL - 2026-01-05 - 312.pdf');
  });

  it('every ordinal in a batch produces a distinct filename even with identical provider/date', () => {
    const claim = baseClaim();
    const names = new Set<string>();
    for (let i = 1; i <= 50; i++) names.add(batchExportFileName(claim, i, 50));
    expect(names.size).toBe(50);
  });

  it('falls back to the claim id + ordinal when provider/date are both blank', () => {
    const claim = baseClaim({ billingProvider: { name: '', npi: '', taxId: '', taxIdType: '', address: emptyAddress(), phone: '', taxonomy: '' }, serviceLines: [baseLine({ fromDate: '' })] });
    expect(batchExportFileName(claim, 1, 1)).toBe('claim_CLM001 - 1.pdf');
  });
});

describe('uniqueFileName', () => {
  it('returns the candidate unchanged when it does not exist', () => {
    expect(uniqueFileName('a.pdf', () => false)).toBe('a.pdf');
  });

  it('appends " (2)", " (3)", ... until a non-colliding name is found', () => {
    const taken = new Set(['a.pdf', 'a (2).pdf', 'a (3).pdf']);
    expect(uniqueFileName('a.pdf', (c) => taken.has(c))).toBe('a (4).pdf');
  });

  it('handles a filename with no extension', () => {
    const taken = new Set(['noext']);
    expect(uniqueFileName('noext', (c) => taken.has(c))).toBe('noext (2)');
  });
});
