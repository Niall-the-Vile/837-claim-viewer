import type { ClaimDetailDto } from '../../electron/preload.js';
import type { FormType } from '../model/claim.js';
import { inspectorEl, inspectorToggleBtn, inspectorToggleLabelEl, expandAllBtn, inspectorBodyEl, warnReviewBtn, statusWarnBtnEl } from './dom.js';
import { state } from './tabs.js';

/**
 * Inspector drawer rendering (plus the small formatting helpers it — and a
 * couple of other renderer modules — need). Pure-moved out of main.ts — see
 * docs/TABS_BUILD_PLAN.md §2 Item 0.
 *
 * `formatMoney`/`formTypeText` are exported because main.ts's status bar and
 * overlays.ts's export dialog also format the same way; they're kept here
 * (rather than duplicated) so overlays.ts and main.ts can both depend on
 * this file without inspector.ts ever needing to depend back on either of
 * them (see the task's circular-import hazard note).
 */

export function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function orDash(value: string): string {
  return value === '' ? '—' : value;
}

export function formTypeText(formType: FormType): string {
  switch (formType) {
    case 'cms1500':
      return 'Professional — CMS-1500';
    case 'ub04':
      return 'Institutional — UB-04';
    case 'dental':
      return 'Dental — ADA';
    case 'unsupported':
      return 'Unsupported form';
  }
}

/** Box/FL/Item numbers the inspector's field-group tags cite, per form type — mirrors the design's per-form box references. */
function boxTags(formType: FormType): { patient: string; insured: string; providers: string; diagnoses: string; lines: string } {
  switch (formType) {
    case 'ub04':
      return { patient: 'FL 8', insured: 'FL 58', providers: 'FL 1 / 76', diagnoses: 'FL 66–70', lines: 'FL 42–47' };
    case 'dental':
      return { patient: 'Item 20', insured: 'Items 12–17', providers: 'Items 48–58', diagnoses: 'Item 34a', lines: 'Items 24–31' };
    case 'unsupported':
      return { patient: 'field', insured: 'field', providers: 'field', diagnoses: 'field', lines: 'field' };
    case 'cms1500':
      return { patient: 'Box 2', insured: 'Box 4', providers: 'Box 31 / 32 / 33', diagnoses: 'Box 21', lines: 'Box 24' };
  }
}

// ---------------------------------------------------------------------------
// Inspector visibility (owned here so revealWarningsInInspector below can
// call it without main.ts and inspector.ts importing each other)
// ---------------------------------------------------------------------------

export function updateInspectorVisibility(): void {
  const inWorkspace = state.screen === 'workspace';
  // `hidden` is only for "no claim loaded at all" (nothing to represent
  // either way). Ctrl+D / the inspector toggle button never touch `hidden`
  // — they only toggle `.collapsed` (style.css), a visual-only collapse, so
  // the <aside> stays in the DOM/accessibility tree while a claim is open,
  // per UI req §6.
  inspectorEl.hidden = !inWorkspace;
  inspectorEl.classList.toggle('collapsed', inWorkspace && !state.inspectorOpen);
  inspectorToggleLabelEl.textContent = state.inspectorOpen ? 'Hide inspector' : 'Show inspector';
  inspectorToggleBtn.classList.toggle('isActive', state.inspectorOpen);
}

export function toggleInspector(): void {
  state.inspectorOpen = !state.inspectorOpen;
  updateInspectorVisibility();
}

// ---------------------------------------------------------------------------
// Inspector drawer
// ---------------------------------------------------------------------------

interface InspRow {
  key: string;
  value: string;
  variant?: 'dim' | 'warn' | 'ok';
}

function syncCaret(details: HTMLDetailsElement): void {
  const caret = details.querySelector<HTMLSpanElement>('.inspGroupCaret');
  if (caret) caret.textContent = details.open ? '▾' : '▸';
}

function updateExpandAllLabel(): void {
  const groups = Array.from(inspectorBodyEl.querySelectorAll<HTMLDetailsElement>('details.inspGroup'));
  const allOpen = groups.length > 0 && groups.every((g) => g.open);
  expandAllBtn.textContent = allOpen ? 'Collapse all' : 'Expand all';
}

