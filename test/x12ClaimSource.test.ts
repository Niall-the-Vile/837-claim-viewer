import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { tokenize, parseDelimiters, segmentToString } from '../src/sources/x12/tokenize.js';
import { renderCms1500 } from '../src/render/cms1500/renderCms1500.js';
import { renderUb04 } from '../src/render/ub04/renderUb04.js';
import { renderDental } from '../src/render/dental/renderDental.js';
import type { Claim } from '../src/model/claim.js';

const here = dirname(fileURLToPath(import.meta.url));
const jsonFixture = readFileSync(join(here, 'fixtures', 'synthetic-1500.json'), 'utf8');
const allFields = readFileSync(join(here, 'fixtures', 'x12', '837P-all-fields.dat'), 'utf8');
const minimal = readFileSync(join(here, 'fixtures', 'x12', '837P-minimal.dat'), 'utf8');
const inst837IAllFields = readFileSync(join(here, 'fixtures', 'x12', '837I-all-fields.dat'), 'utf8');
const inst837IMinimal = readFileSync(join(here, 'fixtures', 'x12', '837I-minimal.dat'), 'utf8');
const dental837DAllFields = readFileSync(join(here, 'fixtures', 'x12', '837D-all-fields.dat'), 'utf8');

const src = new X12ClaimSource();

describe('X12ClaimSource — canParse', () => {
  it('recognizes both 837P fixtures', () => {
    expect(src.canParse(allFields)).toBe(true);
    expect(src.canParse(minimal)).toBe(true);
  });

  it('rejects the JSON fixture and garbage', () => {
    expect(src.canParse(jsonFixture)).toBe(false);
    expect(src.canParse('not edi at all')).toBe(false);
    expect(src.canParse('')).toBe(false);
  });
});

function expectWellFormedCms1500(claim: Claim): void {
  expect(claim.formType).toBe('cms1500');
  expect(claim.claimId).not.toBe('');
  expect(claim.patient.name.last).not.toBe('');
  expect(claim.diagnoses.length).toBeGreaterThanOrEqual(1);
  expect(claim.serviceLines.length).toBeGreaterThanOrEqual(1);
  for (const line of claim.serviceLines) {
    expect(line.procCode).not.toBe('');
  }
}

