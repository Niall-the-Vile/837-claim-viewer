import type { ClaimDetailDto } from '../../electron/preload.js';
import { formatMoney, formTypeText, severityWord } from './format.js';
import { flagWord, type AnnotationFlag, type LineAnnotation } from '../model/annotations.js';

/**
 * Pure text formatters for the clipboard/copy suite (docs/TABS_BUILD_PLAN.md
 * §2f items 1, 3 and 5's verdict text). Deliberately DOM-free — no
 * `document`/`navigator`/`window` reference anywhere in this file — so
 * these are plain fixture-in/exact-string-out functions the vitest suite
 * can call directly without a browser environment (see
 * test/clipboardFormat.test.ts). The actual `navigator.clipboard.writeText`
 * call lives in clipboard.ts, which is DOM-dependent and only imported from
 * renderer chrome (inspector.ts/main.ts), never from here.
 *
 * Only imports `format.ts` (also DOM-free) and the `ClaimDetailDto` TYPE
 * (erased at compile time — `import type`, required by verbatimModuleSyntax
 * — so it adds no runtime dependency on electron/preload.ts either).
 */

// ---------------------------------------------------------------------------
// Item 1 — copy service lines as TSV
// ---------------------------------------------------------------------------

const TSV_HEADER_PARTS = ['Line', 'DOS', 'POS/Rev', 'CPT/HCPCS', 'Modifiers', 'Units', 'Charge', 'Dx Pointers', 'Rendering NPI'];
const TSV_HEADER = TSV_HEADER_PARTS.join('\t');

/**
 * Header row + one tab-delimited row per service line, columns per
 * docs/TABS_BUILD_PLAN.md §2f item 1 (line no, DOS, POS/revenue code,
 * CPT/HCPCS, modifiers, units, charge, dx pointers, rendering NPI) — the
 * same fields the inspector's "Service lines" group already shows, so this
 * is a re-shape of on-screen data, not a new design decision.
 *
 * "POS/revenue code" is one combined column: professional lines carry a
 * place-of-service, institutional lines carry a revenue code instead
 * (never both — see src/model/claim.ts's ServiceLine), so whichever one is
 * populated wins.
 *
 * Charge is a plain two-decimal number with no `$` — this is meant to be
 * pasted straight into a spreadsheet cell and do arithmetic, not to be
 * read as prose (contrast with formatClaimSummary/
 * formatWarningsAndReconciliation below, which use formatMoney() because
 * they're prose).
 *
 * Rendering NPI is claim-level (src/model/claim.ts's ServiceLine has no
 * per-line rendering NPI field — CMS-1500/UB-04/ADA all carry one rendering
 * provider for the whole claim), so the same value repeats on every row;
 * that mirrors what the inspector's Providers group already shows.
 *
 * `annotationsByLine` (Build 6, 6.2 — "extend copy machinery to carry
 * annotations") is OPTIONAL and keyed by zero-based service-line index
 * (the array-index counterpart of src/model/annotations.ts's
 * `annotationKey`, since this formatter only ever sees ONE claim's already-
 * sliced `serviceLines` array, never a claim index). When omitted, or when
 * every line's annotation is empty, the output is BYTE-FOR-BYTE identical
 * to before this build — no Note/Flag columns at all — so a claim nobody
 * has annotated copies exactly as it always did. Only once at least one
 * line actually carries a note or flag do both columns appear, on every
 * row (blank for an unannotated line), so the column count stays constant
 * within one paste.
 */
