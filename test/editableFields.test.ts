import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { editableFieldsForClaim, findEditableField, applyFieldOverrides, cloneClaim } from '../src/model/editableFields.js';

/**
 * Unit tests for the editable-field registry (docs/EDITABLE_FIELDS_DESIGN.md).
 * Pure model-level tests — no Electron, no IPC, no DOM — mirroring how
 * test/validate.test.ts and friends exercise src/model/** directly.
 */

const here = dirname(fileURLToPath(import.meta.url));
const jsonSrc = new JsonClaimSource();
const x12Src = new X12ClaimSource();

function fixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', ...parts), 'utf8');
}

describe('cloneClaim', () => {
  it('returns a deep, independent copy', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const clone = cloneClaim(claim);
    expect(clone).toEqual(claim);
    expect(clone).not.toBe(claim);
    clone.patient.accountNumber = 'CHANGED';
    expect(claim.patient.accountNumber).not.toBe('CHANGED');
  });
});

describe('editableFieldsForClaim', () => {
  it('lists claim-level fields plus one set per service line and per diagnosis', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const specs = editableFieldsForClaim(claim);
    const paths = specs.map((s) => s.fieldPath);
    expect(paths).toContain('patient.accountNumber');
    expect(paths).toContain('billingProvider.npi');
    expect(paths.filter((p) => p.startsWith('serviceLines[0].'))).toHaveLength(4);
    expect(paths.filter((p) => p.startsWith('diagnoses[0].'))).toHaveLength(1);
    // No duplicate field paths.
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never exposes a field for an out-of-range line/diagnosis index', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const paths = editableFieldsForClaim(claim).map((s) => s.fieldPath);
    expect(paths.some((p) => p.startsWith(`serviceLines[${claim.serviceLines.length}].`))).toBe(false);
  });
});

describe('findEditableField', () => {
  it('finds a known field and returns null for an unrecognized path', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    expect(findEditableField(claim, 'patient.accountNumber')).not.toBeNull();
    expect(findEditableField(claim, 'warnings')).toBeNull();
    expect(findEditableField(claim, 'raw')).toBeNull();
    expect(findEditableField(claim, 'patient.name.last')).toBeNull(); // composed field — deliberately not editable
  });
});

describe('applyFieldOverrides', () => {
  it('applies a valid override to a clone and never mutates the original claim', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const originalAccountNumber = claim.patient.accountNumber;
    const { claim: effective, applied } = applyFieldOverrides(claim, { 'patient.accountNumber': 'FIXED-123' });

    expect(effective.patient.accountNumber).toBe('FIXED-123');
    expect(claim.patient.accountNumber).toBe(originalAccountNumber); // original untouched
    expect(applied).toEqual([
      { fieldPath: 'patient.accountNumber', label: 'Patient account number', originalValue: originalAccountNumber, currentValue: 'FIXED-123' },
    ]);
  });

  it('never changes warnings — invariant: warnings are always computed against the original parse', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const { claim: effective } = applyFieldOverrides(claim, {
      'serviceLines[0].charge': '999999.00', // would trip charge-total-mismatch if warnings were recomputed
    });
    expect(effective.warnings).toEqual(claim.warnings);
  });

  it('silently skips an override whose key is not a recognized field', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const { claim: effective, applied } = applyFieldOverrides(claim, { 'not.a.real.field': 'x', warnings: 'y' });
    expect(applied).toEqual([]);
    expect(effective).toEqual(claim);
  });

  it('silently skips an override whose value fails validation (e.g. a corrupted stored NPI)', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const originalNpi = claim.billingProvider.npi;
    const { claim: effective, applied } = applyFieldOverrides(claim, { 'billingProvider.npi': 'not-an-npi' });
    expect(applied).toEqual([]);
    expect(effective.billingProvider.npi).toBe(originalNpi);
  });

  it('applies a service-line charge/units/procCode/modifiers override', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const { claim: effective, applied } = applyFieldOverrides(claim, {
      'serviceLines[0].charge': '150.5',
      'serviceLines[0].units': '2',
      'serviceLines[0].procCode': '99214',
      'serviceLines[0].modifiers': '25 lt',
    });
    expect(effective.serviceLines[0]!.charge).toBe(150.5);
    expect(effective.serviceLines[0]!.units).toBe('2');
    expect(effective.serviceLines[0]!.procCode).toBe('99214');
    expect(effective.serviceLines[0]!.modifiers).toEqual(['25', 'LT']);
    expect(applied).toHaveLength(4);
  });

  it('rejects a negative or non-numeric charge', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const originalCharge = claim.serviceLines[0]!.charge;
    const { claim: effective, applied } = applyFieldOverrides(claim, { 'serviceLines[0].charge': '-5' });
    expect(applied).toEqual([]);
    expect(effective.serviceLines[0]!.charge).toBe(originalCharge);
  });

  it('applies a diagnosis code override, keyed by that diagnosis index', () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const { claim: effective, applied } = applyFieldOverrides(claim, { 'diagnoses[0].code': 'Z00.00' });
    expect(effective.diagnoses[0]!.code).toBe('Z00.00');
    expect(applied).toHaveLength(1);
  });

  it('works on an institutional (UB-04) claim too', () => {
    const claim = x12Src.parse(fixture('x12', '837I-minimal.dat'))[0]!;
    const { claim: effective, applied } = applyFieldOverrides(claim, { 'patient.accountNumber': 'UB-ACCT-9' });
    expect(effective.patient.accountNumber).toBe('UB-ACCT-9');
    expect(applied).toHaveLength(1);
  });
});
