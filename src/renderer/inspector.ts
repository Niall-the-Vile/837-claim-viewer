import type { ClaimDetailDto, InstitutionalDetailDto } from '../../electron/preload.js';
import type { FormType, ClaimWarningAnchor } from '../model/claim.js';
import { inspectorEl, inspectorToggleBtn, inspectorToggleLabelEl, expandAllBtn, inspectorBodyEl, warnReviewBtn, statusWarnBtnEl, clearOverridesBtn } from './dom.js';
import { state, currentScreen, activeTab, type TabState } from './tabs.js';
import { copyToClipboard } from './clipboard.js';
import { formatServiceLinesTsv, formatAnnotationsWorksheet, reconciliationVerdict, type AnnotationWorksheetRow } from './clipboardFormat.js';
import { annotationsForClaimByLineIndex } from './annotations.js';
import { explainWarning } from './warningExplanations.js';
import { ICON_COPY, ICON_SEVERITY_WARNING, ICON_SEVERITY_NOTE, ICON_EDIT, ICON_REVERT } from './icons.js';
import {
  annotationKey,
  emptyAnnotation,
  isEmptyAnnotation,
  nextFlag,
  flagGlyph,
  flagWord,
  summarizeAnnotations,
  summaryLine as annotationSummaryLine,
  annotationMatchesFilter,
  type AnnotationFilterMode,
  type AnnotationFlag,
  type LineAnnotation,
} from '../model/annotations.js';

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
 *
 * docs/BUILD_QUEUE.md Build 2.2 (plain-English decoding of public CMS code
 * sets — place of service, type of bill, discharge status, revenue codes,
 * condition/occurrence/value codes, common modifiers): decoding itself
 * happens in MAIN (electron/main.ts's buildClaimDetail) — this file is a
 * pure view layer over the `{ raw, decoded }` pairs already on the DTO. A
 * row that carries a non-null `InspRow.decoded` renders the decoded text as
 * a visually distinguished (italic, muted — see the inline style set in
 * buildGroup below; style.css is owned by another build tonight, so this
 * uses the SAME `--ink-3` custom property style.css already defines for
 * dim/explanation text, applied inline rather than via a new class) sibling
 * of the raw value — never replacing it, never inside the `.inspRowVal`
 * element the copy path reads from, so click-to-copy and Ctrl+C keep
 * emitting the raw code exactly as before (see the keydown handler below).
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
  /**
   * Plain-English decoding of `value` (docs/BUILD_QUEUE.md Build 2.2) — set
   * only when a lookup succeeded (never the literal "Unknown"; an
   * unrecognized or blank raw code simply omits this property and the row
   * shows the raw value alone, per docs/UI_REQUIREMENTS_v3_queued_features.md
   * §2). Rendered as a visually distinct sibling of the raw value, never
   * folded into it — see buildGroup and the module header above for why
   * that split matters for copy/Ctrl+C.
   */
  decoded?: string | null;
  /**
   * Editable fields (docs/EDITABLE_FIELDS_DESIGN.md §2): set only when this
   * row corresponds 1:1 to a field in `src/model/editableFields.ts`'s
   * registry — the exact string electron/main.ts's ClaimDetailDto carries in
   * `editableFieldPaths`/`edits[].fieldPath`. Decoration (pencil/edited
   * badge/revert — see decorateEditableRows below) happens in a post-pass
   * over the rendered DOM rather than inline here, so buildGroup itself
   * stays unaware of the editing feature.
   */
  fieldKey?: string;
  /**
   * The RAW value to seed an inline edit's `<input>` with, when it differs
   * from `value` (e.g. "Billing tax ID" DISPLAYS "990000000 (E)" but the
   * only thing that's actually editable is the plain tax id). Falls back to
   * `value` when omitted.
   */
  editValue?: string;
  /**
   * Ease-of-use + accessibility batch, item 7 (clickable warnings — the
   * inspector/DOM half): set only on a "Data warnings" group row whose
   * underlying `ClaimWarning` carries a `src/model/claim.ts` `anchor`
   * (produced by `src/model/validate.ts` / `x12ClaimSource.ts`). Clicking
   * (or Enter/Space on) a row with this set reveals and flashes the
   * anchor's target elsewhere in the inspector — see jumpToWarningAnchor
   * below, which reuses the exact same `.searchMatchActive` persistent-
   * outline class Ctrl+F search already built (features/search.ts).
   */
  anchor?: ClaimWarningAnchor;
}

/**
 * Decoded text is rendered IN FULL and allowed to wrap. It is deliberately
 * not truncated by character count.
 *
 * Build 2 sliced it at 64 characters, which did not shorten long labels so
 * much as merge them: discharge status '05' and '85' differ only by a
 * trailing ", with planned readmission", so both rendered the byte-identical
 * string "Discharged/transferred to a designated cancer center or childre…".
 * The 81-88 discharge series is systematically the 01-06 series with that
 * clause appended, so the distinguishing text is always at the END — exactly
 * what a tail truncation discards (test/decodeTables.test.ts pins this).
 *
 * Worse, buildServiceLineRows joins the place-of-service, revenue-code and
 * EVERY modifier decode into one string before it reaches this point, so the
 * same cut silently dropped the trailing modifiers on any line carrying more
 * than one.
 *
 * `.inspRowVal` already wraps (`overflow-wrap: anywhere`, `min-width: 0`), so
 * the drawer handles length on its own. If a visual limit is ever wanted it
 * must be a CSS clamp on the rendered box, never a slice of the model text —
 * and it must not be applied to the joined multi-decode string at all.
 */

