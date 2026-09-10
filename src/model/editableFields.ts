import type { Claim } from './claim.js';

/**
 * Editable-field registry for the "corrected claim" feature (see
 * docs/EDITABLE_FIELDS_DESIGN.md). This is the ONE place that decides which
 * leaf fields of the normalized `Claim` model may ever be overridden by a
 * user, how a raw string typed into the inspector is validated/normalized
 * into that field's real type, and how to read a field's current value back
 * out as a string for display.
 *
 * Deliberately a fixed, curated allowlist rather than a generic path
 * evaluator: an arbitrary "dot-path into an object" setter would let a bug
 * (or a corrupted/hand-edited corrected-claims.json — see
 * correctedClaimStore.ts) write into a field nobody ever intended to be
 * editable (e.g. `warnings` or `raw`), which is exactly the kind of "quietly
 * misrepresents the data" failure this feature must never allow. Every
 * fieldPath string below is a literal this module recognizes explicitly;
 * anything else is rejected by `findEditableField` returning `null`.
 *
 * Scope is intentionally bounded to unambiguous SCALAR fields that map
 * 1:1 onto a single already-rendered value — patient/insured/provider
 * identifiers and per-line clinical/billing codes. Composed display fields
 * (patient name, any address) are deliberately NOT editable here: they are
 * assembled from several source fields (`Name`/`Address`) via
 * `composeName`/`composeAddressLine` in electron/main.ts, and reliably
 * decomposing an edited composite string back into its parts is a separate,
 * harder problem this build defers (see the design doc's "Deferred" list).
 */

export type EditableFieldKind = 'text' | 'money' | 'units';

export interface EditableFieldSpec {
  /** Stable path string identifying this field on ONE claim — see the design doc's addressing scheme. Never includes the claim index; that's prefixed separately (`${claimIndex}::${fieldPath}`) by the persistence layer / IPC. */
  fieldPath: string;
  /** Human-readable label, matching (or close to) the inspector row it corresponds to. */
  label: string;
  kind: EditableFieldKind;
  /** Reads the field's current string value off `claim`. */
  getValue: (claim: Claim) => string;
  /**
   * Validates + writes `raw` into `claim` IN PLACE. Throws a plain `Error`
   * with a user-facing message on invalid input — callers must apply this to
   * a disposable clone (never the original parsed claim; see
   * `applyFieldOverrides` below and, in electron/main.ts, the fact that the
   * `ClaimSession`'s original `Claim` array is never mutated by any override
   * path).
   */
  setValue: (claim: Claim, raw: string) => void;
}

function requireServiceLine(claim: Claim, index: number): Claim['serviceLines'][number] {
  const line = claim.serviceLines[index];
  if (!line) throw new Error(`No service line at index ${index}.`);
  return line;
}

function requireDiagnosis(claim: Claim, index: number): Claim['diagnoses'][number] {
  const dx = claim.diagnoses[index];
  if (!dx) throw new Error(`No diagnosis at index ${index}.`);
  return dx;
}

function parseMoney(raw: string): number {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(value)) throw new Error(`"${raw}" is not a valid dollar amount.`);
  if (value < 0) throw new Error('Charge cannot be negative.');
  return Math.round(value * 100) / 100;
}

function parseUnits(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw new Error('Units cannot be blank.');
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) throw new Error(`"${raw}" is not a valid unit count.`);
  return trimmed;
}

function parseModifiers(raw: string): string[] {
  const parts = raw
    .toUpperCase()
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length > 4) throw new Error('At most 4 modifiers are allowed.');
  for (const p of parts) {
    if (!/^[A-Z0-9]{2}$/.test(p)) throw new Error(`"${p}" is not a valid 2-character modifier.`);
  }
  return parts;
}

/** Claim-level fields — same for every service line/diagnosis count. */
export function claimLevelFieldSpecs(): EditableFieldSpec[] {
  return [
    {
      fieldPath: 'patient.dob',
      label: 'Patient date of birth',
      kind: 'text',
      getValue: (c) => c.patient.dob,
      setValue: (c, raw) => {
        c.patient.dob = raw.trim();
      },
    },
    {
      fieldPath: 'patient.phone',
      label: 'Patient phone',
      kind: 'text',
      getValue: (c) => c.patient.phone,
      setValue: (c, raw) => {
        c.patient.phone = raw.trim();
      },
    },
    {
      fieldPath: 'patient.accountNumber',
      label: 'Patient account number',
      kind: 'text',
      getValue: (c) => c.patient.accountNumber,
      setValue: (c, raw) => {
        c.patient.accountNumber = raw.trim();
      },
    },
    {
      fieldPath: 'insured.memberId',
      label: 'Insured member ID',
      kind: 'text',
      getValue: (c) => c.insured.memberId,
      setValue: (c, raw) => {
        c.insured.memberId = raw.trim();
      },
    },
    {
      fieldPath: 'insured.group',
      label: 'Insured group',
      kind: 'text',
      getValue: (c) => c.insured.group,
      setValue: (c, raw) => {
        c.insured.group = raw.trim();
      },
    },
    {
      fieldPath: 'billingProvider.npi',
      label: 'Billing provider NPI',
      kind: 'text',
      getValue: (c) => c.billingProvider.npi,
      setValue: (c, raw) => {
        const trimmed = raw.trim();
        if (trimmed !== '' && !/^\d{10}$/.test(trimmed)) throw new Error('NPI must be exactly 10 digits.');
        c.billingProvider.npi = trimmed;
      },
    },
    {
      fieldPath: 'billingProvider.taxId',
      label: 'Billing provider tax ID',
      kind: 'text',
      getValue: (c) => c.billingProvider.taxId,
      setValue: (c, raw) => {
        c.billingProvider.taxId = raw.trim();
      },
    },
    {
      fieldPath: 'renderingProvider.npi',
      label: 'Rendering provider NPI',
      kind: 'text',
      getValue: (c) => c.renderingProvider.npi,
      setValue: (c, raw) => {
        const trimmed = raw.trim();
        if (trimmed !== '' && !/^\d{10}$/.test(trimmed)) throw new Error('NPI must be exactly 10 digits.');
        c.renderingProvider.npi = trimmed;
      },
    },
  ];
}

