import type { ClaimSummaryDto } from '../../electron/preload.js';
import { tabStripEl } from './dom.js';
// Per-tab state's type shape (TabState/ZoomMode/Screen) and pdf.js document
// create/destroy (loadPdfDocument/setActivePdfDoc) now live in tabState.ts —
// split out so that module can be unit-tested (with an injectable fake
// pdf.js loader) without pulling in this file's DOM-coupled pieces, since
// dom.ts's module-level `requireEl` calls need a real `document` (see
// tabState.ts's header comment). Imported (not just re-exported) since this
// file's own code below still uses TabState/setActivePdfDoc directly;
// re-exported so every existing importer of tabs.ts (main.ts, preview.ts,
// inspector.ts, overlays.ts, shortcuts.ts) keeps working unchanged.
import { loadPdfDocument, setActivePdfDoc, type TabState, type ZoomMode, type Screen } from './tabState.js';
export { loadPdfDocument, setActivePdfDoc, type TabState, type ZoomMode, type Screen };

/**
 * Per-tab state (docs/ROADMAP.md §1 / docs/TABS_BUILD_PLAN.md §2 — the
 * multi-file-tabs build) plus the tab strip's DOM rendering and click
 * wiring. This is the natural home for both: every other renderer module
 * that used to read the single `state` singleton now reads a `TabState`
 * instead, and the strip is a pure reflection of `state.tabs` /
 * `state.activeTabId`.
 *
 * `screen` is deliberately NOT stored anywhere — it is DERIVED from the
 * active tab's status via `currentScreen()` below (no tabs -> welcome).
 * Only `inspectorOpen`, `theme` and `activeTabId` stay as genuine
 * cross-tab globals (see the literal `TabState`/`AppState` shapes, which
 * mirror docs/TABS_BUILD_PLAN.md §2's interface exactly — `TabState`/
 * `ZoomMode`/`Screen` now live in tabState.ts, imported/re-exported above).
 */

export interface AppState {
  tabs: TabState[];
  activeTabId: string | null;
  inspectorOpen: boolean;
  theme: 'light' | 'dark';
}

export const state: AppState = {
  tabs: [],
  activeTabId: null,
  inspectorOpen: true,
  theme: 'light',
};

// ---------------------------------------------------------------------------
// Lookups / derived screen
// ---------------------------------------------------------------------------

export function activeTab(): TabState | null {
  if (state.activeTabId === null) return null;
  return state.tabs.find((t) => t.tabId === state.activeTabId) ?? null;
}

export function findTabById(tabId: string): TabState | null {
  return state.tabs.find((t) => t.tabId === tabId) ?? null;
}

export function findTabBySessionId(sessionId: string): TabState | null {
  return state.tabs.find((t) => t.sessionId === sessionId) ?? null;
}

/**
 * Finds a tab by its (main-resolved, absolute) file path — used by
 * performOpen's dedupe (docs/AUDIT_BUILD1.md MUST FIX #3) to catch a
 * lazily-restored `'unloaded'` tab, which has `sessionId: null` and so is
 * invisible to findTabBySessionId, when the SAME file is reopened before
 * that tab is ever activated. Without this, reopening it would mint a
 * brand-new session/tab instead of filling in the existing placeholder, and
 * later activating the original placeholder would get handed that same
 * fresh session by main's own path-based dedupe — leaving two TabStates
 * sharing one main-process sessionId, so closing either kills the other.
 */
export function findTabByFilePath(filePath: string): TabState | null {
  return state.tabs.find((t) => t.filePath !== '' && t.filePath === filePath) ?? null;
}

/**
 * The screen to show, derived purely from tab state — never an independent
 * flag (docs/TABS_BUILD_PLAN.md §2). No tabs at all -> welcome. Otherwise
 * the active tab's own status decides it. `'unloaded'` (reserved for a
 * future lazy session-restore, §2e — not created anywhere in this build)
 * is treated the same as `'loading'` since nothing renders for it yet
 * either.
 */
export function currentScreen(): Screen {
  const tab = activeTab();
  if (!tab) return 'welcome';
  switch (tab.status) {
    case 'loading':
    case 'unloaded':
      return 'loading';
    case 'error':
      return 'error';
    case 'ready':
      return 'workspace';
  }
}