/**
 * Fires after every `renderInspector()` rebuild (docs/BUILD_QUEUE.md
 * Build 2.1) — the hook this file's `features/search.ts` registers itself
 * with (via `onInspectorRendered`) to re-apply an active search filter to
 * the freshly-rebuilt `.inspGroup`/`.inspRow` DOM (tab switch, claim step, a
 * cross-claim search jump — every path that calls `renderInspector` tears
 * down and rebuilds the whole body via `inspectorBodyEl.innerHTML = ''`
 * above, so nothing about a previous filter survives it on its own). Kept
 * as a generic hook list — this file has no idea search.ts exists — rather
 * than an import, so inspector.ts and features/search.ts don't need to
 * import each other (search.ts already imports `updateInspectorVisibility`
 * from here for Ctrl+F's "expand the inspector if collapsed" step; a
 * two-way import between the two files would be a needless cycle).
 */
const postRenderHooks: Array<() => void> = [];
export function onInspectorRendered(hook: () => void): void {
  postRenderHooks.push(hook);
}

/**
 * Editable fields (docs/EDITABLE_FIELDS_DESIGN.md): fired after `tab.detail`
 * has just been replaced by a fresh ClaimDetailDto from a
 * setFieldOverride/revertFieldOverride/clearOverridesForClaim IPC round
 * trip. main.ts registers a hook here (initInspectorEditing) to refresh
 * whatever else depends on claim-detail data outside the inspector itself
 * (the PDF preview, so an edit is immediately WYSIWYG — see the design
 * doc's §4) — this file doesn't import main.ts's loading machinery directly,
 * to avoid a module cycle (overlays.ts already imports formatMoney/
 * formTypeText FROM this file, so this file importing overlays.ts back would
 * create one; dependency injection, same pattern as tabs.ts's
 * TabStripDeps/shortcuts.ts's ShortcutDeps, sidesteps that entirely).
 */
const claimDetailChangedHooks: Array<(tab: TabState) => void> = [];
function notifyClaimDetailChanged(tab: TabState): void {
  renderInspector(tab, tab.detail!);
  for (const hook of claimDetailChangedHooks) hook(tab);
}

/**
 * Toast surfacing for a failed edit (invalid value, IPC rejection). Wired by
 * main.ts (`initInspectorEditing`) to the shared `showToast` — see the
 * module-cycle note above for why this file doesn't import overlays.ts
 * directly. A no-op default keeps this file safely importable/testable
 * (e.g. from a future unit test) before main.ts wires it up.
 */
let showEditToast: (message: string, isError: boolean) => void = () => {};

export interface InspectorEditingDeps {
  onClaimDetailChanged: (tab: TabState) => void;
  showToast: (message: string, isError: boolean) => void;
}

export function initInspectorEditing(deps: InspectorEditingDeps): void {
  claimDetailChangedHooks.push(deps.onClaimDetailChanged);
  showEditToast = deps.showToast;
}

function editErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
      // docs/BUILD_QUEUE.md Build 2.1 (Ctrl+F inspector search): the row's
      // plain label/value text, read by features/search.ts's post-render
      // filter — deliberately the RAW `row.value` (never the `.decoded`
      // sibling text this file renders below), matching the spec's "match
      // on the value and the field label" against what the claim actually
      // said, not our own decoding lookup. A dataset attribute (not a
      // rendered-DOM-text scrape) keeps search.ts decoupled from exactly how
      // this file lays out a row's markup.
      rowEl.dataset['searchKey'] = row.key;
      rowEl.dataset['searchValue'] = row.value;
      // Editable fields (docs/EDITABLE_FIELDS_DESIGN.md): a data attribute,
      // same pattern as search's above, decoupling decorateEditableRows
      // (called once at the end of renderInspector) from buildGroup's exact
      // markup layout.
      if (row.fieldKey) {
        rowEl.dataset['fieldKey'] = row.fieldKey;
        rowEl.dataset['editValue'] = row.editValue ?? row.value;
      }

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
      if (row.decoded) {
        // Raw stays in its own child span (.inspRowValRaw) so the Ctrl+C
        // keydown handler below can read ONLY the raw text — the decoded
        // sibling is visible but deliberately outside what copy emits (see
        // this file's header comment and docs/BUILD_QUEUE.md Build 2.2's
        // "raw value stays copyable verbatim" requirement).
        const rawEl = document.createElement('span');
        rawEl.className = 'inspRowValRaw';
        rawEl.textContent = row.value;
        valEl.append(rawEl);

        const decodedEl = document.createElement('span');
        decodedEl.className = 'inspRowValDecoded';
        // Inline style, not a new style.css class — style.css is owned by
        // a different build tonight (see this file's header). `--ink-3` is
        // the same dim-text custom property style.css already defines
        // (used today by .inspRowVal.isDim / the explanation-row caption),
        // so this stays correctly themed in light/dark without touching
        // that file, and is visually distinct (italic + dimmed) from the
        // raw value next to it, per docs/UI_REQUIREMENTS_v3_queued_features.md
        // §2 ("distinguish decoded text ... so nobody mistakes our lookup
        // for something the claim actually said").
        decodedEl.setAttribute('style', 'font-style: italic; color: var(--ink-3); margin-left: 4px;');
        decodedEl.textContent = `· ${row.decoded}`;
        decodedEl.title = row.decoded;
        valEl.append(decodedEl);
      } else {
        valEl.textContent = row.value;
      }
      rowEl.append(valEl);

      // Accessible name explicit rather than relying on content-derived
      // accname computation (§2f item 4: "assert the accessible name
      // contains the severity word") — deterministic across browsers/AT.
      // The decode is included: it is the plain-English half of the row, and
      // omitting it left the untruncated meaning reachable only by hovering
      // for the tooltip (docs/AUDIT_BUILD2.md).
      if (row.glyph) {
        const accName = row.decoded ? `${row.key}: ${row.value}, ${row.decoded}` : `${row.key}: ${row.value}`;
        rowEl.setAttribute(
          'aria-label',
          row.anchor ? `${accName}. Activate to locate the affected field.` : accName,
        );
      }

      // Ease-of-use + accessibility batch, item 7 (clickable warnings —
      // inspector/DOM half): a warning row with a stable anchor is
      // click/Enter/Space-activatable to reveal and flash the field it
      // concerns elsewhere in the inspector. Never on an isExplanation
      // (caption) row — the anchor lives on the warning row itself.
      if (row.anchor) {
        const anchor = row.anchor;
        rowEl.classList.add('inspRowClickable');
        rowEl.title = 'Click to locate the affected field';
        // Dataset mirror of `anchor` (rather than only the closure below) so
        // the delegated keydown listener further down — which only ever
        // sees a plain DOM element, not this row's original InspRow object —
        // can activate the SAME anchor via Enter/Space.
        rowEl.dataset['anchorGroup'] = anchor.groupId;
        if (anchor.lineNumbers) rowEl.dataset['anchorLines'] = anchor.lineNumbers.join(',');
        rowEl.addEventListener('click', (event) => {
          // The per-row copy button (below) already stopPropagation()s its
          // own click, so this only ever fires for a genuine row click.
          event.preventDefault();
          jumpToWarningAnchor(anchor);
        });
      }

      if (!row.isExplanation) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'rowCopyBtn';
        copyBtn.tabIndex = -1; // not its own Tab stop — Ctrl+C on the focused row is the keyboard path (see the delegated keydown listener below)
        copyBtn.setAttribute('aria-label', `Copy ${row.key}`);
        copyBtn.title = `Copy ${row.key} (Ctrl+C)`;
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
    // .inspRowValRaw exists only on a decoded row (docs/BUILD_QUEUE.md
    // Build 2.2) and holds ONLY the raw code; falling back to the whole
    // .inspRowVal textContent for every other row is unchanged from before
    // this build. Either way this never picks up the decoded sibling span.
    const value = row.querySelector('.inspRowValRaw')?.textContent ?? row.querySelector('.inspRowVal')?.textContent ?? '';
    copyToClipboard(value, `${key} copied to the clipboard.`);
    return;
  }

  // Ease-of-use + accessibility batch, item 7: Enter/Space activates a
  // clickable warning row (see the anchorGroup dataset written by buildGroup
  // above) — the same activation keys a native <button> would respond to,
  // even though this row stays a <div role="listitem"> for the existing
  // roving-tabindex composite.
  if ((event.key === 'Enter' || event.key === ' ') && row.dataset['anchorGroup']) {
    event.preventDefault();
    const groupId = row.dataset['anchorGroup'] as ClaimWarningAnchor['groupId'];
    const lineNumbers = row.dataset['anchorLines'] ? row.dataset['anchorLines']!.split(',').map(Number) : undefined;
    jumpToWarningAnchor(lineNumbers ? { groupId, lineNumbers } : { groupId });
    return;
  }

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
  const body = row.closest<HTMLElement>('.inspGroupBody');
  if (!body) return;
  // `:not([hidden])` (docs/BUILD_QUEUE.md Build 2.1): while an inspector
  // search filter is active, non-matching rows are hidden in place rather
  // than removed (features/search.ts) — without this filter, Up/Down/Home/
  // End would still walk the FULL row list (including hidden ones) by
  // index, landing the roving tabindex on a `hidden` element that can never
  // actually receive focus, which silently breaks keyboard navigation the
  // moment a search filter hides anything. With no filter active every row
  // is visible anyway, so this is a no-op change outside search.
  const rows = Array.from(body.querySelectorAll<HTMLElement>('.inspRow:not([hidden])'));
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

