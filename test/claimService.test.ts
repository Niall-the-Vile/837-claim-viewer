import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadClaims, renderClaim, claimSummary } from '../src/app/claimService.js';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';

const here = dirname(fileURLToPath(import.meta.url));
const jsonFixture = readFileSync(join(here, 'fixtures', 'synthetic-1500.json'), 'utf8');
const x12Cms1500 = readFileSync(join(here, 'fixtures', 'x12', '837P-all-fields.dat'), 'utf8');
const x12Ub04 = readFileSync(join(here, 'fixtures', 'x12', '837I-all-fields.dat'), 'utf8');
const x12Dental = readFileSync(join(here, 'fixtures', 'x12', '837D-all-fields.dat'), 'utf8');

function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.slice(0, 5)).toString('latin1') === '%PDF-';
}

describe('claimService.loadClaims — source detection', () => {
  it('recognizes the JSON clearinghouse fixture and yields one cms1500 claim', () => {
    const { source, claims } = loadClaims(jsonFixture);
    expect(source).toBe('json');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.formType).toBe('cms1500');
  });

  it('recognizes 837P/837I/837D fixtures as the x12 source with the expected form type', () => {
    const professional = loadClaims(x12Cms1500);
    expect(professional.source).toBe('x12');
    expect(professional.claims.length).toBeGreaterThanOrEqual(1);
    expect(professional.claims[0]!.formType).toBe('cms1500');

    const institutional = loadClaims(x12Ub04);
    expect(institutional.source).toBe('x12');
    expect(institutional.claims.length).toBeGreaterThanOrEqual(1);
    expect(institutional.claims[0]!.formType).toBe('ub04');

    const dental = loadClaims(x12Dental);
    expect(dental.source).toBe('x12');
    expect(dental.claims.length).toBeGreaterThanOrEqual(1);
    expect(dental.claims[0]!.formType).toBe('dental');
  });

  it('throws a friendly ClaimParseError for input neither source recognizes', () => {
    expect(() => loadClaims('this is not a claim file')).toThrow(/valid claim JSON or 837/);
    expect(() => loadClaims('')).toThrow(/valid claim JSON or 837/);
  });
});

describe('claimService.renderClaim — PDF dispatch by form type', () => {
  it('renders %PDF- bytes for cms1500 (JSON source)', async () => {
    const { claims } = loadClaims(jsonFixture);
    const bytes = await renderClaim(claims[0]!);
    expect(isPdf(bytes)).toBe(true);
  });

  it('renders %PDF- bytes for cms1500, ub04, and dental (X12 source)', async () => {
    const cms1500 = await renderClaim(loadClaims(x12Cms1500).claims[0]!);
    expect(isPdf(cms1500)).toBe(true);

    const ub04 = await renderClaim(loadClaims(x12Ub04).claims[0]!);
    expect(isPdf(ub04)).toBe(true);

    const dental = await renderClaim(loadClaims(x12Dental).claims[0]!);
    expect(isPdf(dental)).toBe(true);
  });

  it('renders a %PDF- placeholder (not a throw) for an unsupported form type', async () => {
    const src = new JsonClaimSource();
    const [claim] = src.parse(JSON.stringify({ claimid: 'x1', claim_form: 'UNKNOWN-FORM', charge: [] }));
    expect(claim!.formType).toBe('unsupported');
    const bytes = await renderClaim(claim!);
    expect(isPdf(bytes)).toBe(true);
  });
});

describe('claimService.claimSummary', () => {
  it('projects the fields the open-file result / stepper UI needs', () => {
    const { claims } = loadClaims(jsonFixture);
    const summary = claimSummary(claims[0]!);
    expect(summary).toEqual({
      claimId: '900000001',
      formType: 'cms1500',
      patientName: 'SAMPLEPATIENT, PAT Q',
      total: 140,
      warningCount: 0,
    });
  });

  it('reports the warning count for a claim with data issues', () => {
    const src = new JsonClaimSource();
    const [claim] = src.parse(
      JSON.stringify({
        claimid: 'x2',
        claim_form: '1500',
        total_charge: '200.00',
        bill_npi: '1234567893',
        charge: [{ proc_code: '99213', charge: '100.00', diag_ref: 'A', units: '1' }],
        diag_1: 'A001',
      }),
    );
    const summary = claimSummary(claim!);
    expect(summary.warningCount).toBeGreaterThan(0);
  });
});
