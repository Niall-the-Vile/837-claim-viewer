import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
// `?url` gives Vite's resolved asset URL for the worker file (bundled and
// copied into dist/renderer at build time) instead of trying to parse it as
// a JS module — this is what keeps the pdf.js worker fully local/offline;
// it is never fetched from a CDN. Set here (rather than preview.ts) because
// this module owns the one place pdf.js documents are ever created
// (loadPdfDocument below), and workerSrc must be set before the first call.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ClaimSummaryDto, ClaimDetailDto } from '../../electron/preload.js';
import { tabStripEl } from './dom.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
 * cross-tab globals (see the literal `TabState`/`AppState` shapes below,
 * which mirror docs/TABS_BUILD_PLAN.md §2's interface exactly).
 */

export type Screen = 'welcome' | 'loading' | 'error' | 'workspace';
export type ZoomMode = 'manual' | 'fit-page' | 'fit-width';

export interface TabState {
  tabId: string;
  sessionId: string | null;
  status: 'unloaded' | 'loading' | 'ready' | 'error';
  filePath: string;
  fileName: string;
  source: 'json' | 'x12' | null;
  summaries: ClaimSummaryDto[];
  currentIndex: number;
  detail: ClaimDetailDto | null;

  pdfDoc: PDFDocumentProxy | null;
  pageNum: number;
  pageCount: number;
  zoom: number;
  zoomMode: ZoomMode;

  errorMessage: string;
}

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
// pdf.js document lifecycle — THE single place a tab's `pdfDoc` is ever
// created or reassigned. pdf.js documents leaked before tabs existed at all
// (every claim step / re-open / close abandoned the previous
// PDFDocumentProxy with no destroy call anywhere) — this fixes the root
// cause, not just the tabs symptom, by awaiting the outgoing document's
// real destroy() before adopting the new one. Every assignment site (claim
// step, file open, tab close, tab deactivate/background-release — see
// src/renderer/main.ts) routes through setActivePdfDoc below.
// ---------------------------------------------------------------------------

/**
 * pdf.js's actual `destroy()` lives on the `PDFDocumentLoadingTask` that
 * `getDocument()` returns, NOT on the `PDFDocumentProxy` its `.promise`
 * resolves to (the proxy has no destroy method at all in this pdf.js
 * version). `TabState.pdfDoc` is typed as the proxy per
 * docs/TABS_BUILD_PLAN.md §2's literal interface — that's the only part the
 * rest of the renderer (preview.ts's getPage/render calls) ever needs. This
 * map is the bridge: loadPdfDocument() below registers each proxy's owning
 * loading task, and setActivePdfDoc() looks it up to call the task's real
 * destroy() when a tab's pdfDoc is replaced or cleared.
 */
const loadingTasksByDoc = new WeakMap<PDFDocumentProxy, PDFDocumentLoadingTask>();

/** Loads a claim's PDF bytes into a fresh pdf.js document. pdf.js may transfer/detach the buffer it's given; hand it a fresh copy so re-rendering (stepping back and forth, zooming) never operates on a stale one. */
export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  loadingTasksByDoc.set(doc, loadingTask);
  return doc;
}

export async function setActivePdfDoc(tab: TabState, doc: PDFDocumentProxy | null): Promise<void> {
  const old = tab.pdfDoc;
  if (old && old !== doc) {
    const loadingTask = loadingTasksByDoc.get(old);
    loadingTasksByDoc.delete(old);
    try {
      if (loadingTask) await loadingTask.destroy();
    } catch {
      // pdf.js destroy() is best-effort cleanup; a failure here must never
      // block adopting the new document (or nulling it out on close).
    }
  }
  tab.pdfDoc = doc;
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
export function createTab(input: NewTabInput = {}): TabState {
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
  state.activeTabId = tab.tabId;
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

    const label = document.createElement('span');
    label.className = 'tabLabel';
    label.textContent = middleEllipsize(displayName);
    label.title = displayName;
    el.append(label);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'iconBtn tabClose';
    close.setAttribute('aria-label', `Close ${displayName}`);
    close.dataset['tabClose'] = tab.tabId;
    close.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    el.append(close);

    tabStripEl.append(el);
  }

  const activeEl = tabStripEl.querySelector<HTMLElement>('.tab.isActive');
  activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
}
