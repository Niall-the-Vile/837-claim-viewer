import { describe, it, expect } from 'vitest';
import type { ClaimDetailDto } from '../electron/preload.js';
import {
  formatServiceLinesTsv,
  formatClaimSummary,
  formatWarningsAndReconciliation,
  formatDosSpan,
  reconciliationVerdict,
  formatAnnotationsWorksheet,
} from '../src/renderer/clipboardFormat.js';
import type { LineAnnotation } from '../src/model/annotations.js';

/**
 * Fixture-in / exact-string-out tests for the clipboard/copy suite's pure
 * formatters (docs/TABS_BUILD_PLAN.md §2f items 1, 3 and 5's verdict text).
 * These formatters are deliberately DOM-free (see clipboardFormat.ts's
 * header comment) so they're called directly here with hand-built
 * `ClaimDetailDto` literals — no Electron, no browser, no fixture file I/O
 * needed; every expected string below is asserted verbatim.
 */

function baseDetail(): ClaimDetailDto {
  return {
    claimId: '900000001',
    claimFormRaw: '1500',
    formType: 'cms1500',
    patient: {
      name: 'SAMPLEPATIENT, PAT Q',
      dob: '1980-01-15',
      sex: 'F',
      address: '1 TEST ST, TESTVILLE, OH 43000',
      phone: '',
      relationshipToInsured: '18',
      accountNumber: 'ACCT-0001',
    },
    insured: {
      name: 'SAMPLEPATIENT, PAT',
      memberId: 'MEMBER001',
      group: 'GRP1',
      plan: 'TEST PLAN',
      dob: '1980-01-15',
      sex: 'F',
      address: '1 TEST ST, TESTVILLE, OH 43000',
      employer: '',
    },
    payer: { name: 'SAMPLE HEALTH PLAN', id: 'TEST01', address: '' },
    providers: {
      billing: {
        name: 'SAMPLE CLINIC',
        npi: '1234567893',
        taxId: '990000000',
        taxIdType: 'E',
        address: '2 CLINIC RD, TESTVILLE, OH 43000',
        phone: '5555550100',
        taxonomy: '207Q00000X',
      },
      rendering: { name: 'SAMPLEDOC, DANA', npi: '1234567893', taxonomy: '207Q00000X' },
      referring: null,
      facility: null,
    },
    diagnoses: [
      { pointer: 'A', ordinal: 1, code: 'M545' },
      { pointer: 'B', ordinal: 2, code: 'M25561' },
    ],
    serviceLines: [
      {
        line: 1,
        dates: '2026-05-07',
        placeOfService: '11',
        placeOfServiceDecoded: 'Office',
        procCode: '99213',
        modifiers: '',
        modifierDecodings: [],
        diagPointers: 'A',
        charge: 100,
        units: '1',
        revenueCode: '',
        revenueCodeDecoded: null,
        revenueDescription: '',
        toothNumbers: '',
        toothSurfaces: '',
      },
      {
        line: 2,
        dates: '2026-05-07',
        placeOfService: '11',
        placeOfServiceDecoded: 'Office',
        procCode: '73721',
        modifiers: '26',
        modifierDecodings: [{ raw: '26', decoded: 'Professional component' }],
        diagPointers: 'AB',
        charge: 40,
        units: '1',
        revenueCode: '',
        revenueCodeDecoded: null,
        revenueDescription: '',
        toothNumbers: '',
        toothSurfaces: '',
      },
    ],
    institutional: null,
    totals: { totalCharge: 140, amountPaid: 0, sumOfLineCharges: 140, delta: 0 },
    warnings: [],
    rawText: '{}',
    editableFieldPaths: [],
    edits: [],
    editedFieldCount: 0,
    correctedClaimStatus: 'none',
  };
}

