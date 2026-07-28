import {
  inspectorBodyEl,
  inspectorSearchInputEl,
  inspectorSearchClearBtn,
  inspectorSearchOtherClaimsBtn,
  inspectorSearchSummaryEl,
  expandAllBtn,
} from '../dom.js';
import { state, activeTab, currentScreen } from '../tabs.js';
import { updateInspectorVisibility, onInspectorRendered } from '../inspector.js';
import { formatMoney, formTypeText } from '../format.js';
import { anyOverlayOpen } from '../overlays.js';
import {
  computeRowMatches,
  computeOtherClaimMatches,
  formatMatchSummaryText,
  formatEmptyStateText,
  formatOtherClaimsButtonLabel,
  type SearchableRow,
  type OtherClaimSummary,
  type OtherClaimSearchResult,
} from './searchMatch.js';

/**
 * Ctrl+F find/search across the parsed claim (docs/
 * UI_REQUIREMENTS_v3_queued_features.md §1, docs/BUILD_QUEUE.md Build 2.1)
 * — the last piece of Build 2. Filters the inspector's field rows to those
 * matching the query, keeping every match's group heading visible, with a
 * match count + step-through + an 837 batch's cross-claim summary.
 *
 * Pure matching/normalization/formatting logic lives in searchMatch.ts (no
 * DOM — vitest-testable in Node); this file is the DOM wiring: the search
 * field itself, live filtering of the real `.inspGroup`/`.inspRow` elements
 * inspector.ts builds, and the group open-state capture/restore this file's
 * header comment on the critical detail below explains.
 *
 * CRITICAL DETAIL (docs/AUDIT_BUILD1.md — hard-won on Build 1's inspector,
 * called out again for this build): inspector.ts's groups are `<details>`
 * elements that render COLLAPSED (insured, providers, diagnoses, service
 * lines, raw). A naive filter reports "7 matches in 3 groups" while showing
 * none of them. So:
 *   - Groups containing a match are FORCE-OPENED while a query is active.
 *   - Each group's prior `.open` is captured on the FIRST keystroke of a
 *     search session (empty -> non-empty transition) and restored VERBATIM
 *     when the query is cleared or Esc is pressed — otherwise Esc silently
 *     destroys the user's manually-arranged inspector layout.
 *   - "Expand all" (expandAllBtn) is disabled while a query is active.
 *   - Ctrl+F is a no-op with no file open (never steals focus). If the
 *     inspector is collapsed, it's expanded first, then the field is
 *     focused.
 */

// ---------------------------------------------------------------------------
// Module state. `query` and `priorOpenState` are the only things that
// persist across an inspector re-render (tab switch / claim step / a
// cross-claim search jump all call inspector.ts's renderInspector(), which
// tears down and rebuilds every `.inspGroup`/`.inspRow` node from scratch —
// see onInspectorRendered's registration below) — everything else here
// (the live match list, the step-through position) is recomputed fresh
// every time reapply() runs, since the DOM nodes it references may no
// longer exist.
// ---------------------------------------------------------------------------

let query = '';
/** Captured once per search session (on the empty -> non-empty transition), keyed by `data-group-id`; `null` when no query is active. */
let priorOpenState: Map<string, boolean> | null = null;
/** Whatever had focus immediately before the search field did (captured via the field's own `focus` event's `relatedTarget` — covers both Ctrl+F and a plain click into the field) — where Esc returns focus to. */
let priorFocusEl: HTMLElement | null = null;

/** The current step-through (Enter/Shift+Enter) sequence, in DOM order — rebuilt by applyActiveFilter() on every keystroke and every re-render. */
let currentMatchEls: HTMLElement[] = [];
let currentMatchIndex = -1;

let lastTotalMatches = 0;
let lastGroupMatchCount = 0;
let lastOtherClaims: OtherClaimSearchResult = { totalMatches: 0, matches: [] };