describe('X12ClaimSource — parsing 837P-all-fields.dat', () => {
  it('parses without throwing and yields well-formed CMS-1500 claims', () => {
    const claims = src.parse(allFields);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectWellFormedCms1500(c);
  });

  it('maps the primary claim in detail (dependent patient != subscriber)', () => {
    const [claim] = src.parse(allFields);
    expect(claim!.claimId).toBe('36463774');
    expect(claim!.patient.name).toEqual({ last: 'SMITH', first: 'TED', middle: '' });
    expect(claim!.patient.relationshipToInsured).toBe('19'); // PAT01 on the 2000C loop.
    expect(claim!.insured.name).toEqual({ last: 'SMITH', first: 'JANE', middle: '' });
    expect(claim!.insured.memberId).toBe('JS00111223333');
    expect(claim!.payer.name).toBe('KEY INSURANCECOMPANY');
    expect(claim!.payer.order).toBe('Primary');
    expect(claim!.billingProvider.npi).toBe('9876543210');
    expect(claim!.billingProvider.taxId).toBe('587654321');
    expect(claim!.billingProvider.taxIdType).toBe('E');
    expect(claim!.renderingProvider.npi).toBe('1234567804');
    expect(claim!.referringProvider?.npi).toBe('5234567805');
    expect(claim!.facility?.npi).toBe('000000004');
    expect(claim!.diagnoses.map((d) => [d.pointer, d.code])).toEqual([
      ['A', 'J0300'],
      ['B', 'Z1159'],
    ]);
    expect(claim!.totals.totalCharge).toBe(100);
    expect(claim!.flags.acceptAssignment).toBe(true); // CLM07 = 'A'.
    expect(claim!.narrative).toBe('SURGERY WAS UNUSUALLY LONG');

    // First service line: SV1*HC:99299:26:27:28:29*40*UN*1*11**1:2**Y**Y*Y***0
    const line0 = claim!.serviceLines[0]!;
    expect(line0.procCode).toBe('99299');
    expect(line0.modifiers).toEqual(['26', '27', '28', '29']);
    expect(line0.charge).toBe(40);
    expect(line0.units).toBe('1');
    expect(line0.placeOfService).toBe('11');
    expect(line0.diagPointers).toEqual(['A', 'B']);
  });

  it('round-trips through renderCms1500 to a valid PDF', async () => {
    const [claim] = src.parse(allFields);
    const bytes = await renderCms1500(claim!);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('X12ClaimSource — parsing 837P-minimal.dat (canonical patient rule)', () => {
  it('parses without throwing and yields a well-formed CMS-1500 claim', () => {
    const claims = src.parse(minimal);
    expect(claims).toHaveLength(1);
    expectWellFormedCms1500(claims[0]!);
  });

  it('treats the subscriber as the patient (no 2000C loop) with self relationship', () => {
    const [claim] = src.parse(minimal);
    expect(claim!.patient.name).toEqual({ last: 'Smith', first: 'Jane', middle: '' });
    expect(claim!.patient.relationshipToInsured).toBe('18');
    expect(claim!.insured.name).toEqual(claim!.patient.name);
    expect(claim!.serviceLines[0]!.procCode).toBe('99213');
    expect(claim!.diagnoses.map((d) => d.code)).toEqual(['J020', 'Z1159']);
  });

  it('round-trips through renderCms1500 to a valid PDF', async () => {
    const [claim] = src.parse(minimal);
    const bytes = await renderCms1500(claim!);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});

function expectWellFormedUb04(claim: Claim): void {
  expect(claim.formType).toBe('ub04');
  expect(claim.claimId).not.toBe('');
  expect(claim.institutional).toBeDefined();
  expect(claim.institutional?.typeOfBill).not.toBe('');
  expect(claim.diagnoses.length).toBeGreaterThanOrEqual(1);
  expect(claim.serviceLines.length).toBeGreaterThanOrEqual(1);
  for (const line of claim.serviceLines) {
    expect(line.revenueCode).not.toBe('');
    expect(line.revenueCode).not.toBeUndefined();
  }
  // No more "not yet rendered" placeholder warning — 837I is fully mapped now.
  expect(claim.warnings.some((w) => w.code === 'form-not-yet-rendered')).toBe(false);
}

describe('X12ClaimSource — canParse (837I)', () => {
  it('recognizes both 837I fixtures', () => {
    expect(src.canParse(inst837IAllFields)).toBe(true);
    expect(src.canParse(inst837IMinimal)).toBe(true);
  });
});

describe('X12ClaimSource — parsing 837I-all-fields.dat (institutional)', () => {
  it('parses without throwing and yields well-formed UB-04 claims', () => {
    const claims = src.parse(inst837IAllFields);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectWellFormedUb04(c);
  });

  it('maps institutional claim-level fields in detail', () => {
    const [claim] = src.parse(inst837IAllFields);
    expect(claim!.claimId).toBe('ABC0002');
    expect(claim!.institutional!.typeOfBill).toBe('111'); // CLM05 "11:A:1" -> facility+class "11" + frequency "1".
    expect(claim!.institutional!.statementFrom).toBe('2019-03-10');
    expect(claim!.institutional!.statementThrough).toBe('2019-03-11');
    expect(claim!.institutional!.admissionDate).toBe('2019-03-10'); // DTP*435 DT format, date part only.
    expect(claim!.institutional!.admissionType).toBe('3');
    expect(claim!.institutional!.admissionSource).toBe('7');
    expect(claim!.institutional!.patientStatus).toBe('01');
    expect(claim!.institutional!.drg).toBe('025');
    expect(claim!.institutional!.admittingDiagnosis).toBe('H5988');
    expect(claim!.institutional!.principalProcedure).toEqual({ code: '009G0ZZ', date: '2017-10-03' });
    expect(claim!.institutional!.conditionCodes).toContain('03');
    expect(claim!.institutional!.conditionCodes.length).toBe(12);
    expect(claim!.institutional!.occurrenceCodes[0]).toEqual({ code: '40', date: '2016-01-03' });
    expect(claim!.institutional!.occurrenceSpans[0]).toEqual({ code: '71', from: '2016-01-03', through: '2016-01-08' });
    expect(claim!.institutional!.valueCodes[0]).toEqual({ code: '01', amount: 73.42 });

    // Diagnoses: principal (ABK) + others (ABF), POA carried from the composite's last component.
    expect(claim!.diagnoses).toEqual([
      { pointer: 'A', ordinal: 1, code: 'M24562', poa: 'N' },
      { pointer: 'B', ordinal: 2, code: 'E8359', poa: 'N' },
      { pointer: 'C', ordinal: 3, code: 'A0102', poa: 'Y' },
      { pointer: 'D', ordinal: 4, code: 'A0103', poa: 'Y' },
    ]);

    // First service line: SV2*0300*HC:81099:A1:05:02:01:Short description*173.42*UN*1**11.07
    const line0 = claim!.serviceLines[0]!;
    expect(line0.revenueCode).toBe('0300');
    expect(line0.revenueDescription).toBe('Short description');
    expect(line0.procCode).toBe('81099');
    expect(line0.modifiers).toEqual(['A1', '05', '02', '01']);
    expect(line0.charge).toBe(173.42);
    expect(line0.units).toBe('1');
    expect(line0.diagPointers).toEqual([]);
  });

  it('round-trips through renderUb04 to a valid PDF', async () => {
    const [claim] = src.parse(inst837IAllFields);
    const bytes = await renderUb04(claim!);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('X12ClaimSource — parsing 837I-minimal.dat (institutional)', () => {
  it('parses without throwing and yields a well-formed UB-04 claim', () => {
    const claims = src.parse(inst837IMinimal);
    expect(claims).toHaveLength(1);
    expectWellFormedUb04(claims[0]!);
  });

  it('maps fields present in a minimal 837I (no admission date, no DRG, no principal procedure)', () => {
    const [claim] = src.parse(inst837IMinimal);
    expect(claim!.institutional!.typeOfBill).toBe('141'); // CLM05 "14:A:1" -> "14" + "1".
    expect(claim!.institutional!.admissionDate).toBe(''); // no DTP*435 in this fixture.
    expect(claim!.institutional!.drg).toBe('');
    expect(claim!.institutional!.principalProcedure).toBeNull();
    expect(claim!.institutional!.admittingDiagnosis).toBe('');
    expect(claim!.diagnoses.map((d) => d.code)).toEqual(['H269', 'I10', 'R9431']);
    expect(claim!.serviceLines.map((l) => l.revenueCode)).toEqual(['0305', '0730']);
  });

  it('round-trips through renderUb04 to a valid PDF', async () => {
    const [claim] = src.parse(inst837IMinimal);
    const bytes = await renderUb04(claim!);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});

function expectWellFormedDental(claim: Claim): void {
  expect(claim.formType).toBe('dental');
  expect(claim.claimId).not.toBe('');
  expect(claim.dental).toBeDefined();
  expect(claim.serviceLines.length).toBeGreaterThanOrEqual(1);
  for (const line of claim.serviceLines) {
    expect(line.procCode).not.toBe(''); // CDT code
  }
}

describe('X12ClaimSource — canParse (837D)', () => {
  it('recognizes the 837D fixture', () => {
    expect(src.canParse(dental837DAllFields)).toBe(true);
  });
});

describe('X12ClaimSource — parsing 837D-all-fields.dat (dental)', () => {
  it('parses without throwing and yields well-formed dental claims', () => {
    const claims = src.parse(dental837DAllFields);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    for (const c of claims) expectWellFormedDental(c);
  });

  it('maps dental claim-level fields in detail', () => {
    const [claim] = src.parse(dental837DAllFields);
    expect(claim!.claimId).toBe('26403774');
    expect(claim!.dental).toBeDefined();
    expect(claim!.dental!.placeOfTreatment).toBe('11'); // CLM05-1.
    expect(claim!.dental!.predeterminationNumber).toBe('PredeterminationOfBenefitsId'); // claim-level REF*G3.
    expect(claim!.dental!.missingTeeth).toEqual(['9', '12']); // DN2 status 'M' only ('8' is status 'E', not missing).
    expect(claim!.dental!.orthodontics).toEqual({ monthsRemaining: '27', appliancePlacedDate: '' }); // DN1*36*27**Y -> DN102.
    expect(claim!.dental!.treatingDentist).toEqual({ last: 'DOE', first: 'JANE', middle: 'C' }); // NM1*82.
    expect(claim!.renderingProvider.npi).toBe('1234567804');

    // Transaction type has no reliable source in this corpus — stays blank with an info warning, never guessed.
    expect(claim!.dental!.transactionType).toBe('');
    expect(claim!.warnings.some((w) => w.code === 'dental-transaction-type-unknown')).toBe(true);

    expect(claim!.diagnoses.map((d) => [d.pointer, d.code])).toEqual([
      ['A', 'J0300'],
      ['B', 'Z1159'],
    ]);

    // First service line: SV3*AD:D2150*100*02*C1:C2*R*1*****1:2 + TOO*JP*12*M + TOO*JP*11*F:L:I
    const line0 = claim!.serviceLines[0]!;
    expect(line0.procCode).toBe('D2150');
    expect(line0.charge).toBe(100);
    expect(line0.toothNumbers).toBe('12, 11');
    expect(line0.toothSurfaces).toBe('M, FLI');
    expect(line0.oralCavityArea).toBe('C1-C2');

    // Second service line has no TOO segments at all.
    const line1 = claim!.serviceLines[1]!;
    expect(line1.procCode).toBe('D1110');
    expect(line1.toothNumbers).toBe('');
    expect(line1.toothSurfaces).toBe('');
  });

  it('round-trips through renderDental to a valid PDF', async () => {
    const [claim] = src.parse(dental837DAllFields);
    const bytes = await renderDental(claim!);
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('X12ClaimSource — error handling', () => {
  it('throws a friendly error on non-ISA input', () => {
    expect(() => src.parse('this is not edi')).toThrow(/ISA/);
  });

  it('throws a friendly error on a truncated ISA header', () => {
    expect(() => src.parse('ISA*00*only a few bytes')).toThrow(/ISA header/);
  });

  it('throws a friendly error when no ST*837 is present', () => {
    const noClaims =
      'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*0000*^*00501*000000001*0*T*:~' +
      'GS*HC*SENDER*RECEIVER*20230101*0000*1*X*005010X222A2~' +
      'GE*0*1~' +
      'IEA*1*000000001~';
    expect(() => src.parse(noClaims)).toThrow(/ST\*837/);
  });
});

describe('tokenize — delimiters read positionally, not hardcoded', () => {
  it('reads a non-default-delimiter ISA header (|, #, ;, \\n) and still parses the batch', () => {
    // Re-emit every segment of the minimal fixture with different element,
    // repetition, component, and segment delimiters. Swapping single-char
    // delimiters for other single chars (same element values/widths)
    // preserves the ISA's 106-byte length automatically.
    const { delimiters: origDelims, segments } = tokenize(minimal.trim());
    expect(origDelims).toEqual({ element: '*', repetition: '^', component: ':', segment: '~' });

    const newElement = '|';
    const newRepetition = '#';
    const newComponent = ';';
    const newSegmentTerm = '\n';

    const isaOld = segments.find((s) => s.id === 'ISA')!;
    const newIsaElements = isaOld.elements.slice();
    newIsaElements[10] = newRepetition; // ISA11 — repetition separator value.
    newIsaElements[15] = newComponent; // ISA16 — component separator value.

    // Composite elements (SV1's "HC:99213", HI's "ABK:J020", ...) embed the
    // OLD component separator literally in their value; swap it for the new
    // one everywhere so the re-emitted file is internally consistent.
    const recompose = (el: string) => el.split(origDelims.component).join(newComponent);

    const reEmitted =
      segments
        .map((s) => {
          const elements = s.id === 'ISA' ? newIsaElements : s.elements.map(recompose);
          return [s.id, ...elements].join(newElement);
        })
        .join(newSegmentTerm) + newSegmentTerm;

    expect(reEmitted.slice(0, 106)).toHaveLength(106);
    expect(parseDelimiters(reEmitted)).toEqual({
      element: newElement,
      repetition: newRepetition,
      component: newComponent,
      segment: newSegmentTerm,
    });

    const claims = src.parse(reEmitted);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    expect(claims[0]!.serviceLines[0]!.procCode).toBe('99213');
    expect(claims[0]!.diagnoses.map((d) => d.code)).toEqual(['J020', 'Z1159']);
  });
});

describe('segmentToString', () => {
  it('round-trips a segment back to X12 text using the interchange delimiters', () => {
    const { delimiters, segments } = tokenize(minimal.trim());
    const clm = segments.find((s) => s.id === 'CLM')!;
    expect(segmentToString(clm, delimiters)).toBe('CLM*26463774*100***11:B:1*Y*A*Y*I');
  });
});