/**
 * Rows for the "Billing details" group — institutional (UB-04) claim-level
 * coded fields, decoded (docs/BUILD_QUEUE.md Build 2.2). Every code here
 * follows the same raw-first/decoded-secondary pattern as every other
 * decoded row in this file; a component that couldn't be decoded (or
 * couldn't even be parsed into 3 significant digits — see
 * src/model/decode.ts's decodeTypeOfBill) just shows its raw value with no
 * `decoded` property, never "Unknown".
 */
function buildInstitutionalRows(inst: InstitutionalDetailDto): InspRow[] {
  const rows: InspRow[] = [];

  const tob = inst.typeOfBill;
  const tobRow: InspRow = { key: 'Type of bill', value: orDash(tob.raw) };
  if (tob.combined) tobRow.decoded = tob.combined;
  rows.push(tobRow);
  const facilityRow: InspRow = { key: 'Facility type', value: orDash(tob.facilityType.raw) };
  if (tob.facilityType.decoded) facilityRow.decoded = tob.facilityType.decoded;
  rows.push(facilityRow);
  const classRow: InspRow = { key: 'Bill classification', value: orDash(tob.billClassification.raw) };
  if (tob.billClassification.decoded) classRow.decoded = tob.billClassification.decoded;
  rows.push(classRow);
  const freqRow: InspRow = { key: 'Frequency', value: orDash(tob.frequency.raw) };
  if (tob.frequency.decoded) freqRow.decoded = tob.frequency.decoded;
  rows.push(freqRow);

  const statusRow: InspRow = { key: 'Discharge status', value: orDash(inst.patientStatus.raw) };
  if (inst.patientStatus.decoded) statusRow.decoded = inst.patientStatus.decoded;
  rows.push(statusRow);

  inst.conditionCodes.forEach((c, i) => {
    const row: InspRow = { key: `Condition code ${i + 1}`, value: orDash(c.raw) };
    if (c.decoded) row.decoded = c.decoded;
    rows.push(row);
  });

  inst.occurrenceCodes.forEach((o, i) => {
    const row: InspRow = { key: `Occurrence ${i + 1}`, value: o.date ? `${o.raw}  ·  ${o.date}` : orDash(o.raw) };
    if (o.decoded) row.decoded = o.decoded;
    rows.push(row);
  });

  inst.occurrenceSpans.forEach((s, i) => {
    const row: InspRow = { key: `Occurrence span ${i + 1}`, value: `${s.raw}  ·  ${s.from} – ${s.through}` };
    if (s.decoded) row.decoded = s.decoded;
    rows.push(row);
  });

  inst.valueCodes.forEach((v, i) => {
    const row: InspRow = { key: `Value code ${i + 1}`, value: `${v.raw}  ·  ${formatMoney(v.amount)}` };
    if (v.decoded) row.decoded = v.decoded;
    rows.push(row);
  });

  return rows;
}