// ---------------------------------------------------------------------------
// Tab CRUD
// ---------------------------------------------------------------------------

let tabIdSeq = 0;
function newTabId(): string {
  tabIdSeq += 1;
  return `tab-${Date.now()}-${tabIdSeq}`;
}

export interface NewTabInput {
  sessionId?: string | null;
  fileName?: string;
  filePath?: string;
  source?: 'json' | 'x12' | null;
  summaries?: ClaimSummaryDto[];
  status?: TabState['status'];
}

/**
 * Appends a new tab and makes it active. Called both for a fully-known new
 * file (main.ts's `tabInputFromResult`) and, with no arguments at all, for
 * a bare placeholder — a tab in `status: 'loading'` with everything else
 * empty, used only when there is no OTHER tab yet to derive a 'loading'
 * screen from while a brand-new file's open+parse IPC call is in flight
 * (see main.ts's `performOpen`). Never renders the strip's DOM itself for
 * the caller to sequence around a loading floor — it always does, since the
 * strip must never visibly lag the state it reflects.
 */
/**
 * `activate`: docs/AUDIT_BUILD1.md MUST FIX #1 — createTab used to set
 * `state.activeTabId` itself unconditionally, so opening a file while
 * another tab was already showing silently made the brand-new (not-yet-
 * loaded) tab "active" the instant it was created, well before
 * `main.ts`'s `activateTabById` ever ran for it. By the time
 * `activateTabById` DID run, `activeTab()` (reading the already-changed
 * `state.activeTabId`) returned the SAME new tab as both "previous" and
 * "next", so `switchingAway` was false and neither `cancelInFlightRender`
 * nor the background-release `setActivePdfDoc(previousTab, null)` call ever
 * fired for the tab that had actually been on screen — leaking one live
 * pdf.js document/worker per background-opened file. `activateTabById` is
 * now the ONLY writer of `state.activeTabId` for every path except the
 * very-first-tab placeholder (there is no "previous" tab to release in that
 * case, and something must be active immediately so `currentScreen()` has a
 * tab to derive 'loading' from during the open's IPC round-trip) — that one
 * caller opts in via `activate: true`. Defaults to `false`.
 */
export function createTab(input: NewTabInput = {}, opts: { activate?: boolean } = {}): TabState {
  const tab: TabState = {
    tabId: newTabId(),
    sessionId: input.sessionId ?? null,
    status: input.status ?? 'loading',
    filePath: input.filePath ?? '',
    fileName: input.fileName ?? '',
    source: input.source ?? null,
    summaries: input.summaries ?? [],
    currentIndex: 0,
    detail: null,
    pdfDoc: null,
    pageNum: 1,
    pageCount: 1,
    zoom: 1,
    zoomMode: 'fit-page',
    errorMessage: '',
  };
  state.tabs.push(tab);
  if (opts.activate) state.activeTabId = tab.tabId;
  renderTabStrip();
  return tab;
}

export interface CloseTabResult {
  nextActiveTabId: string | null;
}

/** Removes a tab, releasing its pdf.js document (setActivePdfDoc) and its main-process session (claimApi.closeSession) so its PHI leaves memory immediately — same guarantee the old "cleared on window close" behavior gave, now per-tab. Picks a sensible next active tab if the closed one was active (the tab that slid into its spot, i.e. the next one to the right; the new last tab if it was the rightmost). */
export async function closeTab(tabId: string): Promise<CloseTabResult> {
  const idx = state.tabs.findIndex((t) => t.tabId === tabId);
  if (idx === -1) return { nextActiveTabId: state.activeTabId };
  const [tab] = state.tabs.splice(idx, 1);
  if (tab) {
    await setActivePdfDoc(tab, null);
    if (tab.sessionId) {
      try {
        await window.claimApi.closeSession(tab.sessionId);
      } catch {
        // Best-effort: the renderer's tab list is already the source of
        // truth for "is this open"; a failed IPC here just means main's
        // session map cleans up slightly late.
      }
    }
  }

  if (state.activeTabId === tabId) {
    const next = state.tabs[idx] ?? state.tabs[idx - 1] ?? null;
    state.activeTabId = next ? next.tabId : null;
  }
  renderTabStrip();
  return { nextActiveTabId: state.activeTabId };
}