let ariaLiveDebounceTimer: number | undefined;
/** Debounces the aria-live TEXT announcement to the settled query (docs/UI_REQUIREMENTS_v3_queued_features.md §1) — the visual filter itself (row/group show-hide) is never debounced, only the screen-reader announcement, so a sighted user seytping "1204" doesn't visually lag but a screen-reader user isn't read four separate "1", "12", "120", "1204" announcements while they're still typing. */
const ARIA_DEBOUNCE_MS = 300;

export interface SearchDeps {
  /** Switches the active tab's claim to `index` and re-renders, WITHOUT touching search state (search.ts's own module state — query/priorOpenState — is untouched by a claim switch; reapply() below re-filters the freshly-rendered inspector against the same still-active query, which is exactly "jumping switches the active claim and preserves the query" from the spec). Injected from main.ts (which owns claim-loading) to avoid a features/search.ts <-> main.ts import cycle — the same deps-injection pattern shortcuts.ts's ShortcutDeps and tabs.ts's TabStripDeps already use. */
  jumpToClaim: (index: number) => void | Promise<void>;
}

let deps: SearchDeps | null = null;

// ---------------------------------------------------------------------------
// prefers-reduced-motion (declared independently here, same as every other
// per-file read of this OS setting in this app — see overlays.ts's own copy
// for the precedent) — only affects whether stepping to a match scrolls
// smoothly or jumps straight there.
// ---------------------------------------------------------------------------

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

// ---------------------------------------------------------------------------
// Group open-state capture/restore (the critical detail — see header)
// ---------------------------------------------------------------------------

function allGroupEls(): HTMLDetailsElement[] {
  return Array.from(inspectorBodyEl.querySelectorAll<HTMLDetailsElement>('details.inspGroup'));
}

function capturePriorOpenState(): void {
  const map = new Map<string, boolean>();
  for (const g of allGroupEls()) {
    const id = g.dataset['groupId'];
    if (id) map.set(id, g.open);
  }
  priorOpenState = map;
}