/** The "Copy service lines as TSV" button placed in the service-lines group's <summary> (§2f item 1) — also used by the Ctrl+Shift+C shortcut (shortcuts.ts/main.ts call formatServiceLinesTsv directly, so this button and the shortcut share the exact same formatter). */
function buildLinesCopyBtn(tab: TabState, detail: ClaimDetailDto): HTMLButtonElement {
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
    // Build 6, 6.2: Note/Flag columns are appended automatically whenever
    // this claim actually has an annotation — see formatServiceLinesTsv.
    const annotationsByLine = annotationsForClaimByLineIndex(tab, tab.currentIndex);
    copyToClipboard(formatServiceLinesTsv(detail, annotationsByLine), 'Service lines copied to the clipboard.');
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Build 6 — Notes & audit, 6.1: session-scoped per-service-line notes,
// dispute/verify/OK flags and check-off marks. A DEDICATED inspector group
// (rather than icons woven into the existing "Service lines" group's
// composite per-field InspRow grid — see this file's header on why that
// grid mixes several raw fields into one string per row and is driven by
// click-to-copy/keyboard-roving-tabindex machinery this feature must not
// disturb) — one row per service line, entirely custom markup (no
// `.inspRow` class, so none of that machinery ever touches it). See
// src/model/annotations.ts's header for the hard "session-only, never
// persisted, never crosses the contextBridge" constraint this group's
// state (`tab.annotations`) is built on.
// ---------------------------------------------------------------------------

/** Reads (without creating) the current annotation for one line, or a fresh empty one if none exists yet — never mutates `tab.annotations`. */
function readAnnotation(tab: TabState, claimIndex: number, lineIndex: number): LineAnnotation {
  return tab.annotations.get(annotationKey(claimIndex, lineIndex)) ?? emptyAnnotation();
}

/** Writes `a` back into `tab.annotations`, DELETING the Map entry entirely once every field is back to empty — keeps the Map from accumulating dead entries for lines a user touched and then un-touched (flagged, then flagged back to none; typed a note, then cleared it). */
function commitAnnotation(tab: TabState, claimIndex: number, lineIndex: number, a: LineAnnotation): void {
  const key = annotationKey(claimIndex, lineIndex);
  if (isEmptyAnnotation(a)) tab.annotations.delete(key);
  else tab.annotations.set(key, a);
}

/** Every currently-non-empty annotation for one claim, in line order — feeds both the "Copy annotations worksheet" action and (indirectly, via annotationsForClaimByLineIndex) the service-lines TSV's optional Note/Flag columns. */
function annotationWorksheetRows(tab: TabState, claimIndex: number, lineCount: number): AnnotationWorksheetRow[] {
  const rows: AnnotationWorksheetRow[] = [];
  for (let i = 0; i < lineCount; i++) {
    const a = tab.annotations.get(annotationKey(claimIndex, i));
    if (a && !isEmptyAnnotation(a)) rows.push({ line: i + 1, flag: a.flag, note: a.note, checked: a.checked });
  }
  return rows;
}

/**
 * One service line's triage control (glyph + word, never colour alone —
 * cycles None -> OK -> Verify -> Dispute -> None on click), check-off box,
 * and inline expanding note textarea (autosaves on blur, quiet "Saved"
 * affordance — never a modal, never a toast per keystroke, per
 * docs/UI_REQUIREMENTS_v3_queued_features.md §7).
 */
function buildAnnotationRow(tab: TabState, claimIndex: number, lineIndex: number, onChange: () => void): HTMLDivElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'annoRow';
  rowEl.dataset['annoLine'] = String(lineIndex);

  const lineLabel = document.createElement('span');
  lineLabel.className = 'annoLineLabel';
  lineLabel.textContent = `Line ${lineIndex + 1}`;
  rowEl.append(lineLabel);

  const initial = readAnnotation(tab, claimIndex, lineIndex);

  const flagBtn = document.createElement('button');
  flagBtn.type = 'button';
  flagBtn.className = 'annoFlagBtn';
  function paintFlag(flag: AnnotationFlag): void {
    flagBtn.textContent = `${flagGlyph(flag)} ${flagWord(flag)}`;
    flagBtn.setAttribute('aria-label', `Line ${lineIndex + 1} triage mark: ${flagWord(flag)}. Activate to change.`);
    flagBtn.dataset['flag'] = flag ?? 'none';
  }
  paintFlag(initial.flag);
  flagBtn.addEventListener('click', () => {
    const a = readAnnotation(tab, claimIndex, lineIndex);
    a.flag = nextFlag(a.flag);
    commitAnnotation(tab, claimIndex, lineIndex, a);
    paintFlag(a.flag);
    onChange();
  });
  rowEl.append(flagBtn);

  const checkLabel = document.createElement('label');
  checkLabel.className = 'annoCheckLabel';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'annoCheckbox';
  checkbox.checked = initial.checked;
  checkbox.setAttribute('aria-label', `Line ${lineIndex + 1} checked off`);
  checkbox.addEventListener('change', () => {
    const a = readAnnotation(tab, claimIndex, lineIndex);
    a.checked = checkbox.checked;
    commitAnnotation(tab, claimIndex, lineIndex, a);
    onChange();
  });
  const checkText = document.createElement('span');
  checkText.textContent = 'Checked';
  checkLabel.append(checkbox, checkText);
  rowEl.append(checkLabel);

  const noteToggle = document.createElement('button');
  noteToggle.type = 'button';
  noteToggle.className = 'annoNoteToggle';
  noteToggle.setAttribute('aria-expanded', 'false');
  // 6.4 — explicit "session-only, not saved" affordance, right on the
  // control that opens the note editor.
  noteToggle.title = 'Not saved — cleared when this tab closes';
  function paintNoteToggle(hasNote: boolean): void {
    noteToggle.textContent = hasNote ? 'Note •' : 'Note';
    noteToggle.setAttribute('aria-label', hasNote ? `Line ${lineIndex + 1} has a note. Activate to view or edit it.` : `Add a note to line ${lineIndex + 1}`);
  }
  paintNoteToggle(initial.note !== '');

  const textarea = document.createElement('textarea');
  textarea.className = 'annoNoteText';
  textarea.hidden = true;
  textarea.rows = 2;
  textarea.value = initial.note;
  textarea.title = 'Not saved — cleared when this tab closes. Saves automatically when you click away.';
  textarea.placeholder = 'Add a note for this line… (not saved to disk)';

  const savedHint = document.createElement('span');
  savedHint.className = 'annoSavedHint';
  savedHint.textContent = 'Saved';
  savedHint.hidden = true;
  let savedHintTimer: number | undefined;

  noteToggle.addEventListener('click', () => {
    const willOpen = textarea.hidden;
    textarea.hidden = !willOpen;
    noteToggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) textarea.focus();
  });

  textarea.addEventListener('blur', () => {
    const a = readAnnotation(tab, claimIndex, lineIndex);
    if (a.note === textarea.value) return; // no-op blur (opened, typed nothing, clicked away) — no spurious "Saved" flash
    a.note = textarea.value;
    commitAnnotation(tab, claimIndex, lineIndex, a);
    paintNoteToggle(a.note !== '');
    onChange();
    savedHint.hidden = false;
    if (savedHintTimer !== undefined) window.clearTimeout(savedHintTimer);
    savedHintTimer = window.setTimeout(() => {
      savedHint.hidden = true;
    }, 1500);
  });

  rowEl.append(noteToggle, textarea, savedHint);
  return rowEl;
}

