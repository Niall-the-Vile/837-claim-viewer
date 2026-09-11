import { describe, it, expect } from 'vitest';
import { buildCsvExport, buildJsonExport, CSV_COLUMNS_BASE, CSV_IDENTIFIER_COLUMNS, REDACTED } from '../src/app/export/structuredExport.js';
import type { EffectiveClaimForExport } from '../src/app/export/structuredExport.js';
import type { Claim, ServiceLine } from '../src/model/claim.js';
import type { AppliedFieldEdit } from '../src/model/editableFields.js';

/**
 * Unit tests for the Build 4.3/4.4 structured CSV/JSON export formatters.
 * Every assertion checks the FULL header row / FULL object shape (never a
 * spot check) per docs/BUILD_QUEUE.md rule 4 — these are the app's first
 * lookup-table-shaped export columns, in the sense the task's adversarial
 * audit is aimed at.
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
    diagPointers: ['A'],
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
    patient: { name: { last: 'DOE', first: 'JANE', middle: '' }, dob: '1990-01-01', sex: 'F', address: { line1: '1 MAIN ST', line2: '', city: 'COLUMBUS', state: 'OH', zip: '43215' }, phone: '6145551212', relationshipToInsured: '18', accountNumber: 'ACCT-42' },
    insured: { name: { last: 'DOE', first: 'JANE', middle: '' }, memberId: 'MEM-99', group: 'GRP-1', plan: 'PPO', dob: '1990-01-01', sex: 'F', address: { line1: '1 MAIN ST', line2: '', city: 'COLUMBUS', state: 'OH', zip: '43215' }, employer: 'ACME' },
    payer: { name: 'PAYER CO', id: 'P1', address: emptyAddress(), order: 'Primary' },
    otherInsurance: null,
    billingProvider: { name: 'CLINIC', npi: '1234567893', taxId: '990000000', taxIdType: 'E', address: emptyAddress(), phone: '', taxonomy: '207Q00000X' },
    renderingProvider: { name: emptyName(), npi: '9999999999', taxonomy: '' },
    referringProvider: null,
    facility: null,
    diagnoses: [{ pointer: 'A', ordinal: 1, code: 'J020', poa: '' }],
    serviceLines: [baseLine()],
    totals: { totalCharge: 100, amountPaid: 0 },
    flags: { acceptAssignment: false, autoAccident: false, autoAccidentState: '', employmentRelated: false, priorAuth: '' },
    hospitalization: null,
    narrative: '',
    cliaNumber: '',
    raw: { secret: 'PHI-LOOKING-RAW-BLOB' },
    warnings: [],
    ...overrides,
  };
}

const NO_EDITS: AppliedFieldEdit[] = [];
const ONE_LINE_EDIT: AppliedFieldEdit[] = [{ fieldPath: 'serviceLines[0].charge', label: 'Line 1 charge', originalValue: '50.00', currentValue: '100.00' }];
const ONE_CLAIM_LEVEL_EDIT: AppliedFieldEdit[] = [{ fieldPath: 'patient.accountNumber', label: 'Patient account number', originalValue: 'OLD', currentValue: 'ACCT-42' }];

function csvLines(csv: string): string[] {
  // buildCsvExport uses CRLF row separators and a trailing CRLF.
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(0, -2).split('\r\n');
}

describe('CSV column lists', () => {
  it('base columns are exactly this list, in this order', () => {
    expect(CSV_COLUMNS_BASE).toEqual([
      'claimId',
      'formType',
      'patientAccountNumber',
      'billingProviderName',
      'billingProviderNpi',
      'totalCharge',
      'claimEdited',
      'editedFieldLabels',
      'lineNumber',
      'lineEdited',
      'serviceDateFrom',
      'serviceDateThru',
      'placeOfServiceOrRevenueCode',
      'procCode',
      'modifiers',
      'units',
      'charge',
      'diagPointers',
    ]);
  });

  it('identifier columns are exactly this list, in this order', () => {
    expect(CSV_IDENTIFIER_COLUMNS).toEqual(['patientName', 'patientDob', 'patientAddress', 'patientPhone', 'insuredName', 'insuredMemberId', 'insuredDob', 'insuredAddress']);
  });
});

describe('buildCsvExport — PHI-minimal default (includeIdentifiers: false)', () => {
  it('header row is exactly CSV_COLUMNS_BASE, with no identifier columns', () => {
    const csv = buildCsvExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false });
    const [header] = csvLines(csv);
    expect(header).toBe(CSV_COLUMNS_BASE.join(','));
  });

  it('never emits the patient name, DOB, address, phone, or member ID anywhere in the file', () => {
    const csv = buildCsvExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false });
    expect(csv).not.toContain('DOE');
    expect(csv).not.toContain('JANE');
    expect(csv).not.toContain('1990-01-01');
    expect(csv).not.toContain('1 MAIN ST');
    expect(csv).not.toContain('6145551212');
    expect(csv).not.toContain('MEM-99');
    expect(csv).not.toContain('PHI-LOOKING-RAW-BLOB'); // raw record is never dumped into a structured export
  });

  it('one data row per service line, every field populated exactly, unedited claim', () => {
    const csv = buildCsvExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false });
    const [, row1, ...rest] = csvLines(csv);
    expect(rest).toEqual([]);
    expect(row1).toBe(['CLM001', 'cms1500', 'ACCT-42', 'CLINIC', '1234567893', '100.00', 'false', '', '1', 'false', '2026-01-05', '2026-01-05', '11', '99213', '', '1', '100.00', 'A'].join(','));
  });

  it('a claim with zero service lines still emits exactly one row, with blank line columns', () => {
    const claim = baseClaim({ serviceLines: [] });
    const csv = buildCsvExport([{ claim, applied: NO_EDITS }], { includeIdentifiers: false });
    const [, row1, ...rest] = csvLines(csv);
    expect(rest).toEqual([]);
    expect(row1).toBe(['CLM001', 'cms1500', 'ACCT-42', 'CLINIC', '1234567893', '100.00', 'false', '', '', 'false', '', '', '', '', '', '', '', ''].join(','));
  });

  it('multiple service lines produce one row each, header fields repeated verbatim', () => {
    const claim = baseClaim({ serviceLines: [baseLine({ procCode: '99213' }), baseLine({ procCode: '99214', fromDate: '2026-01-06', thruDate: '2026-01-06', charge: 50 })] });
    const csv = buildCsvExport([{ claim, applied: NO_EDITS }], { includeIdentifiers: false });
    const [, row1, row2] = csvLines(csv);
    expect(row1).toContain('99213');
    expect(row2).toContain('99214');
    expect(row1?.startsWith('CLM001,cms1500,ACCT-42,CLINIC,1234567893,100.00,false,,1,')).toBe(true);
    expect(row2?.startsWith('CLM001,cms1500,ACCT-42,CLINIC,1234567893,100.00,false,,2,')).toBe(true);
  });

  it('CSV-escapes values containing commas, quotes, or newlines', () => {
    const claim = baseClaim({ billingProvider: { name: 'CLINIC, "THE BEST"\nSUITE 2', npi: '1234567893', taxId: '', taxIdType: '', address: emptyAddress(), phone: '', taxonomy: '' } });
    const csv = buildCsvExport([{ claim, applied: NO_EDITS }], { includeIdentifiers: false });
    expect(csv).toContain('"CLINIC, ""THE BEST""\nSUITE 2"');
  });
});

describe('buildCsvExport — includeIdentifiers: true (explicit opt-in)', () => {
  it('header row is CSV_COLUMNS_BASE followed by CSV_IDENTIFIER_COLUMNS', () => {
    const csv = buildCsvExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: true });
    const [header] = csvLines(csv);
    expect(header).toBe([...CSV_COLUMNS_BASE, ...CSV_IDENTIFIER_COLUMNS].join(','));
  });

  it('populates every identifier column with the claim\'s actual values', () => {
    const csv = buildCsvExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: true });
    const [, row1] = csvLines(csv);
    // Address/name values contain commas, so they're CSV-quoted — assert via
    // substring rather than a naive split(',') (which would fragment them).
    expect(row1).toContain('"DOE, JANE",1990-01-01,"1 MAIN ST, COLUMBUS, OH 43215",6145551212,"DOE, JANE",MEM-99,1990-01-01,"1 MAIN ST, COLUMBUS, OH 43215"');
  });
});

describe('buildCsvExport — EDITED marking (mandatory in every format)', () => {
  it('claimEdited/editedFieldLabels reflect a claim-level (non-line) override on every one of its rows', () => {
    const claim = baseClaim({ serviceLines: [baseLine(), baseLine({ procCode: '99214' })] });
    const csv = buildCsvExport([{ claim, applied: ONE_CLAIM_LEVEL_EDIT }], { includeIdentifiers: false });
    const [, row1, row2] = csvLines(csv);
    for (const row of [row1, row2]) {
      const cells = row!.split(',');
      expect(cells[6]).toBe('true'); // claimEdited
      expect(cells[7]).toBe('Patient account number'); // editedFieldLabels
      expect(cells[9]).toBe('false'); // lineEdited — this override isn't on either line
    }
  });

  it('lineEdited is true only for the specific line an override touches', () => {
    const claim = baseClaim({ serviceLines: [baseLine(), baseLine({ procCode: '99214' })] });
    const csv = buildCsvExport([{ claim, applied: ONE_LINE_EDIT }], { includeIdentifiers: false });
    const [, row1, row2] = csvLines(csv);
    expect(row1!.split(',')[9]).toBe('true'); // line 1 edited
    expect(row2!.split(',')[9]).toBe('false'); // line 2 untouched
    expect(row1!.split(',')[6]).toBe('true'); // claimEdited is claim-wide regardless of which line
  });

  it('an unedited claim never shows claimEdited=true or a non-empty editedFieldLabels', () => {
    const csv = buildCsvExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false });
    const [, row1] = csvLines(csv);
    const cells = row1!.split(',');
    expect(cells[6]).toBe('false');
    expect(cells[7]).toBe('');
  });
});

describe('buildCsvExport — multi-claim (batch) document', () => {
  it('concatenates rows from every claim, in the given order, under one header', () => {
    const claims: EffectiveClaimForExport[] = [
      { claim: baseClaim({ claimId: 'CLM-A' }), applied: NO_EDITS },
      { claim: baseClaim({ claimId: 'CLM-B' }), applied: ONE_CLAIM_LEVEL_EDIT },
    ];
    const csv = buildCsvExport(claims, { includeIdentifiers: false });
    const lines = csvLines(csv);
    expect(lines).toHaveLength(3); // header + 1 row per claim (1 line each)
    expect(lines[1]?.startsWith('CLM-A,')).toBe(true);
    expect(lines[2]?.startsWith('CLM-B,')).toBe(true);
    expect(lines[2]?.split(',')[6]).toBe('true');
  });
});

describe('buildJsonExport — PHI-minimal default (includeIdentifiers: false)', () => {
  it('document envelope + per-claim shape is exact, with every identifier field redacted', () => {
    const exportedAt = new Date('2026-09-11T12:00:00.000Z');
    const json = buildJsonExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false }, exportedAt);
    const doc = JSON.parse(json);
    expect(doc).toEqual({
      schemaVersion: 1,
      exportedAt: '2026-09-11T12:00:00.000Z',
      claimCount: 1,
      identifiersIncluded: false,
      claims: [
        {
          claimId: 'CLM001',
          formType: 'cms1500',
          patient: { accountNumber: 'ACCT-42', name: REDACTED, dob: REDACTED, address: REDACTED, phone: REDACTED },
          insured: { name: REDACTED, memberId: REDACTED, dob: REDACTED, address: REDACTED },
          billingProvider: { name: 'CLINIC', npi: '1234567893', taxId: '990000000' },
          renderingProvider: { npi: '9999999999' },
          totals: { totalCharge: 100, amountPaid: 0 },
          diagnoses: [{ pointer: 'A', code: 'J020' }],
          serviceLines: [
            {
              line: 1,
              fromDate: '2026-01-05',
              thruDate: '2026-01-05',
              placeOfService: '11',
              revenueCode: '',
              procCode: '99213',
              modifiers: [],
              units: '1',
              charge: 100,
              diagPointers: ['A'],
              edited: false,
            },
          ],
          edited: false,
          editedFieldCount: 0,
          edits: [],
        },
      ],
    });
  });

  it('never serializes the claim\'s raw record or any literal PHI string when identifiers are excluded', () => {
    const json = buildJsonExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false }, new Date(0));
    expect(json).not.toContain('DOE');
    expect(json).not.toContain('1990-01-01');
    expect(json).not.toContain('PHI-LOOKING-RAW-BLOB');
  });
});

describe('buildJsonExport — includeIdentifiers: true', () => {
  it('populates every identifier field with the claim\'s actual values', () => {
    const json = buildJsonExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: true }, new Date(0));
    const doc = JSON.parse(json);
    expect(doc.identifiersIncluded).toBe(true);
    expect(doc.claims[0].patient).toEqual({ accountNumber: 'ACCT-42', name: 'DOE, JANE', dob: '1990-01-01', address: '1 MAIN ST, COLUMBUS, OH 43215', phone: '6145551212' });
    expect(doc.claims[0].insured).toEqual({ name: 'DOE, JANE', memberId: 'MEM-99', dob: '1990-01-01', address: '1 MAIN ST, COLUMBUS, OH 43215' });
  });
});

describe('buildJsonExport — EDITED marking (mandatory in every format)', () => {
  it('sets edited/editedFieldCount/edits from the applied array verbatim, and per-line edited correctly', () => {
    const claim = baseClaim({ serviceLines: [baseLine(), baseLine({ procCode: '99214' })] });
    const json = buildJsonExport([{ claim, applied: ONE_LINE_EDIT }], { includeIdentifiers: false }, new Date(0));
    const doc = JSON.parse(json);
    const c = doc.claims[0];
    expect(c.edited).toBe(true);
    expect(c.editedFieldCount).toBe(1);
    expect(c.edits).toEqual(ONE_LINE_EDIT);
    expect(c.serviceLines[0].edited).toBe(true);
    expect(c.serviceLines[1].edited).toBe(false);
  });

  it('an unedited claim has edited:false, editedFieldCount:0, edits:[]', () => {
    const json = buildJsonExport([{ claim: baseClaim(), applied: NO_EDITS }], { includeIdentifiers: false }, new Date(0));
    const c = JSON.parse(json).claims[0];
    expect(c.edited).toBe(false);
    expect(c.editedFieldCount).toBe(0);
    expect(c.edits).toEqual([]);
  });
});

describe('buildJsonExport — multi-claim (batch) document', () => {
  it('claimCount matches, and claims appear in the given order', () => {
    const claims: EffectiveClaimForExport[] = [
      { claim: baseClaim({ claimId: 'CLM-A' }), applied: NO_EDITS },
      { claim: baseClaim({ claimId: 'CLM-B' }), applied: NO_EDITS },
      { claim: baseClaim({ claimId: 'CLM-C' }), applied: ONE_CLAIM_LEVEL_EDIT },
    ];
    const doc = JSON.parse(buildJsonExport(claims, { includeIdentifiers: false }, new Date(0)));
    expect(doc.claimCount).toBe(3);
    expect(doc.claims.map((c: { claimId: string }) => c.claimId)).toEqual(['CLM-A', 'CLM-B', 'CLM-C']);
    expect(doc.claims[2].edited).toBe(true);
  });
});