/** Sets the active tab id and re-renders the strip. Pure state — callers (main.ts's activateTabById) are responsible for loading/rendering the newly-active tab's content. */
export function setActiveTab(tabId: string): void {
  if (!findTabById(tabId)) return;
  state.activeTabId = tabId;
  renderTabStrip();
}

// ---------------------------------------------------------------------------
// Tab strip DOM
// ---------------------------------------------------------------------------

/** Middle-ellipsizes a filename for the tab label (§2b: "middle-ellipsized" filename) — keeps more of the front (usually the meaningful part of a filename) than the back. CSS text-overflow:ellipsis on .tabLabel is a pixel-accurate safety net on top of this for edge cases (very narrow tabs, wide glyphs) where the character-count estimate still overflows. */
function middleEllipsize(name: string, maxChars = 22): string {
  if (name.length <= maxChars) return name;
  const keep = maxChars - 1; // reserve one slot for the ellipsis character
  const front = Math.ceil(keep * 0.6);
  const back = keep - front;
  return `${name.slice(0, front)}…${name.slice(name.length - back)}`;
}

export function renderTabStrip(): void {
  // docs/AUDIT_BUILD1.md MUST FIX #6: this wipes and rebuilds every `.tab`
  // node on every call (tab open/close/switch, and every claim step, since
  // ensureClaimRendered re-renders the strip too) — capture whether keyboard
  // focus was actually inside the strip BEFORE the wipe, so it can be
  // restored onto the (freshly rebuilt) active tab afterward, instead of
  // silently falling to <body>. When there's no active tab left afterward
  // (the strip is now empty — the last tab just closed), there is nothing
  // here to refocus; main.ts's closeTabById handles that case by focusing
  // the welcome screen's primary button instead, since this module has no
  // reason to know about it.
  const focusWasInStrip = document.activeElement instanceof Node && tabStripEl.contains(document.activeElement);
  tabStripEl.hidden = state.tabs.length === 0;
  tabStripEl.innerHTML = '';
  for (const tab of state.tabs) {
    const isActive = tab.tabId === state.activeTabId;
    const displayName = tab.fileName || 'Opening…';

    const el = document.createElement('div');
    el.className = 'tab' + (isActive ? ' isActive' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    el.tabIndex = isActive ? 0 : -1;
    el.dataset['tabId'] = tab.tabId;
    // Testability only (no behavior reads this): lets E2E assert lazy
    // session restore (docs/TABS_BUILD_PLAN.md §2e) actually left a
    // background tab 'unloaded' rather than eagerly loading every restored
    // tab.
    el.dataset['tabStatus'] = tab.status;
    // Testability only (no behavior reads this — sessionId is an opaque
    // crypto.randomUUID(), never PHI): lets E2E confirm the shared-session
    // dedupe bug (docs/AUDIT_BUILD1.md MUST FIX #3) stays fixed, and that a
    // closed tab's session actually stops serving claims (coverage gap #6),
    // without any way to reach the sessionId value from the DOM otherwise.
    el.dataset['tabSessionId'] = tab.sessionId ?? '';

    const label = document.createElement('span');
    label.className = 'tabLabel';
    label.textContent = middleEllipsize(displayName);
    label.title = displayName;
    el.append(label);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'iconBtn tabClose';
    close.setAttribute('aria-label', `Close ${displayName}`);
    // docs/AUDIT_BUILD1.md MUST FIX #4: without this, every tab's close
    // button was a full, native `tabIndex="0"` Tab stop nested inside the
    // `.tab` div, doubling the tab strip's tab-stop count and defeating the
    // roving-tabindex pattern the `.tab` elements themselves already use
    // (only the active `.tab` is index 0, see above) — "one tab in the tab
    // order" (docs/TABS_BUILD_PLAN.md §3a). Closing by keyboard is Delete/
    // Backspace on the focused tab (see initTabStrip's keydown handler
    // below), not a second Tab stop on its close button.
    close.tabIndex = -1;
    close.dataset['tabClose'] = tab.tabId;
    close.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    el.append(close);

    tabStripEl.append(el);
  }

  const activeEl = tabStripEl.querySelector<HTMLElement>('.tab.isActive');
  activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focusWasInStrip) activeEl?.focus();
}

