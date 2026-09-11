import type { Claim } from '../../model/claim.js';
import type { AppliedFieldEdit } from '../../model/editableFields.js';
import { composeName, composeAddressLine } from '../../render/text.js';

/**
 * Structured CSV/JSON export of the normalized claim model
 * (docs/BUILD_QUEUE.md Build 4.3, docs/CLAUDE_CODE_NEXT_SESSION.md's Build 4
 * CSV/JSON decisions). Pure, Electron-free string formatters —
 * electron/main.ts's `dialog:exportCsv`/`dialog:exportJson` handlers are the
 * only callers, writing the returned string with the existing
 * `writeFileAtomic`. Deliberately operates on the normalized `Claim` model
 * itself (already effective — overrides applied — plus the
 * `AppliedFieldEdit[]` that produced it) rather than any IPC DTO shape, so
 * this is a faithful, predictable export close to the app's own model per
 * the task's design goal, and is directly unit-testable with plain `Claim`
 * fixtures (same pattern as test/validate.test.ts / test/editableFields.test.ts).
 *
 * PHI-minimal-by-default (docs/CLAUDE_CODE_NEXT_SESSION.md "Decisions made
 * this session"): every claim/service-line identifier, code, amount, date,
 * and provider field is always included. Patient/insured IDENTIFYING fields
 * (name, DOB, address, phone, full member ID) are included ONLY when
 * `options.includeIdentifiers` is explicitly `true` — every column/value
 * this module could ever add for that case is gated on that single boolean,
 * checked exactly once per field (never inferred from anything else), so
 * there is no code path that includes an identifier while the flag is
 * false. The patient's ACCOUNT NUMBER is not treated as an identifier here
 * (it is a billing office-assigned control number, not directly identifying
 * without an external lookup) and is included in the PHI-minimal default,
 * matching this build's task brief.
 *
 * EDITED marking (mandatory, per docs/EDITABLE_FIELDS_DESIGN.md invariant 6,
 * extended to every export format by this build): every claim's row(s)
 * carry a `claimEdited`/`editedFieldLabels` (CSV) or `edited`/`edits` (JSON)
 * indicator whenever ANY field override is active on it — computed directly
 * from the SAME `applied` array `applyFieldOverrides` produced for the claim
 * being exported, the identical source of truth the PDF path's mandatory
 * stamp uses (electron/main.ts's `dialog:exportPdf`/batch-export handlers).
 * There is no code path in this module that can see a non-empty `applied`
 * array and not surface it — see buildCsvExport/buildJsonExport below.
 */

export interface EffectiveClaimForExport {
  claim: Claim;
  applied: AppliedFieldEdit[];
}

export interface StructuredExportOptions {
  includeIdentifiers: boolean;
}

/** Placeholder value for every redacted identifier column/field — a fixed sentinel string (never `null`/an omitted key) so the export's shape/column count never changes between the two profiles; only the VALUES do. */
export const REDACTED = '[not included — identifiers opt-in]';

function editedFieldLabelsFor(applied: AppliedFieldEdit[]): string {
  return applied.map((a) => a.label).join('; ');
}