function buildGroup(id: string, label: string, tag: string, tagWarn: boolean, rows: InspRow[], defaultOpen: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'inspGroup';
  details.dataset['groupId'] = id;
  details.open = defaultOpen;

  const summaryEl = document.createElement('summary');
  const caret = document.createElement('span');
  caret.className = 'inspGroupCaret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = defaultOpen ? '▾' : '▸';
  const labelEl = document.createElement('span');
  labelEl.className = 'inspGroupLabel';
  labelEl.textContent = label;
  const tagEl = document.createElement('span');
  tagEl.className = 'inspGroupTag' + (tagWarn ? ' isWarn' : '');
  tagEl.textContent = tag;
  summaryEl.append(caret, labelEl, tagEl);
  details.append(summaryEl);

  const body = document.createElement('div');
  body.className = 'inspGroupBody';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inspEmpty';
    empty.textContent = 'Nothing parsed for this section.';
    body.append(empty);
  } else {
    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'inspRow';
      const keyEl = document.createElement('span');
      keyEl.className = 'inspRowKey';
      keyEl.textContent = row.key;
      const valEl = document.createElement('span');
      valEl.className = 'inspRowVal' + (row.variant ? ` is${row.variant.charAt(0).toUpperCase()}${row.variant.slice(1)}` : '');
      valEl.textContent = row.value;
      rowEl.append(keyEl, valEl);
      body.append(rowEl);
    }
  }
  details.append(body);

  details.addEventListener('toggle', () => {
    syncCaret(details);
    updateExpandAllLabel();
  });

  return details;
}