export interface TabStripDeps {
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

/** Wires the strip's click/middle-click handling once via event delegation, so renderTabStrip() can freely rebuild its children on every state change without re-attaching listeners. Actual tab-switch/close orchestration (loading, pdf lifecycle, chrome re-render) lives in main.ts and is injected here as callbacks — mirrors shortcuts.ts's ShortcutDeps pattern, avoiding a tabs.ts <-> main.ts import cycle. */
export function initTabStrip(deps: TabStripDeps): void {
  tabStripEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const closeBtn = target.closest<HTMLElement>('[data-tab-close]');
    if (closeBtn) {
      event.stopPropagation();
      const id = closeBtn.dataset['tabClose'];
      if (id) deps.onClose(id);
      return;
    }
    const tabEl = target.closest<HTMLElement>('.tab');
    const id = tabEl?.dataset['tabId'];
    if (id) deps.onActivate(id);
  });

  // Middle-click closes a tab (§2b polish). `auxclick` (not `click`, which
  // never fires for the middle button in Chromium, or `mousedown`, which
  // would double-fire with drag/scroll handling) is the correct listener
  // for a non-primary-button activation.
  tabStripEl.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    const target = event.target as HTMLElement;
    const tabEl = target.closest<HTMLElement>('.tab');
    const id = tabEl?.dataset['tabId'];
    if (id) {
      event.preventDefault();
      deps.onClose(id);
    }
  });

  /**
   * docs/AUDIT_BUILD1.md MUST FIX #5: `#tabStrip` declares `role="tablist"`
   * and each `.tab` gets `role="tab"`/`aria-selected`/a roving tabindex
   * (renderTabStrip above), but nothing ever listened for a keydown on the
   * strip at all — a focused `.tab` (a plain `<div>`, so Enter/Space do
   * nothing natively) was a dead end: Left/Right/Home/End never moved the
   * roving index, per the APG tablist pattern docs/TABS_BUILD_PLAN.md
   * §3a/§2b require. Modeled on inspector.ts's roving-tabindex delegated
   * listener. Left/Right/Home/End both move focus AND activate the target
   * tab (automatic-activation model — matches this strip's mouse click
   * behavior, where clicking a tab both focuses and activates it in one
   * step); Enter/Space activate whatever's already focused; Delete/
   * Backspace close it (the close button itself is tabIndex=-1 — see
   * MUST FIX #4 above — this is the only keyboard path to close a tab from
   * the strip).
   */
  tabStripEl.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const tabEl = target.closest<HTMLElement>('.tab');
    if (!tabEl) return;
    const id = tabEl.dataset['tabId'];
    if (!id) return;

    const tabs = Array.from(tabStripEl.querySelectorAll<HTMLElement>('.tab'));
    const idx = tabs.indexOf(tabEl);
    if (idx === -1) return;

    // Activates `tabs[nextIdx]` and moves focus onto it. Re-queries the DOM
    // for the target tab's element by id rather than reusing `tabs[nextIdx]`
    // directly: `deps.onActivate` (main.ts's `activateTabById`) runs
    // synchronously up to its own first `await` — which is AFTER it calls
    // `setActiveTab`/`renderTabStrip()` — so by the time this call returns,
    // the strip's DOM has already been wiped and rebuilt (every `.tab` node,
    // including the one this closure captured, is stale/detached).
    const focusAndActivate = (nextIdx: number): void => {
      const nextEl = tabs[nextIdx];
      const nextId = nextEl?.dataset['tabId'];
      if (!nextId) return;
      deps.onActivate(nextId);
      tabStripEl.querySelector<HTMLElement>(`.tab[data-tab-id="${nextId}"]`)?.focus();
    };

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusAndActivate((idx + 1) % tabs.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusAndActivate((idx - 1 + tabs.length) % tabs.length);
        break;
      case 'Home':
        event.preventDefault();
        focusAndActivate(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndActivate(tabs.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        deps.onActivate(id);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        deps.onClose(id);
        break;
    }
  });
}