/** The "Notes & flags" group (6.1) — claim-level summary + filter control + one buildAnnotationRow per service line, plus its own "Copy annotations worksheet" action (6.2). Built by hand (not via buildGroup) since its rows are entirely custom, not InspRow-shaped. */
function buildAnnotationsGroup(tab: TabState, detail: ClaimDetailDto): HTMLDetailsElement {
  const claimIndex = tab.currentIndex;
  const lineCount = detail.serviceLines.length;

  const details = document.createElement('details');
  details.className = 'inspGroup';
  details.dataset['groupId'] = 'annotations';
  details.open = false;

  const summaryEl = document.createElement('summary');
  const caret = document.createElement('span');
  caret.className = 'inspGroupCaret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▸';
  const labelEl = document.createElement('span');
  labelEl.className = 'inspGroupLabel';
  labelEl.textContent = 'Notes & flags';
  const tagEl = document.createElement('span');
  tagEl.className = 'inspGroupTag';
  summaryEl.append(caret, labelEl, tagEl);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  // Deliberately its OWN class, not .inspGroupCopyBtn — e2e/copy.spec.ts's
  // "copy service lines as TSV" test locates that class expecting exactly
  // one match (the service-lines group's own copy button); a second
  // same-classed button here made that locator ambiguous. Same visual
  // treatment via a shared selector in style.css.
  copyBtn.className = 'annoGroupCopyBtn';
  copyBtn.title = 'Copy annotations worksheet';
  copyBtn.setAttribute('aria-label', 'Copy annotations worksheet');
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rows = annotationWorksheetRows(tab, claimIndex, lineCount);
    copyToClipboard(formatAnnotationsWorksheet(rows), rows.length > 0 ? 'Annotations worksheet copied to the clipboard.' : 'No notes or flags to copy yet.');
  });
  summaryEl.append(copyBtn);
  details.append(summaryEl);
  details.addEventListener('toggle', () => {
    syncCaret(details);
    updateExpandAllLabel();
  });

  const body = document.createElement('div');
  body.className = 'inspGroupBody annoGroupBody';

  const sessionNote = document.createElement('div');
  sessionNote.className = 'annoSessionNote';
  sessionNote.textContent = 'Session-only — never saved to disk. Cleared when this tab closes or the app restarts.';
  body.append(sessionNote);

  const controlsRow = document.createElement('div');
  controlsRow.className = 'annoControlsRow';
  const summarySpan = document.createElement('span');
  summarySpan.className = 'annoSummaryLine';
  const filterSelect = document.createElement('select');
  filterSelect.className = 'annoFilterSelect';
  filterSelect.setAttribute('aria-label', 'Filter service lines by annotation');
  const filterOptions: Array<[AnnotationFilterMode, string]> = [
    ['all', 'Show: all lines'],
    ['flagged', 'Show: flagged only'],
    ['disputed', 'Show: disputed only'],
  ];
  for (const [value, label] of filterOptions) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    filterSelect.append(opt);
  }
  controlsRow.append(summarySpan, filterSelect);
  body.append(controlsRow);

  function refreshSummary(): void {
    const counts = summarizeAnnotations(tab.annotations, claimIndex, lineCount);
    summarySpan.textContent = annotationSummaryLine(counts);
    tagEl.textContent = String(counts.flaggedCount + counts.notedCount + counts.checkedCount);
    tagEl.classList.toggle('isWarn', counts.disputedCount > 0);
  }
  refreshSummary();

  function applyAnnotationFilter(): void {
    const mode = filterSelect.value as AnnotationFilterMode;
    for (const rowEl of Array.from(body.querySelectorAll<HTMLElement>('.annoRow'))) {
      const lineIdx = Number(rowEl.dataset['annoLine']);
      const a = tab.annotations.get(annotationKey(claimIndex, lineIdx));
      rowEl.hidden = !annotationMatchesFilter(a, mode);
    }
  }
  filterSelect.addEventListener('change', applyAnnotationFilter);

  if (lineCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'inspEmpty';
    empty.textContent = 'No service lines on this claim.';
    body.append(empty);
  } else {
    for (let i = 0; i < lineCount; i++) {
      body.append(buildAnnotationRow(tab, claimIndex, i, refreshSummary));
    }
  }
  applyAnnotationFilter();

  details.append(body);
  return details;
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
            // Ease-of-use + accessibility batch, item 7: only present when
            // the rule that emitted this warning attached one.
            ...(w.anchor ? { anchor: w.anchor } : {}),
          },
        ];
        const explanation = explainWarning(w.code);
        if (explanation) rows.push({ key: '', value: explanation, variant: 'dim', isExplanation: true });
        return rows;
      })
    : [{ key: 'Status', value: 'No warnings — this claim reconciles cleanly.', variant: 'ok' }];
  // Editable fields, invariant 4: an edit must never make a warning
  // silently disappear — this note is the UI-visible reminder that the
  // warnings ABOVE are, and always will be, computed from the ORIGINAL
  // parsed claim (electron/main.ts never recomputes them from the effective/
  // overridden claim). Prepended so it's the first thing read, whether or
  // not there happen to be any warnings this claim actually trips.
  if (detail.editedFieldCount > 0) {
    warnRows.unshift({
      key: '',
      value: `${detail.editedFieldCount} field${detail.editedFieldCount === 1 ? '' : 's'} edited on this claim — warnings above reflect the original parsed data, not your edits below.`,
      variant: 'dim',
      isExplanation: true,
    });
  }
  inspectorBodyEl.append(
    buildGroup('warn', 'Data warnings', String(detail.warnings.length), hasWarnings, warnRows, hasWarnings || detail.editedFieldCount > 0),
  );

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
        { key: 'Date of birth', value: orDash(p.dob), fieldKey: 'patient.dob' },
        { key: 'Sex', value: orDash(p.sex) },
        { key: 'Address', value: orDash(p.address) },
        { key: 'Phone', value: orDash(p.phone), fieldKey: 'patient.phone' },
        { key: 'Rel. to insured', value: orDash(p.relationshipToInsured) },
        { key: 'Account no.', value: orDash(p.accountNumber), fieldKey: 'patient.accountNumber' },
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
        { key: 'Member ID', value: orDash(ins.memberId), fieldKey: 'insured.memberId' },
        { key: 'Group', value: orDash(ins.group), fieldKey: 'insured.group' },
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
    { key: 'Billing NPI', value: orDash(detail.providers.billing.npi), fieldKey: 'billingProvider.npi' },
    {
      key: 'Billing tax ID',
      value: detail.providers.billing.taxId
        ? `${detail.providers.billing.taxId}${detail.providers.billing.taxIdType ? ` (${detail.providers.billing.taxIdType})` : ''}`
        : '—',
      fieldKey: 'billingProvider.taxId',
      // The DISPLAYED value above includes the "(E)"/"(S)" tax-id-type
      // suffix — the only thing actually editable is the plain tax id, so
      // the inline edit form must seed from THAT, not the composed display
      // string (see this row's fieldKey / InspRow.editValue doc comment).
      editValue: detail.providers.billing.taxId,
    },
    { key: 'Billing address', value: orDash(detail.providers.billing.address) },
    { key: 'Billing phone', value: orDash(detail.providers.billing.phone) },
    { key: 'Taxonomy', value: orDash(detail.providers.billing.taxonomy) },
    { key: 'Rendering', value: orDash(detail.providers.rendering.name) },
    { key: 'Rendering NPI', value: orDash(detail.providers.rendering.npi), fieldKey: 'renderingProvider.npi' },
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

  // Institutional (UB-04) billing details — type of bill, discharge status,
  // condition/occurrence/value codes (docs/BUILD_QUEUE.md Build 2.2). `null`
  // for every non-institutional claim, so this group simply doesn't exist
  // for cms1500/dental/unsupported forms — never rendered empty.
  if (detail.institutional) {
    inspectorBodyEl.append(buildGroup('billing', 'Billing details', 'FL 4 / 17 / 18–41', false, buildInstitutionalRows(detail.institutional), false));
  }

  // Diagnoses
  const dxRows: InspRow[] = detail.diagnoses.map((d, i) => ({
    key: d.pointer || `#${d.ordinal}`,
    value: orDash(d.code),
    fieldKey: `diagnoses[${i}].code`,
  }));
  inspectorBodyEl.append(buildGroup('dx', 'Diagnoses', tags.diagnoses, false, dxRows, false));

  // Service lines. docs/BUILD_QUEUE.md Build 2.2: the composite per-line
  // summary already mixed several raw fields into one row before this
  // build (dates/proc/modifiers/ptr/rev/tooth/units/charge) — that raw
  // string is unchanged here (still what click-to-copy/Ctrl+C emit, per
  // this file's header). Decoded place-of-service/revenue-code/modifier
  // text is appended as this row's `decoded` (a visually distinct sibling,
  // never folded into the raw string). `pos <code>` is added to the raw
  // parts alongside the existing `rev <code>` so a professional line's
  // place-of-service code is visible at all (it wasn't shown here before).
  const lineRows: InspRow[] = detail.serviceLines.flatMap((l, i) => {
    const parts: string[] = [];
    parts.push(l.dates || '—');
    const proc = l.modifiers ? `${l.procCode || '—'}-${l.modifiers.replace(/ /g, '-')}` : l.procCode || '—';
    parts.push(proc);
    if (l.diagPointers) parts.push(`ptr ${l.diagPointers}`);
    if (l.placeOfService) parts.push(`pos ${l.placeOfService}`);
    if (l.revenueCode) parts.push(`rev ${l.revenueCode}`);
    if (l.toothNumbers) parts.push(`tooth ${l.toothNumbers}`);
    parts.push(`×${l.units || '1'}`);
    parts.push(formatMoney(l.charge));

    const decodedBits: string[] = [];
    if (l.placeOfServiceDecoded) decodedBits.push(l.placeOfServiceDecoded);
    if (l.revenueCodeDecoded) decodedBits.push(l.revenueCodeDecoded);
    for (const mod of l.modifierDecodings) {
      if (mod.decoded) decodedBits.push(`${mod.raw}: ${mod.decoded}`);
    }

    const summaryRow: InspRow = { key: `Line ${l.line}`, value: parts.join('  ·  ') };
    if (decodedBits.length > 0) summaryRow.decoded = decodedBits.join('  ·  ');

    // Editable fields (docs/EDITABLE_FIELDS_DESIGN.md §2): the composite
    // summary row above mixes several raw fields into one string, so it
    // can't itself carry a single fieldKey (see this file's header on why
    // composed values stay copy-only). Instead, one small editable sub-row
    // per registered per-line field is appended right under the summary —
    // shown whenever that field currently HAS an override (so the edit
    // stays visible per invariant 5, regardless of Edit mode) OR Edit mode
    // is on (so there's something to click to start editing it). Hidden
    // entirely otherwise, so a claim nobody has ever edited looks exactly
    // like it did before this feature.
    const editableLineFields: Array<{ suffix: string; fieldKey: string; value: string; editValue?: string }> = [
      { suffix: 'Procedure/HCPCS code', fieldKey: `serviceLines[${i}].procCode`, value: orDash(l.procCode) },
      { suffix: 'Modifiers', fieldKey: `serviceLines[${i}].modifiers`, value: orDash(l.modifiers) },
      { suffix: 'Units', fieldKey: `serviceLines[${i}].units`, value: orDash(l.units) },
      { suffix: 'Charge', fieldKey: `serviceLines[${i}].charge`, value: formatMoney(l.charge), editValue: l.charge.toFixed(2) },
    ];
    const subRows: InspRow[] = [];
    for (const f of editableLineFields) {
      const isEdited = detail.edits.some((e) => e.fieldPath === f.fieldKey);
      if (!isEdited && !state.editModeOn) continue;
      const row: InspRow = { key: `Line ${l.line} — ${f.suffix}`, value: f.value, variant: 'dim', fieldKey: f.fieldKey };
      if (f.editValue !== undefined) row.editValue = f.editValue;
      subRows.push(row);
    }

    return [summaryRow, ...subRows];
  });
  inspectorBodyEl.append(buildGroup('lines', 'Service lines', tags.lines, false, lineRows, false, buildLinesCopyBtn(tab, detail)));

  // Build 6, 6.1 — session-scoped per-line notes/flags/check-offs. See this
  // group's own header comment above (just below buildLinesCopyBtn) for why
  // it's a dedicated group rather than icons on the composite rows above.
  inspectorBodyEl.append(buildAnnotationsGroup(tab, detail));

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

  // Editable fields: "Revert all edits" only makes sense (and is only
  // shown) once there's at least one active override on THIS claim.
  clearOverridesBtn.hidden = detail.editedFieldCount === 0;

  updateExpandAllLabel();
  decorateEditableRows(tab, detail);
  for (const hook of postRenderHooks) hook();
}

