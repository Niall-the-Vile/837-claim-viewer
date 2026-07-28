import type { ClaimDetailDto } from '../../electron/preload.js';
import type { FormType } from '../model/claim.js';
import { inspectorEl, inspectorToggleBtn, inspectorToggleLabelEl, expandAllBtn, inspectorBodyEl, warnReviewBtn, statusWarnBtnEl } from './dom.js';
import { state, currentScreen, type TabState } from './tabs.js';
import { copyToClipboard } from './clipboard.js';
import { formatServiceLinesTsv, reconciliationVerdict } from './clipboardFormat.js';
import { explainWarning } from './warningExplanations.js';
import { ICON_COPY, ICON_SEVERITY_WARNING, ICON_SEVERITY_NOTE } from './icons.js';

/**
 * Inspector drawer rendering. Pure-moved out of main.ts — see
 * docs/TABS_BUILD_PLAN.md §2 Item 0 — then extended for §2f (clipboard/copy
 * suite + warning presentation): per-row click-to-copy with a roving-
 * tabindex composite (role=list/listitem, arrow keys move focus, Ctrl+C
 * copies the focused row), the "Copy service lines as TSV" button on the
 * service-lines group header, severity glyph + explicit word on warning
 * rows, a plain-English explanation line under each warning
 * (warningExplanations.ts), and a plain-language reconciliation verdict.
 *
 * `formatMoney`/`formTypeText` are re-exported (now defined in format.ts,
 * see that file's header) because main.ts's status bar and overlays.ts's
 * export dialog also format the same way.
 */

// formatMoney/formTypeText now live in format.ts (a DOM-free module —
// clipboardFormat.ts's formatters need them without pulling in dom.ts/
// tabs.ts's module-level side effects); re-exported here unchanged so
// main.ts/overlays.ts's existing imports keep working.
export { formatMoney, formTypeText } from './format.js';
import { formatMoney, formTypeText, severityWord } from './format.js';

function orDash(value: string): string {
  return value === '' ? '—' : value;
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
  const inWorkspace = currentScreen() === 'workspace';
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
  /** Severity glyph (docs/TABS_BUILD_PLAN.md §2f item 4) — only set on the warning rows in the "Data warnings" group. */
  glyph?: 'warning' | 'note';
  /** Renders as a dimmed, italic caption row with no key label (§2f item 6's plain-English explanation line) rather than a normal field row. */
  isExplanation?: boolean;
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

/** Appended into a group's <summary>, after the tag — currently only the "Copy service lines as TSV" button (§2f item 1). Its click handler must call preventDefault()/stopPropagation() (see buildLinesCopyBtn below) so activating it copies instead of toggling the <details> — per the HTML spec, <summary>'s click-to-toggle activation behavior is itself skipped when the triggering click event's default was prevented. */
type SummaryExtra = HTMLElement;

function buildGroup(id: string, label: string, tag: string, tagWarn: boolean, rows: InspRow[], defaultOpen: boolean, summaryExtra?: SummaryExtra): HTMLDetailsElement {
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
  if (summaryExtra) summaryEl.append(summaryExtra);
  details.append(summaryEl);

  const body = document.createElement('div');
  body.className = 'inspGroupBody';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inspEmpty';
    empty.textContent = 'Nothing parsed for this section.';
    body.append(empty);
  } else {
    // role="list"/"listitem" + roving tabindex (§2f item 2 / §3a): the
    // inspector body becomes a keyboard-navigable composite of ONE tab stop
    // per group (the first row) rather than one per row — Up/Down/Home/End
    // (delegated listener below) move the roving index, Tab leaves the
    // composite in a single press. Explanation rows (isExplanation) are
    // still real listitems (so Down from a warning naturally lands on its
    // caption before the next warning), just styled as a caption.
    body.setAttribute('role', 'list');
    let firstRowEl: HTMLElement | null = null;
    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'inspRow' + (row.isExplanation ? ' inspRowExplain' : '');
      rowEl.setAttribute('role', 'listitem');
      rowEl.tabIndex = -1;

      if (row.glyph) {
        const glyphEl = document.createElement('span');
        glyphEl.className = `sevGlyph sevGlyph${row.glyph === 'warning' ? 'Warn' : 'Note'}`;
        glyphEl.innerHTML = row.glyph === 'warning' ? ICON_SEVERITY_WARNING : ICON_SEVERITY_NOTE;
        rowEl.append(glyphEl);
      }

      if (!row.isExplanation) {
        const keyEl = document.createElement('span');
        keyEl.className = 'inspRowKey';
        keyEl.textContent = row.key;
        rowEl.append(keyEl);
      }

      const valEl = document.createElement('span');
      valEl.className = 'inspRowVal' + (row.variant ? ` is${row.variant.charAt(0).toUpperCase()}${row.variant.slice(1)}` : '');
      valEl.textContent = row.value;
      rowEl.append(valEl);

      // Accessible name explicit rather than relying on content-derived
      // accname computation (§2f item 4: "assert the accessible name
      // contains the severity word") — deterministic across browsers/AT.
      if (row.glyph) rowEl.setAttribute('aria-label', `${row.key}: ${row.value}`);

      if (!row.isExplanation) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'rowCopyBtn';
        copyBtn.tabIndex = -1; // not its own Tab stop — Ctrl+C on the focused row is the keyboard path (see the delegated keydown listener below)
        copyBtn.setAttribute('aria-label', `Copy ${row.key}`);
        copyBtn.innerHTML = ICON_COPY;
        copyBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          copyToClipboard(row.value, `${row.key} copied to the clipboard.`);
        });
        rowEl.append(copyBtn);
      }

      body.append(rowEl);
      if (!firstRowEl) firstRowEl = rowEl;
    }
    if (firstRowEl) firstRowEl.tabIndex = 0;
  }
  details.append(body);

  details.addEventListener('toggle', () => {
    syncCaret(details);
    updateExpandAllLabel();
  });

  return details;
}