describe('formatServiceLinesTsv', () => {
  it('produces the exact header row + one tab-delimited row per service line', () => {
    const tsv = formatServiceLinesTsv(baseDetail());
    expect(tsv).toBe(
      [
        'Line\tDOS\tPOS/Rev\tCPT/HCPCS\tModifiers\tUnits\tCharge\tDx Pointers\tRendering NPI',
        '1\t2026-05-07\t11\t99213\t\t1\t100.00\tA\t1234567893',
        '2\t2026-05-07\t11\t73721\t26\t1\t40.00\tAB\t1234567893',
      ].join('\n'),
    );
  });

  it('uses the revenue code instead of place-of-service on institutional lines', () => {
    const detail = baseDetail();
    detail.formType = 'ub04';
    detail.serviceLines = [
      {
        line: 1,
        dates: '2026-05-07 - 2026-05-09',
        placeOfService: '', // institutional lines carry no POS (electron/main.ts)
        placeOfServiceDecoded: null,
        procCode: '99213',
        modifiers: '',
        modifierDecodings: [],
        diagPointers: '',
        charge: 500,
        units: '3',
        revenueCode: '0450',
        revenueCodeDecoded: 'Emergency room',
        revenueDescription: 'Emergency room',
        toothNumbers: '',
        toothSurfaces: '',
      },
    ];
    const tsv = formatServiceLinesTsv(detail);
    expect(tsv.split('\n')[1]).toBe('1\t2026-05-07 - 2026-05-09\t0450\t99213\t\t3\t500.00\t\t1234567893');
  });

  it('defaults an empty units string to "1", matching the inspector grid', () => {
    const detail = baseDetail();
    detail.serviceLines[0]!.units = '';
    const tsv = formatServiceLinesTsv(detail);
    expect(tsv.split('\n')[1]).toBe('1\t2026-05-07\t11\t99213\t\t1\t100.00\tA\t1234567893');
  });

  // Build 6, 6.2 — optional annotation columns.
  it('is BYTE-FOR-BYTE identical to the no-annotations output when the second argument is omitted', () => {
    expect(formatServiceLinesTsv(baseDetail())).toBe(formatServiceLinesTsv(baseDetail(), undefined));
  });

  it('adds no Note/Flag columns when every passed-in annotation is empty', () => {
    const allEmpty = new Map<number, LineAnnotation>([
      [0, { note: '', flag: null, checked: false }],
      [1, { note: '   ', flag: null, checked: true }], // checked-only, no note/flag — still not a Note/Flag trigger
    ]);
    expect(formatServiceLinesTsv(baseDetail(), allEmpty)).toBe(formatServiceLinesTsv(baseDetail()));
  });

  it('appends Note/Flag columns to every row once at least one line has a note or flag', () => {
    const annotations = new Map<number, LineAnnotation>([[1, { note: 'confirm modifier', flag: 'dispute', checked: false }]]);
    const tsv = formatServiceLinesTsv(baseDetail(), annotations);
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('Line\tDOS\tPOS/Rev\tCPT/HCPCS\tModifiers\tUnits\tCharge\tDx Pointers\tRendering NPI\tNote\tFlag');
    expect(lines[1]).toBe('1\t2026-05-07\t11\t99213\t\t1\t100.00\tA\t1234567893\t\t'); // line 0 has no annotation — blank trailing columns
    expect(lines[2]).toBe('2\t2026-05-07\t11\t73721\t26\t1\t40.00\tAB\t1234567893\tconfirm modifier\tDispute');
  });

  it('collapses tabs/newlines inside a note so the TSV grid never breaks', () => {
    const annotations = new Map<number, LineAnnotation>([[0, { note: 'line one\tline two\nline three', flag: null, checked: false }]]);
    const tsv = formatServiceLinesTsv(baseDetail(), annotations);
    expect(tsv.split('\n')[1]!.split('\t').length).toBe(11); // 9 base columns + Note + Flag, no extras from the embedded tab/newline
  });
});

describe('formatAnnotationsWorksheet', () => {
  it('says so plainly when there is nothing to copy yet', () => {
    expect(formatAnnotationsWorksheet([])).toBe(['Session notes & flags (not saved — cleared when this tab closes)', '', 'No lines have notes or flags yet.'].join('\n'));
  });

  it('always titles the worksheet as session-only, never saved', () => {
    const out = formatAnnotationsWorksheet([{ line: 1, flag: 'ok', note: '', checked: true }]);
    expect(out.split('\n')[0]).toBe('Session notes & flags (not saved — cleared when this tab closes)');
  });

  it('produces one tab-delimited row per annotated line, Checked as Yes/No text (never a raw boolean)', () => {
    const out = formatAnnotationsWorksheet([
      { line: 3, flag: 'dispute', note: 'upcoded — ask for chart notes', checked: false },
      { line: 5, flag: null, note: '', checked: true },
    ]);
    const lines = out.split('\n');
    expect(lines).toEqual([
      'Session notes & flags (not saved — cleared when this tab closes)',
      '',
      'Line\tFlag\tChecked\tNote',
      '3\tDispute\tNo\tupcoded — ask for chart notes',
      '5\tNo flag\tYes\t',
    ]);
  });
});