export function serviceLineFieldSpecs(claim: Claim, index: number): EditableFieldSpec[] {
  const line = claim.serviceLines[index];
  if (!line) return [];
  const specs: EditableFieldSpec[] = [
    {
      fieldPath: `serviceLines[${index}].procCode`,
      label: `Line ${index + 1} procedure/HCPCS code`,
      kind: 'text',
      getValue: (c) => requireServiceLine(c, index).procCode,
      setValue: (c, raw) => {
        requireServiceLine(c, index).procCode = raw.trim().toUpperCase();
      },
    },
    {
      fieldPath: `serviceLines[${index}].modifiers`,
      label: `Line ${index + 1} modifiers`,
      kind: 'text',
      getValue: (c) => requireServiceLine(c, index).modifiers.join(' '),
      setValue: (c, raw) => {
        requireServiceLine(c, index).modifiers = parseModifiers(raw);
      },
    },
    {
      fieldPath: `serviceLines[${index}].units`,
      label: `Line ${index + 1} units`,
      kind: 'units',
      getValue: (c) => requireServiceLine(c, index).units,
      setValue: (c, raw) => {
        requireServiceLine(c, index).units = parseUnits(raw);
      },
    },
    {
      fieldPath: `serviceLines[${index}].charge`,
      label: `Line ${index + 1} charge`,
      kind: 'money',
      getValue: (c) => requireServiceLine(c, index).charge.toFixed(2),
      setValue: (c, raw) => {
        requireServiceLine(c, index).charge = parseMoney(raw);
      },
    },
  ];
  return specs;
}

export function diagnosisFieldSpecs(claim: Claim, index: number): EditableFieldSpec[] {
  const dx = claim.diagnoses[index];
  if (!dx) return [];
  return [
    {
      fieldPath: `diagnoses[${index}].code`,
      label: `Diagnosis ${dx.pointer || `#${dx.ordinal}`} code`,
      kind: 'text',
      getValue: (c) => requireDiagnosis(c, index).code,
      setValue: (c, raw) => {
        requireDiagnosis(c, index).code = raw.trim().toUpperCase();
      },
    },
  ];
}

/** Every editable field applicable to `claim`, in a stable display order. */
export function editableFieldsForClaim(claim: Claim): EditableFieldSpec[] {
  const specs = [...claimLevelFieldSpecs()];
  claim.serviceLines.forEach((_line, i) => specs.push(...serviceLineFieldSpecs(claim, i)));
  claim.diagnoses.forEach((_dx, i) => specs.push(...diagnosisFieldSpecs(claim, i)));
  return specs;
}

export function findEditableField(claim: Claim, fieldPath: string): EditableFieldSpec | null {
  return editableFieldsForClaim(claim).find((s) => s.fieldPath === fieldPath) ?? null;
}

/** A deep clone of a `Claim` — plain-data only (no Date/function/class instances anywhere in the model), so a JSON round-trip is a safe, fully-typed way to clone it without depending on `structuredClone`'s DOM-only type declarations under this package's Node-only tsconfig (see this file's header). */
export function cloneClaim(claim: Claim): Claim {
  return JSON.parse(JSON.stringify(claim)) as Claim;
}

export interface AppliedFieldEdit {
  fieldPath: string;
  label: string;
  originalValue: string;
  currentValue: string;
}

export interface ApplyFieldOverridesResult {
  /** A NEW claim (never the same object as `original`) with every valid, recognized override in `overrides` applied. `original` itself is never mutated. */
  claim: Claim;
  /** One entry per override that was actually recognized and applied, in registry order — never one for a key that didn't match a known field or that failed validation (both are skipped defensively, the same "never fail on a corrupted stored value" posture as sessionStore.ts's `sanitize`). */
  applied: AppliedFieldEdit[];
}

/**
 * Applies `overrides` (a `fieldPath -> raw string` map, already stripped of
 * its claim-index prefix by the caller — see correctedClaimStore.ts) onto a
 * FRESH CLONE of `original`. `original` is read from for every
 * `originalValue` but is never itself mutated or returned — every caller
 * (electron/main.ts) keeps the session's parsed `Claim[]` untouched forever,
 * which is what makes invariant 4 (warnings/reconciliation are always
 * computed against the original parse) hold automatically: this function
 * never touches `claim.warnings`, so the returned claim's `warnings` array
 * is byte-for-byte the same content the original parse produced.
 *
 * An override key that doesn't match a known field, or whose value fails
 * that field's own validation (e.g. a corrupted/hand-edited
 * corrected-claims.json), is silently skipped rather than thrown — the rest
 * of the claim must still render.
 */
export function applyFieldOverrides(original: Claim, overrides: Record<string, string>): ApplyFieldOverridesResult {
  const claim = cloneClaim(original);
  const applied: AppliedFieldEdit[] = [];
  for (const spec of editableFieldsForClaim(claim)) {
    const raw = overrides[spec.fieldPath];
    if (raw === undefined) continue;
    const originalValue = spec.getValue(original);
    try {
      spec.setValue(claim, raw);
    } catch {
      continue;
    }
    applied.push({ fieldPath: spec.fieldPath, label: spec.label, originalValue, currentValue: spec.getValue(claim) });
  }
  return { claim, applied };
}