// ---------------------------------------------------------------------------
// Roving tabindex + Ctrl+C: one delegated listener on inspectorBodyEl
// (attached once, at module load — rows are torn down/rebuilt on every
// renderInspector() call via inspectorBodyEl.innerHTML = '', so a listener
// attached per-row would leak; delegation avoids that entirely). §2f item 2
// / §3a: Up/Down/Home/End move the roving index within the row's own
// group; Ctrl+C copies the focused row's value via the same copyToClipboard
// helper the hover/focus icon button uses.
// ---------------------------------------------------------------------------

inspectorBodyEl.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>('.inspRow');
  if (!row) return;

  // docs/AUDIT_BUILD1.md MUST FIX #7: this used to match plain Ctrl+C AND
  // Ctrl+Shift+C (no `!event.shiftKey` guard) and never stopped the event
  // from bubbling — so pressing Ctrl+Shift+C with focus on an inspector row
  // copied the row's single value here, THEN bubbled to the window
  // dispatcher (shortcuts.ts), which copied the whole service-lines TSV on
  // top of it: two clipboard writes and two toasts for one keypress, with
  // the final clipboard contents depending on event-handler ordering.
  // Ctrl+Shift+C is reserved for the TSV shortcut everywhere else in the
  // app; excluding it here (rather than just relying on shortcuts.ts to
  // "win" by running later) plus stopPropagation() on the plain-Ctrl+C
  // branch keeps this row-level handler from ever colliding with a
  // window-level chord, now or if one is added later.
  const ctrlOrCmd = event.ctrlKey || event.metaKey;
  if (ctrlOrCmd && !event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    event.stopPropagation();
    const key = row.querySelector('.inspRowKey')?.textContent ?? row.getAttribute('aria-label') ?? 'Value';
    const value = row.querySelector('.inspRowVal')?.textContent ?? '';
    copyToClipboard(value, `${key} copied to the clipboard.`);
    return;
  }

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
  const body = row.closest<HTMLElement>('.inspGroupBody');
  if (!body) return;
  const rows = Array.from(body.querySelectorAll<HTMLElement>('.inspRow'));
  const currentIdx = rows.indexOf(row);
  if (currentIdx === -1) return;

  let nextIdx = currentIdx;
  if (event.key === 'ArrowDown') nextIdx = Math.min(currentIdx + 1, rows.length - 1);
  else if (event.key === 'ArrowUp') nextIdx = Math.max(currentIdx - 1, 0);
  else if (event.key === 'Home') nextIdx = 0;
  else if (event.key === 'End') nextIdx = rows.length - 1;
  if (nextIdx === currentIdx) return;

  event.preventDefault();
  rows[currentIdx]!.tabIndex = -1;
  rows[nextIdx]!.tabIndex = 0;
  rows[nextIdx]!.focus();
});