// ---------------------------------------------------------------------------
// Editable fields — row decoration + inline edit UI
// (docs/EDITABLE_FIELDS_DESIGN.md §3/§4/§5)
// ---------------------------------------------------------------------------

/**
 * Single post-pass over every row carrying a `data-field-key` (set by
 * buildGroup above from `InspRow.fieldKey`) — adds the always-visible
 * "Edited" badge (invariant 5) and, only while Edit mode is on, the pencil
 * (start/change an edit) and revert (undo this one field) buttons. Kept as
 * one pass over the finished DOM, rather than threading edit state through
 * every buildGroup call site, so buildGroup itself stays a plain,
 * editing-unaware row renderer.
 */
function decorateEditableRows(tab: TabState, detail: ClaimDetailDto): void {
  const rows = Array.from(inspectorBodyEl.querySelectorAll<HTMLElement>('.inspRow[data-field-key]'));
  for (const rowEl of rows) {
    const fieldPath = rowEl.dataset['fieldKey'];
    if (!fieldPath || !detail.editableFieldPaths.includes(fieldPath)) continue;
    const valEl = rowEl.querySelector<HTMLElement>('.inspRowVal');
    if (!valEl) continue;
    const edit = detail.edits.find((e) => e.fieldPath === fieldPath);
    const keyText = rowEl.querySelector('.inspRowKey')?.textContent ?? 'field';

    if (edit) {
      const badge = document.createElement('span');
      badge.className = 'editedBadge';
      badge.textContent = 'Edited';
      badge.title = `Original value: ${edit.originalValue === '' ? '(blank)' : edit.originalValue}`;
      valEl.after(badge);
    }

    if (!state.editModeOn) continue;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'rowEditBtn';
    editBtn.tabIndex = -1;
    editBtn.setAttribute('aria-label', `Edit ${keyText}`);
    editBtn.title = `Edit ${keyText}`;
    editBtn.innerHTML = ICON_EDIT;
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      startInlineEdit(tab, rowEl, fieldPath, rowEl.dataset['editValue'] ?? '');
    });
    rowEl.append(editBtn);

    if (edit) {
      const revertBtn = document.createElement('button');
      revertBtn.type = 'button';
      revertBtn.className = 'rowRevertBtn';
      revertBtn.tabIndex = -1;
      revertBtn.setAttribute('aria-label', `Revert ${keyText} to the original value`);
      revertBtn.title = `Revert ${keyText} to the original value`;
      revertBtn.innerHTML = ICON_REVERT;
      revertBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        void revertField(tab, fieldPath);
      });
      rowEl.append(revertBtn);
    }
  }
}