export function formatServiceLinesTsv(detail: ClaimDetailDto, annotationsByLine?: ReadonlyMap<number, LineAnnotation>): string {
  const renderingNpi = detail.providers.rendering.npi;
  const hasAnnotations = !!annotationsByLine && Array.from(annotationsByLine.values()).some((a) => a.note.trim() !== '' || a.flag !== null);
  const header = hasAnnotations ? [...TSV_HEADER_PARTS, 'Note', 'Flag'].join('\t') : TSV_HEADER;
  const rows = detail.serviceLines.map((line, i) => {
    const parts = [
      String(line.line),
      line.dates,
      line.revenueCode || line.placeOfService,
      line.procCode,
      line.modifiers,
      line.units || '1',
      line.charge.toFixed(2),
      line.diagPointers,
      renderingNpi,
    ];
    if (hasAnnotations) {
      const a = annotationsByLine!.get(i);
      // Tabs/newlines inside a note would corrupt the TSV grid a
      // spreadsheet paste depends on — collapsed to spaces, same as any
      // other free-text-into-TSV formatter would need to.
      parts.push((a?.note ?? '').replace(/[\t\n\r]+/g, ' ').trim(), a?.flag ? flagWord(a.flag) : '');
    }
    return parts.join('\t');
  });
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Build 6, 6.2 — "Copy annotations worksheet": a SEPARATE action/output from
// every formatter above, deliberately never folded into
// formatClaimSummary (which represents the parsed claim) — this is
// reviewer scratch text, clearly labeled as such and as session-only.
// ---------------------------------------------------------------------------

export interface AnnotationWorksheetRow {
  line: number;
  flag: AnnotationFlag;
  note: string;
  checked: boolean;
}

const ANNOTATIONS_WORKSHEET_TITLE = 'Session notes & flags (not saved — cleared when this tab closes)';

/** Plain-text worksheet of every annotated line, for the "Copy annotations worksheet" action. `rows` should already exclude fully-empty lines (see inspector.ts's caller). */
export function formatAnnotationsWorksheet(rows: AnnotationWorksheetRow[]): string {
  if (rows.length === 0) return [ANNOTATIONS_WORKSHEET_TITLE, '', 'No lines have notes or flags yet.'].join('\n');
  const header = ['Line', 'Flag', 'Checked', 'Note'].join('\t');
  const body = rows.map((r) => [String(r.line), flagWord(r.flag), r.checked ? 'Yes' : 'No', r.note.replace(/[\t\n\r]+/g, ' ').trim()].join('\t'));
  return [ANNOTATIONS_WORKSHEET_TITLE, '', header, ...body].join('\n');
}

// ---------------------------------------------------------------------------
// Shared: dates-of-service span, derived from the serviceLines already
// shown (each line's `dates` is either a single ISO date or "from - thru",
// built in electron/main.ts's buildClaimDetail — see that function). ISO
// (YYYY-MM-DD) strings sort correctly with plain string comparison, so no
// Date parsing is needed here.
// ---------------------------------------------------------------------------

function splitLineDates(dates: string): [string, string] {
  const [from, thru] = dates.split(' - ');
  return [from ?? '', thru ?? from ?? ''];
}

export function formatDosSpan(serviceLines: ClaimDetailDto['serviceLines']): string {
  const froms: string[] = [];
  const thrus: string[] = [];
  for (const line of serviceLines) {
    if (!line.dates) continue;
    const [from, thru] = splitLineDates(line.dates);
    if (from) froms.push(from);
    if (thru) thrus.push(thru);
  }
  if (froms.length === 0) return '—';
  const minFrom = froms.reduce((a, b) => (a < b ? a : b));
  const maxThru = thrus.reduce((a, b) => (a > b ? a : b), minFrom);
  return minFrom === maxThru ? minFrom : `${minFrom} – ${maxThru}`;
}

// ---------------------------------------------------------------------------
// Item 3 — copy claim summary (header block already shown across the
// provenance chip / status bar / inspector's Patient+Providers groups)
// ---------------------------------------------------------------------------

export function formatClaimSummary(detail: ClaimDetailDto): string {
  const billing = detail.providers.billing;
  const billingLine = billing.name ? `${billing.name}${billing.npi ? ` (NPI ${billing.npi})` : ''}` : '—';
  return [
    'Claim summary',
    `Patient account: ${detail.patient.accountNumber || '—'}`,
    `Dates of service: ${formatDosSpan(detail.serviceLines)}`,
    `Billing provider: ${billingLine}`,
    `Form type: ${formTypeText(detail.formType)}`,
    `Service lines: ${detail.serviceLines.length}`,
    `Total charge: ${formatMoney(detail.totals.totalCharge)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Item 5 — reconciliation verdict (display-only text; does NOT change the
// mismatch threshold or the warning it fires — both still live in
// src/sources/*/*.ts / electron/main.ts's buildClaimDetail, untouched here)
// ---------------------------------------------------------------------------

const RECONCILE_EPSILON = 0.005; // same tolerance electron/main.ts's delta and the charge-total-mismatch warning use

export function reconciliationVerdict(delta: number): string {
  if (Math.abs(delta) < RECONCILE_EPSILON) return 'Balanced';
  // delta = totalCharge - sumOfLineCharges (electron/main.ts). delta > 0
  // means the claim total is bigger than what the lines add up to, i.e.
  // the lines fall short of it; delta < 0 means the lines add up to more
  // than the total, i.e. they exceed it.
  if (delta > 0) return `Lines fall short by ${formatMoney(delta)}`;
  return `Lines exceed total by ${formatMoney(Math.abs(delta))}`;
}

// ---------------------------------------------------------------------------
// Item 3 — copy warnings + reconciliation
// ---------------------------------------------------------------------------

export function formatWarningsAndReconciliation(detail: ClaimDetailDto): string {
  const lines: string[] = ['Warnings & reconciliation', ''];

  if (detail.warnings.length === 0) {
    lines.push('Warnings: none — this claim reconciles cleanly.');
  } else {
    lines.push(`Warnings (${detail.warnings.length}):`);
    detail.warnings.forEach((w, i) => {
      lines.push(`${i + 1}. [${severityWord(w.severity)}] ${w.message}`);
    });
  }

  lines.push('', 'Reconciliation:');
  lines.push(`Lines parsed: ${detail.serviceLines.length}`);
  lines.push(`Sum of line charges: ${formatMoney(detail.totals.sumOfLineCharges)}`);
  lines.push(`Claim total: ${formatMoney(detail.totals.totalCharge)}`);
  const delta = detail.totals.delta;
  const deltaSign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  lines.push(`Delta: ${deltaSign}${formatMoney(Math.abs(delta))}`);
  lines.push(`Verdict: ${reconciliationVerdict(delta)}`);

  return lines.join('\n');
}