/** The "Copy service lines as TSV" button placed in the service-lines group's <summary> (§2f item 1) — also used by the Ctrl+Shift+C shortcut (shortcuts.ts/main.ts call formatServiceLinesTsv directly, so this button and the shortcut share the exact same formatter). */
function buildLinesCopyBtn(detail: ClaimDetailDto): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'inspGroupCopyBtn';
  btn.title = 'Copy service lines as TSV (Ctrl+Shift+C)';
  btn.setAttribute('aria-label', 'Copy service lines as TSV');
  btn.innerHTML = ICON_COPY;
  btn.addEventListener('click', (event) => {
    // Prevents <summary>'s native click-to-toggle activation (HTML spec:
    // skipped when the event's default was prevented) so clicking this
    // button copies without also collapsing/expanding the group.
    event.preventDefault();
    event.stopPropagation();
    copyToClipboard(formatServiceLinesTsv(detail), 'Service lines copied to the clipboard.');
  });
  return btn;
}

export function renderInspector(tab: TabState, detail: ClaimDetailDto): void {
  inspectorBodyEl.innerHTML = '';
  const tags = boxTags(detail.formType);

  // Provenance
  const provRows: InspRow[] = [
    { key: 'Source file', value: tab.fileName },
    { key: 'Format', value: tab.source === 'json' ? 'Clearinghouse claim JSON' : 'X12 837 interchange' },
    { key: 'claim_form', value: orDash(detail.claimFormRaw) },
    { key: 'Claim ID', value: orDash(detail.claimId) },
  ];
  if (tab.summaries.length > 1) {
    provRows.push({ key: 'Claim in file', value: `${tab.currentIndex + 1} of ${tab.summaries.length}` });
  }
  inspectorBodyEl.append(buildGroup('prov', 'Provenance', 'source', false, provRows, true));

  // Data warnings — severity glyph + explicit word (§2f item 4: 'warning' ->
  // filled triangle + "Warning", 'info' -> outlined circle + "Note"; there
  // are only ever these two WarningSeverity values, see src/model/claim.ts)
  // plus a plain-English explanation line under each, keyed by warning code
  // (§2f item 6, warningExplanations.ts).
  const hasWarnings = detail.warnings.length > 0;
  const warnRows: InspRow[] = hasWarnings
    ? detail.warnings.flatMap((w) => {
        const rows: InspRow[] = [
          {
            key: severityWord(w.severity),
            value: w.message,
            glyph: w.severity === 'warning' ? 'warning' : 'note',
            // Conditionally spread rather than `variant: cond ? 'warn' : undefined`
            // — exactOptionalPropertyTypes (tsconfig.json) treats an explicit
            // `undefined` as distinct from "property omitted" for an optional
            // field, so assigning it directly would fail to typecheck.
            ...(w.severity === 'warning' ? { variant: 'warn' as const } : {}),
          },
        ];
        const explanation = explainWarning(w.code);
        if (explanation) rows.push({ key: '', value: explanation, variant: 'dim', isExplanation: true });
        return rows;
      })
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
  inspectorBodyEl.append(buildGroup('lines', 'Service lines', tags.lines, false, lineRows, false, buildLinesCopyBtn(detail)));

  // Reconciliation (§2f item 5: the existing figures plus an explicit
  // signed delta — unchanged from before — and a plain-language verdict row
  // beneath it. Display only: the 0.005 mismatch threshold and the
  // charge-total-mismatch warning it drives are untouched, both still live
  // in electron/main.ts's buildClaimDetail / src/sources/*/*.ts.)
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
        { key: 'Verdict', value: reconciliationVerdict(delta), variant: reconciles ? 'ok' : 'warn' },
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
  rawLabel.textContent = tab.source === 'json' ? 'Raw JSON fields' : 'Raw 837 segments';
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
