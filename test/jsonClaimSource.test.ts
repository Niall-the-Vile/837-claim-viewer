import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  JsonClaimSource,
  isValidNpi,
  splitPointers,
  pointerLetter,
  validateClaim,
} from '../src/sources/json/jsonClaimSource.js';
import type { Claim } from '../src/model/claim.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'synthetic-1500.json'), 'utf8');
const src = new JsonClaimSource();

function parseFixture(): Claim {
  const claims = src.parse(fixture);
  expect(claims).toHaveLength(1);
  return claims[0]!;
}

describe('JsonClaimSource — mapping', () => {
  it('recognizes the file', () => {
    expect(src.canParse(fixture)).toBe(true);
    expect(src.canParse('not json')).toBe(false);
    expect(src.canParse('{"foo":1}')).toBe(false); // no claim_form
  });

  it('maps identity and form type', () => {
    const c = parseFixture();
    expect(c.claimId).toBe('900000001');
    expect(c.claimFormRaw).toBe('1500');
    expect(c.formType).toBe('cms1500');
  });

  it('maps patient and insured', () => {
    const c = parseFixture();
    expect(c.patient.name).toEqual({ last: 'SAMPLEPATIENT', first: 'PAT', middle: 'Q' });
    expect(c.patient.dob).toBe('1980-01-15');
    expect(c.patient.relationshipToInsured).toBe('18');
    expect(c.patient.accountNumber).toBe('ACCT-0001');
    expect(c.insured.memberId).toBe('MEMBER001');
    expect(c.insured.group).toBe('GRP1');
  });

  it('maps diagnoses with A–L pointer letters', () => {
    const c = parseFixture();
    expect(c.diagnoses.map((d) => [d.pointer, d.code])).toEqual([
      ['A', 'M545'],
      ['B', 'M25561'],
    ]);
  });

  it('maps service lines incl. modifiers and multi-letter pointers', () => {
    const c = parseFixture();
    expect(c.serviceLines).toHaveLength(2);
    expect(c.serviceLines[0]!.procCode).toBe('99213');
    expect(c.serviceLines[0]!.diagPointers).toEqual(['A']);
    expect(c.serviceLines[1]!.procCode).toBe('73721');
    expect(c.serviceLines[1]!.modifiers).toEqual(['26']);
    expect(c.serviceLines[1]!.diagPointers).toEqual(['A', 'B']);
    expect(c.serviceLines[0]!.charge).toBeCloseTo(100, 5);
  });

  it('produces no warnings for a clean claim (reconciliation, NPI)', () => {
    const c = parseFixture();
    expect(c.warnings).toEqual([]);
  });
});

describe('helpers', () => {
  it('pointerLetter maps 1..12 -> A..L and beyond -> ""', () => {
    expect(pointerLetter(1)).toBe('A');
    expect(pointerLetter(12)).toBe('L');
    expect(pointerLetter(13)).toBe('');
  });

  it('splitPointers keeps only A–L letters', () => {
    expect(splitPointers('ABCD')).toEqual(['A', 'B', 'C', 'D']);
    expect(splitPointers('E')).toEqual(['E']);
    expect(splitPointers('')).toEqual([]);
  });

  it('isValidNpi checks the 80840-prefixed Luhn', () => {
    expect(isValidNpi('1234567893')).toBe(true); // canonical valid NPI
    expect(isValidNpi('1234567890')).toBe(false);
    expect(isValidNpi('123')).toBe(false);
    expect(isValidNpi('0')).toBe(false);
  });
});

describe('validation warnings', () => {
  it('flags a charge/total mismatch', () => {
    const [c] = src.parse(
      JSON.stringify({
        claimid: 'x',
        claim_form: '1500',
        total_charge: '200.00',
        bill_npi: '1234567893',
        charge: [{ proc_code: '99213', charge: '100.00', diag_ref: 'A', units: '1' }],
        diag_1: 'A001',
      }),
    );
    expect(c!.warnings.some((w) => w.code === 'charge-total-mismatch')).toBe(true);
  });

  it('flags a dangling diagnosis pointer', () => {
    const [c] = src.parse(
      JSON.stringify({
        claimid: 'x',
        claim_form: '1500',
        total_charge: '100.00',
        bill_npi: '1234567893',
        charge: [{ proc_code: '99213', charge: '100.00', diag_ref: 'B', units: '1' }],
        diag_1: 'A001',
      }),
    );
    expect(c!.warnings.some((w) => w.code === 'dangling-diag-pointer')).toBe(true);
  });

  it('flags an unsupported claim_form but still returns a claim', () => {
    const [c] = src.parse(JSON.stringify({ claimid: 'x', claim_form: 'UB', charge: [] }));
    expect(c!.formType).toBe('unsupported');
    expect(c!.warnings.some((w) => w.code === 'unsupported-form')).toBe(true);
  });

  it('throws a friendly error on non-JSON', () => {
    expect(() => src.parse('<xml/>')).toThrow(/not valid JSON/);
  });
});
