import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';
import { renderCms1500 } from '../src/render/cms1500/renderCms1500.js';
import type { Claim, ServiceLine } from '../src/model/claim.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'synthetic-1500.json'), 'utf8');
const src = new JsonClaimSource();

function loadFixtureClaim(): Claim {
  const claims = src.parse(fixture);
  expect(claims).toHaveLength(1);
  return claims[0]!;
}

function bytesToText(bytes: Uint8Array, length: number): string {
  return Buffer.from(bytes.slice(0, length)).toString('latin1');
}

/** Builds a synthetic service line (all synthetic test data — no PHI). */
function makeLine(i: number): ServiceLine {
  return {
    fromDate: '2026-05-07',
    thruDate: '2026-05-07',
    placeOfService: '11',
    procCode: `9921${i % 10}`,
    modifiers: [],
    diagPointers: ['A'],
    charge: 25 + i,
    units: '1',
    chargeId: `L${i}`,
    patientResponsibility: 0,
  };
}

function withServiceLines(claim: Claim, count: number): Claim {
  const lines = Array.from({ length: count }, (_, i) => makeLine(i));
  const totalCharge = lines.reduce((sum, l) => sum + l.charge, 0);
  return {
    ...claim,
    serviceLines: lines,
    totals: { ...claim.totals, totalCharge },
  };
}

describe('renderCms1500 — basic rendering', () => {
  it('renders the synthetic fixture to a valid one-page PDF', async () => {
    const claim = loadFixtureClaim();
    const bytes = await renderCms1500(claim);

    expect(bytesToText(bytes, 5)).toBe('%PDF-');

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    const page = loaded.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });
});

describe('renderCms1500 — pagination', () => {
  it('paginates 13 service lines across 3 pages of 612x792, dropping none', async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, 13);

    const bytes = await renderCms1500(claim);
    const loaded = await PDFDocument.load(bytes);

    expect(loaded.getPageCount()).toBe(3); // ceil(13 / 6)
    for (let i = 0; i < loaded.getPageCount(); i++) {
      const { width, height } = loaded.getPage(i).getSize();
      expect(width).toBe(612);
      expect(height).toBe(792);
    }
  });

  it('does not paginate at exactly 6 lines (still 1 page)', async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, 6);
    const bytes = await renderCms1500(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('paginates to 2 pages at 7 lines', async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, 7);
    const bytes = await renderCms1500(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
  });
});

describe('renderCms1500 — determinism', () => {
  it('renders byte-identical output for the same claim twice', async () => {
    const claim = loadFixtureClaim();
    const a = await renderCms1500(claim);
    const b = await renderCms1500(claim);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('renders byte-identical output across a fresh claim parse (not just object identity)', async () => {
    const claimA = loadFixtureClaim();
    const claimB = loadFixtureClaim();
    const a = await renderCms1500(claimA);
    const b = await renderCms1500(claimB);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('renderCms1500 — safe text handling', () => {
  it('renders a patient name with a character outside WinAnsi without throwing', async () => {
    const base = loadFixtureClaim();
    const claim: Claim = {
      ...base,
      patient: { ...base.patient, name: { last: 'MUÑOZ', first: 'JOŠE', middle: '' } },
    };
    const bytes = await renderCms1500(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('renders a claim with entirely blank optional fields without throwing', async () => {
    const bytes = await renderCms1500({
      claimId: '',
      formType: 'cms1500',
      claimFormRaw: '1500',
      patient: {
        name: { last: '', first: '', middle: '' },
        dob: '',
        sex: '',
        address: { line1: '', line2: '', city: '', state: '', zip: '' },
        phone: '',
        relationshipToInsured: '',
        accountNumber: '',
      },
      insured: {
        name: { last: '', first: '', middle: '' },
        memberId: '',
        group: '',
        plan: '',
        dob: '',
        sex: '',
        address: { line1: '', line2: '', city: '', state: '', zip: '' },
        employer: '',
      },
      payer: { name: '', id: '', address: { line1: '', line2: '', city: '', state: '', zip: '' }, order: '' },
      otherInsurance: null,
      billingProvider: {
        name: '',
        npi: '',
        taxId: '',
        taxIdType: '',
        address: { line1: '', line2: '', city: '', state: '', zip: '' },
        phone: '',
        taxonomy: '',
      },
      renderingProvider: { name: { last: '', first: '', middle: '' }, npi: '', taxonomy: '' },
      referringProvider: null,
      facility: null,
      diagnoses: [],
      serviceLines: [],
      totals: { totalCharge: 0, amountPaid: 0 },
      flags: { acceptAssignment: false, autoAccident: false, autoAccidentState: '', employmentRelated: false, priorAuth: '' },
      hospitalization: null,
      narrative: '',
      cliaNumber: '',
      raw: {},
      warnings: [],
    });
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});