export function renderInspector(detail: ClaimDetailDto): void {
  inspectorBodyEl.innerHTML = '';
  const tags = boxTags(detail.formType);

  // Provenance
  const provRows: InspRow[] = [
    { key: 'Source file', value: state.fileName },
    { key: 'Format', value: state.source === 'json' ? 'Clearinghouse claim JSON' : 'X12 837 interchange' },
    { key: 'claim_form', value: orDash(detail.claimFormRaw) },
    { key: 'Claim ID', value: orDash(detail.claimId) },
  ];
  if (state.summaries.length > 1) {
    provRows.push({ key: 'Claim in file', value: `${state.currentIndex + 1} of ${state.summaries.length}` });
  }
  inspectorBodyEl.append(buildGroup('prov', 'Provenance', 'source', false, provRows, true));

  // Data warnings
  const hasWarnings = detail.warnings.length > 0;
  const warnRows: InspRow[] = hasWarnings
    ? detail.warnings.map((w) => ({
        key: w.severity === 'warning' ? 'Warning' : 'Info',
        value: w.message,
        // Conditionally spread rather than `variant: cond ? 'warn' : undefined`
        // — exactOptionalPropertyTypes (tsconfig.json) treats an explicit
        // `undefined` as distinct from "property omitted" for an optional
        // field, so assigning it directly would fail to typecheck.
        ...(w.severity === 'warning' ? { variant: 'warn' as const } : {}),
      }))
    : [{ key: 'Status', value: 'No warnings — this claim reconciles cleanly.', variant: 'ok' }];
  inspectorBodyEl.append(buildGroup('warn', 'Data warnings', String(detail.warnings.length), hasWarnings, warnRows, hasWarnings));

  // Patient
  const p = detail.patient;
  inspectorBodyEl.append(
    buildGroup(
      'patient',
      'Patient',
      tags.patient,
      false,
      [
        { key: 'Name', value: orDash(p.name) },
        { key: 'Date of birth', value: orDash(p.dob) },
        { key: 'Sex', value: orDash(p.sex) },
        { key: 'Address', value: orDash(p.address) },
        { key: 'Phone', value: orDash(p.phone) },
        { key: 'Rel. to insured', value: orDash(p.relationshipToInsured) },
        { key: 'Account no.', value: orDash(p.accountNumber) },
      ],
      true,
    ),
  );

  // Insured
  const ins = detail.insured;
  inspectorBodyEl.append(
    buildGroup(
      'insured',
      'Insured',
      tags.insured,
      false,
      [
        { key: 'Name', value: orDash(ins.name) },
        { key: 'Member ID', value: orDash(ins.memberId) },
        { key: 'Group', value: orDash(ins.group) },
        { key: 'Plan', value: orDash(ins.plan) },
        { key: 'Date of birth', value: orDash(ins.dob) },
        { key: 'Sex', value: orDash(ins.sex) },
        { key: 'Address', value: orDash(ins.address) },
        { key: 'Employer', value: orDash(ins.employer) },
      ],
      false,
    ),
  );

  // Providers (billing / rendering / referring / facility) + payer
  const providerRows: InspRow[] = [
    { key: 'Billing', value: orDash(detail.providers.billing.name) },
    { key: 'Billing NPI', value: orDash(detail.providers.billing.npi) },
    {
      key: 'Billing tax ID',
      value: detail.providers.billing.taxId
        ? `${detail.providers.billing.taxId}${detail.providers.billing.taxIdType ? ` (${detail.providers.billing.taxIdType})` : ''}`
        : '—',
    },
    { key: 'Billing address', value: orDash(detail.providers.billing.address) },
    { key: 'Billing phone', value: orDash(detail.providers.billing.phone) },
    { key: 'Taxonomy', value: orDash(detail.providers.billing.taxonomy) },
    { key: 'Rendering', value: orDash(detail.providers.rendering.name) },
    { key: 'Rendering NPI', value: orDash(detail.providers.rendering.npi) },
  ];
  if (detail.providers.referring) {
    const r = detail.providers.referring;
    providerRows.push({ key: 'Referring', value: `${orDash(r.name)}${r.npi ? ` · NPI ${r.npi}` : ''}` });
  } else {
    providerRows.push({ key: 'Referring', value: '—', variant: 'dim' });
  }
  if (detail.providers.facility) {
    const f = detail.providers.facility;
    providerRows.push({ key: 'Facility', value: `${orDash(f.name)}${f.address ? ` · ${f.address}` : ''}` });
  }
  providerRows.push(
    { key: 'Payer', value: orDash(detail.payer.name) },
    { key: 'Payer ID', value: orDash(detail.payer.id) },
    { key: 'Payer address', value: orDash(detail.payer.address) },
  );
  inspectorBodyEl.append(buildGroup('providers', 'Providers', tags.providers, false, providerRows, false));

  // Diagnoses
  const dxRows: InspRow[] = detail.diagnoses.map((d) => ({ key: d.pointer || `#${d.ordinal}`, value: orDash(d.code) }));
  inspectorBodyEl.append(buildGroup('dx', 'Diagnoses', tags.diagnoses, false, dxRows, false));

  // Service lines
  const lineRows: InspRow[] = detail.serviceLines.map((l) => {
    const parts: string[] = [];
    parts.push(l.dates || '—');
    const proc = l.modifiers ? `${l.procCode || '—'}-${l.modifiers.replace(/ /g, '-')}` : l.procCode || '—';
    parts.push(proc);
    if (l.diagPointers) parts.push(`ptr ${l.diagPointers}`);
    if (l.revenueCode) parts.push(`rev ${l.revenueCode}`);
    if (l.toothNumbers) parts.push(`tooth ${l.toothNumbers}`);
    parts.push(`×${l.units || '1'}`);
    parts.push(formatMoney(l.charge));
    return { key: `Line ${l.line}`, value: parts.join('  ·  ') };
  });
  inspectorBodyEl.append(buildGroup('lines', 'Service lines', tags.lines, false, lineRows, false));

  // Reconciliation
  const delta = detail.totals.delta;
  const reconciles = Math.abs(delta) < 0.005;
  inspectorBodyEl.append(
    buildGroup(
      'recon',
      'Reconciliation',
      'checks',
      !reconciles,
      [
        { key: 'Lines parsed', value: String(detail.serviceLines.length) },
        { key: 'Σ line charges', value: formatMoney(detail.totals.sumOfLineCharges) },
        { key: 'Claim total', value: formatMoney(detail.totals.totalCharge) },
        {
          key: 'Delta',
          value: reconciles ? '$0.00 — reconciles' : `${delta > 0 ? '+' : ''}${formatMoney(delta)}`,
          variant: reconciles ? 'ok' : 'warn',
        },
        { key: 'Amount paid', value: formatMoney(detail.totals.amountPaid) },
      ],
      !reconciles,
    ),
  );

  // Raw view (collapsed by default — can be long).
  const rawDetails = document.createElement('details');
  rawDetails.className = 'inspGroup';
  rawDetails.dataset['groupId'] = 'raw';
  const rawSummary = document.createElement('summary');
  const rawCaret = document.createElement('span');
  rawCaret.className = 'inspGroupCaret';
  rawCaret.setAttribute('aria-hidden', 'true');
  rawCaret.textContent = '▸';
  const rawLabel = document.createElement('span');
  rawLabel.className = 'inspGroupLabel';
  rawLabel.textContent = state.source === 'json' ? 'Raw JSON fields' : 'Raw 837 segments';
  rawSummary.append(rawCaret, rawLabel);
  rawDetails.append(rawSummary);
  const rawBody = document.createElement('div');
  rawBody.className = 'inspGroupBody';
  const pre = document.createElement('pre');
  pre.className = 'inspRaw';
  pre.textContent = detail.rawText;
  rawBody.append(pre);
  rawDetails.append(rawBody);
  rawDetails.addEventListener('toggle', () => {
    syncCaret(rawDetails);
    updateExpandAllLabel();
  });
  inspectorBodyEl.append(rawDetails);

  updateExpandAllLabel();
}

expandAllBtn.addEventListener('click', () => {
  const groups = Array.from(inspectorBodyEl.querySelectorAll<HTMLDetailsElement>('details.inspGroup'));
  const allOpen = groups.length > 0 && groups.every((g) => g.open);
  for (const g of groups) {
    g.open = !allOpen;
    syncCaret(g);
  }
  updateExpandAllLabel();
});

function revealWarningsInInspector(): void {
  state.inspectorOpen = true;
  updateInspectorVisibility();
  const warnGroup = inspectorBodyEl.querySelector<HTMLDetailsElement>('details[data-group-id="warn"]');
  if (warnGroup) {
    warnGroup.open = true;
    syncCaret(warnGroup);
    warnGroup.scrollIntoView({ block: 'nearest' });
    updateExpandAllLabel();
  }
}

warnReviewBtn.addEventListener('click', revealWarningsInInspector);
statusWarnBtnEl.addEventListener('click', revealWarningsInInspector);