/** Replaces a row's value (+ badge/edit/revert buttons) with an inline `<input>` + Save/Cancel, seeded from `currentValue` (InspRow.editValue when the displayed value differs from the raw editable one — see that field's doc comment). Cancel restores the row exactly as it was; Save calls setFieldOverride and, on success, a full inspector re-render (via notifyClaimDetailChanged) replaces this row entirely, so there's nothing to manually restore in that path. */
function startInlineEdit(tab: TabState, rowEl: HTMLElement, fieldPath: string, currentValue: string): void {
  if (rowEl.querySelector('.inspRowEditForm')) return; // already editing this row

  const form = document.createElement('div');
  form.className = 'inspRowEditForm';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inspRowEditInput';
  input.value = currentValue;
  input.setAttribute('aria-label', `New value for ${rowEl.querySelector('.inspRowKey')?.textContent ?? 'field'}`);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'linkBtn';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'linkBtn';
  cancelBtn.textContent = 'Cancel';

  const hiddenEls = Array.from(rowEl.children).filter(
    (el) => !el.classList.contains('inspRowKey') && !el.classList.contains('sevGlyph'),
  ) as HTMLElement[];
  const restore = (): void => {
    form.remove();
    hiddenEls.forEach((el) => {
      el.hidden = false;
    });
  };

  cancelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    restore();
  });
  const submit = (): void => {
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    void saveField(tab, fieldPath, input.value)
      .catch(() => {
        // Failure toast already shown by saveField; keep the form open
        // (with whatever the user typed) so they can correct and retry,
        // rather than silently discarding their input.
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      });
  };
  saveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    submit();
  });
  input.addEventListener('keydown', (event) => {
    // Never let this bubble to the delegated roving-tabindex/Ctrl+C listener
    // below while the user is typing a value.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      restore();
    }
  });

  form.append(input, saveBtn, cancelBtn);
  hiddenEls.forEach((el) => {
    el.hidden = true;
  });
  rowEl.append(form);
  input.focus();
  input.select();
}