/** Un-hides every group/row this file may have hidden and restores each group's captured `.open` — called both when the query empties out via typing and when Esc is pressed. Never touches focus (callers decide that). */
function clearFilterVisuals(): void {
  for (const g of allGroupEls()) {
    g.hidden = false;
    const id = g.dataset['groupId'];
    if (priorOpenState && id && priorOpenState.has(id)) {
      g.open = priorOpenState.get(id)!;
    }
    const rows = Array.from(g.querySelectorAll<HTMLElement>('.inspRow'));
    rows.forEach((r, i) => {
      r.hidden = false;
      r.classList.remove('searchMatchActive');
      r.tabIndex = i === 0 ? 0 : -1;
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-claim (837 batch) matching over the tab's already-loaded summaries
// — see searchMatch.ts's header comment on OtherClaimSummary for why this
// is summary-level, not full per-field detail.
// ---------------------------------------------------------------------------

function computeOtherClaimsForActiveTab(): OtherClaimSearchResult {
  const tab = activeTab();
  if (!tab || tab.summaries.length <= 1) return { totalMatches: 0, matches: [] };
  const others: OtherClaimSummary[] = tab.summaries
    .map((s, i) => ({ index: i, claimId: s.claimId, patientName: s.patientName, formTypeLabel: formTypeText(s.formType), totalLabel: formatMoney(s.total) }))
    .filter((s) => s.index !== tab.currentIndex);
  return computeOtherClaimMatches(others, query);
}

// ---------------------------------------------------------------------------
// The filter itself
// ---------------------------------------------------------------------------

/** Applies `query` (already known non-empty) to the currently-rendered inspector: hides non-matching groups entirely, hides non-matching rows within a matching group (keeping the group's heading + any matched/context rows visible), force-opens every matching group, and re-derives the roving-tabindex "first visible row" per group (docs/AUDIT_BUILD1.md-style guardrail: the roving-tabindex composite must never point tabIndex=0 at a hidden row — see inspector.ts's own keydown handler, which was updated alongside this file to only walk `:not([hidden])` rows). */
function applyActiveFilter(): void {
  inspectorBodyEl.querySelectorAll<HTMLElement>('.searchMatchActive').forEach((el) => el.classList.remove('searchMatchActive'));

  let totalMatches = 0;
  const matchedGroupIds = new Set<string>();
  currentMatchEls = [];
  currentMatchIndex = -1;

  for (const group of allGroupEls()) {
    const groupId = group.dataset['groupId'] ?? '';
    const rowEls = Array.from(group.querySelectorAll<HTMLElement>('.inspRow'));
    const searchRows: SearchableRow[] = rowEls.map((el, i) => ({
      id: String(i),
      groupId,
      key: el.dataset['searchKey'] ?? '',
      value: el.dataset['searchValue'] ?? '',
      isExplanation: el.classList.contains('inspRowExplain'),
    }));
    const result = computeRowMatches(searchRows, query);
    const groupHasMatch = result.matches.length > 0;
    group.hidden = !groupHasMatch;
    if (!groupHasMatch) continue;

    matchedGroupIds.add(groupId);
    if (!group.open) group.open = true;

    let firstVisible: HTMLElement | null = null;
    rowEls.forEach((rowEl, i) => {
      const r = result.rows[i]!;
      rowEl.hidden = !r.visible;
      rowEl.tabIndex = -1;
      if (r.visible && !firstVisible) firstVisible = rowEl;
    });
    if (firstVisible) (firstVisible as HTMLElement).tabIndex = 0;

    for (const m of result.matches) {
      currentMatchEls.push(rowEls[Number(m.id)]!);
      totalMatches++;
    }
  }

  lastTotalMatches = totalMatches;
  lastGroupMatchCount = matchedGroupIds.size;
  lastOtherClaims = computeOtherClaimsForActiveTab();
}

// ---------------------------------------------------------------------------
// aria-live summary + the "N more matches in M other claims" control
// ---------------------------------------------------------------------------

function renderAriaLiveNow(): void {
  if (query === '') {
    inspectorSearchSummaryEl.textContent = '';
    inspectorSearchOtherClaimsBtn.hidden = true;
    return;
  }
  const otherClaimsInfo = { totalMatches: lastOtherClaims.totalMatches, claimCount: lastOtherClaims.matches.length };
  const text =
    lastTotalMatches === 0
      ? formatEmptyStateText(query, otherClaimsInfo)
      : formatMatchSummaryText(lastTotalMatches, lastGroupMatchCount, currentMatchIndex >= 0 ? currentMatchIndex + 1 : null, otherClaimsInfo);
  inspectorSearchSummaryEl.textContent = text;

  if (otherClaimsInfo.claimCount > 0) {
    inspectorSearchOtherClaimsBtn.hidden = false;
    inspectorSearchOtherClaimsBtn.textContent = formatOtherClaimsButtonLabel(otherClaimsInfo);
  } else {
    inspectorSearchOtherClaimsBtn.hidden = true;
  }
}

function scheduleAriaLiveUpdate(immediate: boolean): void {
  if (ariaLiveDebounceTimer !== undefined) {
    window.clearTimeout(ariaLiveDebounceTimer);
    ariaLiveDebounceTimer = undefined;
  }
  if (immediate) {
    renderAriaLiveNow();
    return;
  }
  ariaLiveDebounceTimer = window.setTimeout(() => {
    ariaLiveDebounceTimer = undefined;
    renderAriaLiveNow();
  }, ARIA_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Step-through (Enter / Shift+Enter) — a persistent outline (`.searchMatchActive`,
// style.css), never a flash: it stays on the current match until stepped
// away from or the query changes, per the low-vision reviewers' explicit
// ask (docs/UI_REQUIREMENTS_v3_queued_features.md §1).
// ---------------------------------------------------------------------------

function stepMatch(delta: number): void {
  if (currentMatchEls.length === 0) return;
  const prev = currentMatchIndex >= 0 ? currentMatchEls[currentMatchIndex] : undefined;
  prev?.classList.remove('searchMatchActive');
  currentMatchIndex = ((currentMatchIndex + delta) % currentMatchEls.length + currentMatchEls.length) % currentMatchEls.length;
  const target = currentMatchEls[currentMatchIndex]!;
  target.classList.add('searchMatchActive');
  target.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  scheduleAriaLiveUpdate(true);
}

// ---------------------------------------------------------------------------
// Query lifecycle
// ---------------------------------------------------------------------------

function onQueryInput(): void {
  const wasActive = query !== '';
  query = inspectorSearchInputEl.value;

  if (!wasActive && query !== '') capturePriorOpenState();

  if (query === '') {
    clearFilterVisuals();
    priorOpenState = null;
    currentMatchEls = [];
    currentMatchIndex = -1;
    inspectorSearchClearBtn.hidden = true;
    expandAllBtn.disabled = false;
    scheduleAriaLiveUpdate(true);
    return;
  }

  applyActiveFilter();
  inspectorSearchClearBtn.hidden = false;
  expandAllBtn.disabled = true;
  scheduleAriaLiveUpdate(false);
}

/** Esc / the clear (✕) button both funnel here — restoring the captured group layout is identical either way; only what happens to focus differs (see the two call sites below). */
function clearQuery(): void {
  inspectorSearchInputEl.value = '';
  query = '';
  clearFilterVisuals();
  priorOpenState = null;
  currentMatchEls = [];
  currentMatchIndex = -1;
  inspectorSearchClearBtn.hidden = true;
  expandAllBtn.disabled = false;
  scheduleAriaLiveUpdate(true);
}

/**
 * Re-applies whatever query is currently active to a freshly-rendered
 * inspector (registered as an inspector.ts post-render hook — see this
 * file's header). A no-op when there's no active query: a plain re-render
 * with no search in progress needs nothing from this file at all.
 */
function reapply(): void {
  if (query === '') return;
  applyActiveFilter();
  scheduleAriaLiveUpdate(true);
}

// ---------------------------------------------------------------------------
// Ctrl+F (shortcuts.ts) / init
// ---------------------------------------------------------------------------

/**
 * Ctrl+F: a no-op with no file open (never steals focus — docs/
 * UI_REQUIREMENTS_v3_queued_features.md §1) or while a modal dialog is open
 * (focusing the inspector out from under an open dialog would break its
 * focus trap). If the inspector is collapsed, it's force-expanded first,
 * then the field is focused.
 */
export function focusSearch(): void {
  if (currentScreen() !== 'workspace') return;
  if (anyOverlayOpen()) return;
  if (!activeTab()) return;

  if (!state.inspectorOpen) {
    state.inspectorOpen = true;
    updateInspectorVisibility();
  }
  inspectorSearchInputEl.focus();
  inspectorSearchInputEl.select();
}

export function initSearch(searchDeps: SearchDeps): void {
  deps = searchDeps;
  onInspectorRendered(reapply);

  inspectorSearchInputEl.addEventListener('input', onQueryInput);

  inspectorSearchInputEl.addEventListener('focus', (event: FocusEvent) => {
    if (event.relatedTarget instanceof HTMLElement) priorFocusEl = event.relatedTarget;
  });

  inspectorSearchInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Own this key entirely — stopPropagation so the window-level
      // dispatcher (shortcuts.ts) never also runs its Escape handling
      // (close-topmost-overlay / closeAllMenus) for the same press; this is
      // exclusively "clear the query and return focus to where it came
      // from" while the search field has focus.
      event.preventDefault();
      event.stopPropagation();
      if (query !== '') clearQuery();
      const toFocus = priorFocusEl;
      priorFocusEl = null;
      toFocus?.focus();
      return;
    }
    if (event.key === 'Enter' && query !== '') {
      event.preventDefault();
      event.stopPropagation();
      stepMatch(event.shiftKey ? -1 : 1);
    }
  });

  inspectorSearchClearBtn.addEventListener('click', () => {
    clearQuery();
    inspectorSearchInputEl.focus();
  });

  inspectorSearchOtherClaimsBtn.addEventListener('click', () => {
    const target = lastOtherClaims.matches[0];
    if (!target || !deps) return;
    void deps.jumpToClaim(target.index);
  });
}