describe('formatDosSpan', () => {
  it('returns the single date when every line falls on one day', () => {
    expect(formatDosSpan(baseDetail().serviceLines)).toBe('2026-05-07');
  });

  it('returns an em-dash-separated span across the earliest FROM and latest THRU', () => {
    const lines = baseDetail().serviceLines;
    lines[0]!.dates = '2026-05-07';
    lines[1]!.dates = '2026-05-09 - 2026-05-12';
    expect(formatDosSpan(lines)).toBe('2026-05-07 – 2026-05-12');
  });

  it('returns an em-dash placeholder when there are no service lines', () => {
    expect(formatDosSpan([])).toBe('—');
  });
});

describe('formatClaimSummary', () => {
  it('produces the exact header-block text', () => {
    expect(formatClaimSummary(baseDetail())).toBe(
      [
        'Claim summary',
        'Patient account: ACCT-0001',
        'Dates of service: 2026-05-07',
        'Billing provider: SAMPLE CLINIC (NPI 1234567893)',
        'Form type: Professional — CMS-1500',
        'Service lines: 2',
        'Total charge: $140.00',
      ].join('\n'),
    );
  });

  it('falls back to em-dashes for a missing account number and billing provider', () => {
    const detail = baseDetail();
    detail.patient.accountNumber = '';
    detail.providers.billing.name = '';
    detail.providers.billing.npi = '';
    const text = formatClaimSummary(detail);
    expect(text).toContain('Patient account: —');
    expect(text).toContain('Billing provider: —');
  });
});

describe('reconciliationVerdict', () => {
  it('reads "Balanced" within the reconciliation tolerance', () => {
    expect(reconciliationVerdict(0)).toBe('Balanced');
    expect(reconciliationVerdict(0.004)).toBe('Balanced');
  });

  it('reads "Lines fall short by $X" when the claim total exceeds the line sum (positive delta)', () => {
    expect(reconciliationVerdict(412)).toBe('Lines fall short by $412.00');
  });

  it('reads "Lines exceed total by $X" when the line sum exceeds the claim total (negative delta)', () => {
    expect(reconciliationVerdict(-412)).toBe('Lines exceed total by $412.00');
  });
});

describe('formatWarningsAndReconciliation', () => {
  it('reports a clean reconciliation with no warnings', () => {
    expect(formatWarningsAndReconciliation(baseDetail())).toBe(
      [
        'Warnings & reconciliation',
        '',
        'Warnings: none — this claim reconciles cleanly.',
        '',
        'Reconciliation:',
        'Lines parsed: 2',
        'Sum of line charges: $140.00',
        'Claim total: $140.00',
        'Delta: $0.00',
        'Verdict: Balanced',
      ].join('\n'),
    );
  });

  it('numbers each warning with its severity word and reports a signed delta + verdict when the claim does not reconcile', () => {
    const detail = baseDetail();
    detail.serviceLines = [
      { ...detail.serviceLines[0]!, charge: 100 },
      { ...detail.serviceLines[1]!, charge: 40 },
      {
        line: 3,
        dates: '2026-05-07',
        placeOfService: '11',
        placeOfServiceDecoded: 'Office',
        procCode: '99213',
        modifiers: '',
        modifierDecodings: [],
        diagPointers: 'J',
        charge: 100,
        units: '1',
        revenueCode: '',
        revenueCodeDecoded: null,
        revenueDescription: '',
        toothNumbers: '',
        toothSurfaces: '',
      },
    ];
    detail.totals = { totalCharge: 1140, amountPaid: 0, sumOfLineCharges: 240, delta: 900 };
    detail.warnings = [
      { code: 'charge-total-mismatch', severity: 'warning', message: 'Line charges do not sum to the claim total.' },
      { code: 'diag-overflow', severity: 'info', message: 'Claim has more than 12 diagnoses; CMS-1500 shows A–L only.' },
    ];

    expect(formatWarningsAndReconciliation(detail)).toBe(
      [
        'Warnings & reconciliation',
        '',
        'Warnings (2):',
        '1. [Warning] Line charges do not sum to the claim total.',
        '2. [Note] Claim has more than 12 diagnoses; CMS-1500 shows A–L only.',
        '',
        'Reconciliation:',
        'Lines parsed: 3',
        'Sum of line charges: $240.00',
        'Claim total: $1140.00',
        'Delta: +$900.00',
        'Verdict: Lines fall short by $900.00',
      ].join('\n'),
    );
  });

  it('shows a negative signed delta and the "exceed" verdict when the line sum is larger than the claim total', () => {
    const detail = baseDetail();
    detail.totals = { totalCharge: 100, amountPaid: 0, sumOfLineCharges: 140, delta: -40 };
    const text = formatWarningsAndReconciliation(detail);
    expect(text).toContain('Delta: -$40.00');
    expect(text).toContain('Verdict: Lines exceed total by $40.00');
  });
});