async function saveField(tab: TabState, fieldPath: string, rawValue: string): Promise<void> {
  if (!tab.sessionId) return;
  try {
    const updated = await window.claimApi.setFieldOverride(tab.sessionId, tab.currentIndex, fieldPath, rawValue);
    tab.detail = updated;
    notifyClaimDetailChanged(tab);
  } catch (err) {
    showEditToast(editErrorMessage(err), true);
    throw err;
  }
}

async function revertField(tab: TabState, fieldPath: string): Promise<void> {
  if (!tab.sessionId) return;
  try {
    const updated = await window.claimApi.revertFieldOverride(tab.sessionId, tab.currentIndex, fieldPath);
    tab.detail = updated;
    notifyClaimDetailChanged(tab);
  } catch (err) {
    showEditToast(editErrorMessage(err), true);
  }
}

clearOverridesBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (!tab || !tab.sessionId) return;
  const sessionId = tab.sessionId;
  void (async () => {
    try {
      const updated = await window.claimApi.clearOverridesForClaim(sessionId, tab.currentIndex);
      tab.detail = updated;
      notifyClaimDetailChanged(tab);
    } catch (err) {
      showEditToast(editErrorMessage(err), true);
    }
  })();
});

expandAllBtn.addEventListener('click', () => {
  const groups = Array.from(inspectorBodyEl.querySelectorAll<HTMLDetailsElement>('details.inspGroup'));
  const allOpen = groups.length > 0 && groups.every((g) => g.open);
  for (const g of groups) {
    g.open = !allOpen;
    syncCaret(g);
  }
  updateExpandAllLabel();
});

/** Expands the inspector's drawer (if collapsed) and force-opens `groupId`'s `<details>`, returning it (or `null` if that group doesn't exist for this claim — e.g. 'billing' on a non-institutional form). Shared by revealWarningsInInspector (below) and jumpToWarningAnchor (item 7). */
function revealInspectorGroup(groupId: string): HTMLDetailsElement | null {
  state.inspectorOpen = true;
  updateInspectorVisibility();
  const group = inspectorBodyEl.querySelector<HTMLDetailsElement>(`details[data-group-id="${groupId}"]`);
  if (!group) return null;
  group.open = true;
  syncCaret(group);
  updateExpandAllLabel();
  return group;
}

function revealWarningsInInspector(): void {
  const warnGroup = revealInspectorGroup('warn');
  warnGroup?.scrollIntoView({ block: 'nearest' });
}

warnReviewBtn.addEventListener('click', revealWarningsInInspector);
statusWarnBtnEl.addEventListener('click', revealWarningsInInspector);

// ---------------------------------------------------------------------------
// Ease-of-use + accessibility batch, item 7 — clickable warnings, the
// inspector/DOM half only (docs/BUILD_QUEUE.md Build 3.5's deferred anchor
// work; the PDF-canvas-box half needs Build 3.4's per-box geometry, still
// deferred). Reveals and flashes the field/group a warning's anchor names,
// reusing search.ts's exact `.searchMatchActive` persistent-outline class —
// see style.css's `.inspGroup > summary.searchMatchActive` addition for the
// group-level (no specific line) case, since that CSS rule was originally
// scoped to `.inspRow` only.
// ---------------------------------------------------------------------------

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

function jumpToWarningAnchor(anchor: ClaimWarningAnchor): void {
  const group = revealInspectorGroup(anchor.groupId);
  if (!group) return;

  // Only one locator outline should ever be visible at a time — clears
  // search's own stepped-to match (or a previous warning jump) first.
  document.querySelectorAll<HTMLElement>('.searchMatchActive').forEach((el) => el.classList.remove('searchMatchActive'));

  let target: HTMLElement | null = null;
  const firstLine = anchor.lineNumbers?.[0];
  if (firstLine !== undefined) {
    target = Array.from(group.querySelectorAll<HTMLElement>('.inspRow')).find((r) => r.querySelector('.inspRowKey')?.textContent === `Line ${firstLine}`) ?? null;
  }
  // No specific line (or the named line isn't found, e.g. a stale anchor
  // after an edit changed line count) — flash the group's own heading.
  if (!target) target = group.querySelector<HTMLElement>('summary');
  if (!target) return;

  target.classList.add('searchMatchActive');
  target.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