function lineIsEdited(applied: AppliedFieldEdit[], lineIndex: number): boolean {
  const prefix = `serviceLines[${lineIndex}].`;
  return applied.some((a) => a.fieldPath.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Header-level + service-line columns always present, regardless of the
 * identifiers profile. Order here IS the emitted column order — keep
 * CSV_COLUMNS_BASE and every row-builder below in sync (test/structuredExport.test.ts
 * asserts the header row and every data row against this exact list, not a
 * spot check).
 */
export const CSV_COLUMNS_BASE = [
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
] as const;

/** Appended ONLY when `options.includeIdentifiers` is true — see this module's header comment. */
export const CSV_IDENTIFIER_COLUMNS = [
  'patientName',
  'patientDob',
  'patientAddress',
  'patientPhone',
  'insuredName',
  'insuredMemberId',
  'insuredDob',
  'insuredAddress',
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvEscape).join(',');
}

function identifierValuesFor(claim: Claim, includeIdentifiers: boolean): string[] {
  if (!includeIdentifiers) return [];
  return [
    composeName(claim.patient.name),
    claim.patient.dob,
    composeAddressLine(claim.patient.address),
    claim.patient.phone,
    composeName(claim.insured.name),
    claim.insured.memberId,
    claim.insured.dob,
    composeAddressLine(claim.insured.address),
  ];
}

/**
 * One row per service line, plus header-level claim fields repeated on
 * every row (same flat-CSV shape as clipboardFormat.ts's TSV service-lines
 * formatter — a spreadsheet-friendly re-shape of already-known data, not a
 * new design decision). A claim with ZERO service lines still emits exactly
 * one row (blank service-line columns, `lineEdited` false) so its header
 * fields and EDITED marking are never silently dropped from the export —
 * the batch/CSV path must never fail wholesale or drop a claim's row for
 * that reason.
 */
export function buildCsvExport(claims: EffectiveClaimForExport[], options: StructuredExportOptions): string {
  const columns: string[] = options.includeIdentifiers ? [...CSV_COLUMNS_BASE, ...CSV_IDENTIFIER_COLUMNS] : [...CSV_COLUMNS_BASE];
  const rows: string[] = [csvRow(columns)];

  for (const { claim, applied } of claims) {
    const claimEdited = applied.length > 0;
    const editedLabels = editedFieldLabelsFor(applied);
    const identifierValues = identifierValuesFor(claim, options.includeIdentifiers);
    const header = [
      claim.claimId,
      claim.formType,
      claim.patient.accountNumber,
      claim.billingProvider.name,
      claim.billingProvider.npi,
      claim.totals.totalCharge.toFixed(2),
      String(claimEdited),
      editedLabels,
    ];

    if (claim.serviceLines.length === 0) {
      rows.push(csvRow([...header, '', 'false', '', '', '', '', '', '', '', '', ...identifierValues]));
      continue;
    }

    claim.serviceLines.forEach((line, i) => {
      const posOrRev = line.revenueCode || line.placeOfService;
      const lineValues = [
        String(i + 1),
        String(lineIsEdited(applied, i)),
        line.fromDate,
        line.thruDate || line.fromDate,
        posOrRev,
        line.procCode,
        line.modifiers.join(' '),
        line.units || '1',
        line.charge.toFixed(2),
        line.diagPointers.join(''),
      ];
      rows.push(csvRow([...header, ...lineValues, ...identifierValues]));
    });
  }

  return rows.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export interface StructuredClaimExportJson {
  claimId: string;
  formType: Claim['formType'];
  patient: {
    accountNumber: string;
    name: string;
    dob: string;
    address: string;
    phone: string;
  };
  insured: {
    name: string;
    memberId: string;
    dob: string;
    address: string;
  };
  billingProvider: { name: string; npi: string; taxId: string };
  renderingProvider: { npi: string };
  totals: { totalCharge: number; amountPaid: number };
  diagnoses: Array<{ pointer: string; code: string }>;
  serviceLines: Array<{
    line: number;
    fromDate: string;
    thruDate: string;
    placeOfService: string;
    revenueCode: string;
    procCode: string;
    modifiers: string[];
    units: string;
    charge: number;
    diagPointers: string[];
    edited: boolean;
  }>;
  edited: boolean;
  editedFieldCount: number;
  edits: AppliedFieldEdit[];
}

export interface StructuredExportJsonDocument {
  schemaVersion: 1;
  exportedAt: string;
  claimCount: number;
  identifiersIncluded: boolean;
  claims: StructuredClaimExportJson[];
}

function claimToJson(claim: Claim, applied: AppliedFieldEdit[], includeIdentifiers: boolean): StructuredClaimExportJson {
  return {
    claimId: claim.claimId,
    formType: claim.formType,
    patient: {
      accountNumber: claim.patient.accountNumber,
      name: includeIdentifiers ? composeName(claim.patient.name) : REDACTED,
      dob: includeIdentifiers ? claim.patient.dob : REDACTED,
      address: includeIdentifiers ? composeAddressLine(claim.patient.address) : REDACTED,
      phone: includeIdentifiers ? claim.patient.phone : REDACTED,
    },
    insured: {
      name: includeIdentifiers ? composeName(claim.insured.name) : REDACTED,
      memberId: includeIdentifiers ? claim.insured.memberId : REDACTED,
      dob: includeIdentifiers ? claim.insured.dob : REDACTED,
      address: includeIdentifiers ? composeAddressLine(claim.insured.address) : REDACTED,
    },
    billingProvider: { name: claim.billingProvider.name, npi: claim.billingProvider.npi, taxId: claim.billingProvider.taxId },
    renderingProvider: { npi: claim.renderingProvider.npi },
    totals: { totalCharge: claim.totals.totalCharge, amountPaid: claim.totals.amountPaid },
    diagnoses: claim.diagnoses.map((d) => ({ pointer: d.pointer, code: d.code })),
    serviceLines: claim.serviceLines.map((line, i) => ({
      line: i + 1,
      fromDate: line.fromDate,
      thruDate: line.thruDate || line.fromDate,
      placeOfService: line.placeOfService,
      revenueCode: line.revenueCode ?? '',
      procCode: line.procCode,
      modifiers: line.modifiers,
      units: line.units,
      charge: line.charge,
      diagPointers: line.diagPointers,
      edited: lineIsEdited(applied, i),
    })),
    edited: applied.length > 0,
    editedFieldCount: applied.length,
    edits: applied,
  };
}

/**
 * One JSON document, `claims` in the order given (batch order = claim's
 * position in the source interchange). `exportedAt` is passed in by the
 * caller (electron/main.ts) rather than computed here, matching this repo's
 * "renderers/formatters never call `new Date()` themselves" convention
 * (see src/render/provenance.ts's own header comment).
 */
export function buildJsonExport(claims: EffectiveClaimForExport[], options: StructuredExportOptions, exportedAt: Date): string {
  const doc: StructuredExportJsonDocument = {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    claimCount: claims.length,
    identifiersIncluded: options.includeIdentifiers,
    claims: claims.map(({ claim, applied }) => claimToJson(claim, applied, options.includeIdentifiers)),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}
