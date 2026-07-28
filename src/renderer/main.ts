import type { OpenClaimResultDto, ClaimSummaryDto, ClaimDetailDto } from '../../electron/preload.js';
import {
  titlebarFileNameEl,
  openBtn,
  exportBtn,
  zoomSepEl,
  zoomGroupEl,
  zoomOutBtn,
  zoomInBtn,
  fitPageBtn,
  fitWidthBtn,
  pageGroupEl,
  prevPageBtn,
  nextPageBtn,
  claimGroupEl,
  prevClaimBtn,
  claimStepLabelEl,
  nextClaimBtn,
  inspectorToggleBtn,
  themeToggleBtn,
  themeToggleLabelEl,
  warnBannerEl,
  warnCountEl,
  warnMessagesEl,
  welcomeScreenEl,
  welcomeOpenBtn,
  loadingScreenEl,
  loadingLabelEl,
  errorScreenEl,
  errorDetailEl,
  errorOpenBtn,
  errorCopyBtn,
  previewPaneEl,
  workspaceScreenEl,
  provenanceChipTextEl,
  sampleChipEl,
  unsupportedNoteEl,
  pdfScrollEl,
  inspectorEl,
  statusFileGroupEl,
  statusFileNameEl,
  statusFormTypeEl,
  statusWarnBtnEl,
  statusTotalsEl,
  copySummaryBtn,
  statusNoFileEl,
  exportConfirmBtn,
  warnCopyBtn,
} from './dom.js';
import {
  state,
  currentScreen,
  activeTab,
  findTabById,
  findTabBySessionId,
  createTab,
  closeTab,
  setActiveTab,
  setActivePdfDoc,
  loadPdfDocument,
  renderTabStrip,
  initTabStrip,
  type TabState,
  type NewTabInput,
} from './tabs.js';
import { renderPdfPage, fitPage, fitWidth, zoomBy, zoomToActualSize, stepPage, cancelInFlightRender } from './preview.js';
import { renderInspector, updateInspectorVisibility, toggleInspector, formatMoney, formTypeText } from './inspector.js';
import { errorMessage, showToast, anyOverlayOpen, focusableEls, openExportDialog, confirmExport, exportCurrentClaimSkipDialog } from './overlays.js';
import { renderShortcuts, openShortcuts, initShortcuts } from './shortcuts.js';
import { copyToClipboard } from './clipboard.js';
import { formatServiceLinesTsv, formatClaimSummary, formatWarningsAndReconciliation } from './clipboardFormat.js';
import { severityWord } from './format.js';
import { ICON_SEVERITY_WARNING, ICON_SEVERITY_NOTE } from './icons.js';

/**
 * Claim Viewer renderer chrome: title bar, tab strip, menu bar, toolbar
 * (open/export, zoom, page + claim steppers, inspector toggle), the
 * data-warnings banner, the pdf.js form preview, the inspector drawer, and
 * the export/shortcuts dialogs — matching docs/design/ClaimViewer_v2.dc.html
 * plus the tabs strip (docs/TABS_BUILD_PLAN.md §2/§2b).
 *
 * Sandbox-safe by construction: this file never touches Node or Electron
 * APIs directly — the only bridge to the main process is the frozen
 * `window.claimApi` (see electron/preload.ts). Every DOM event listener is
 * attached here in script, never via an inline `on*=` HTML attribute, so
 * the page's `script-src 'self'` CSP (see index.html / electron/main.ts's
 * installOfflineKillSwitch) is never at odds with the UI.
 *
 * This file is init + wiring: the DOM handles live in dom.ts, per-tab state
 * + the tab strip + the pdf.js lifecycle helper live in tabs.ts, pdf.js
 * load/render/zoom/paging in preview.ts, the inspector drawer in
 * inspector.ts, the export dialog/shortcuts sheet overlay mechanics/toast in
 * overlays.ts, and the keyboard shortcuts sheet content + global keydown
 * dispatcher in shortcuts.ts. What's left here is theme, the loading-floor
 * timing, screen/toolbar visibility (all DERIVED from tab state — see
 * tabs.ts's currentScreen()), the two claim-loading lifecycle primitives
 * every tab-content path shares (loadClaimDetail / ensureClaimRendered),
 * tab open/close/activate/cycle orchestration, the menu bar, and wiring
 * everything together.
 */

// ---------------------------------------------------------------------------
// Small formatting helpers (kept local to the renderer — see task notes:
// this file owns src/renderer/** and stays self-contained rather than
// reaching into src/render/text.ts, which belongs to the PDF-rendering
// surface this task doesn't touch).
// ---------------------------------------------------------------------------

function provenanceText(tab: TabState, summary: ClaimSummaryDto, index: number): string {
  if (tab.source === 'json') return `Rendered from JSON claim ${summary.claimId || index + 1}`;
  const kind =
    summary.formType === 'ub04' ? 'institutional' : summary.formType === 'dental' ? 'dental' : summary.formType === 'unsupported' ? 'unsupported' : 'professional';
  return `837 claim ${index + 1} of ${tab.summaries.length} — ${kind}`;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const THEME_STORAGE_KEY = 'claimViewer.theme';

function applyTheme(theme: 'light' | 'dark'): void {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleLabelEl.textContent = theme === 'dark' ? 'Dark' : 'Light';
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (e.g. a restrictive file:// partition) —
    // the theme just won't persist across launches; not fatal.
  }
}

function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // ignore
  }
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}

function toggleTheme(): void {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

// ---------------------------------------------------------------------------
// Motion: the loading screen's minimum-visible floor (see overlays.ts for
// the prefers-reduced-motion read that the overlay/toast close delays use —
// that one moved there since it isn't used anywhere else).
// ---------------------------------------------------------------------------

/**
 * Claim files parse in milliseconds — fast enough that #loadingScreen would
 * otherwise flash on and off inside a single frame, which reads as a
 * stutter rather than "it's working" (spec requirement 1). Applies to a
 * user-initiated FILE OPEN only (docs/TABS_BUILD_PLAN.md §2's amendment to
 * the original loading-floor note) — never to tab activation, claim
 * stepping, or background-tab reload, all of which route through
 * ensureClaimRendered() below without this delay. In practice that also
 * means it only ever fires for the very first tab: opening an ADDITIONAL
 * file while another tab is already showing doesn't touch the visible
 * screen at all (the existing tab just keeps rendering while the new one
 * loads in the background, like a browser opening a new tab), so there is
 * no loading screen for that case to flash in the first place — see
 * performOpen() below.
 */
const LOADING_MIN_VISIBLE_MS = 1000;

// ---------------------------------------------------------------------------
// Screen / visibility management — DERIVED from tab state (tabs.ts's
// currentScreen()), never an independent flag. syncScreenUI() just paints
// the DOM to match whatever that currently says.
// ---------------------------------------------------------------------------

function syncScreenUI(): void {
  const screen = currentScreen();
  welcomeScreenEl.hidden = screen !== 'welcome';
  loadingScreenEl.hidden = screen !== 'loading';
  errorScreenEl.hidden = screen !== 'error';
  workspaceScreenEl.hidden = screen !== 'workspace';

  statusFileGroupEl.hidden = screen !== 'workspace';
  statusNoFileEl.hidden = screen === 'workspace';
  if (screen !== 'workspace') warnBannerEl.hidden = true;

  const tab = activeTab();
  titlebarFileNameEl.textContent = tab && tab.fileName ? tab.fileName : 'no file open';
  if (screen === 'error') {
    errorDetailEl.textContent = `Problem: ${tab?.errorMessage ?? ''}`;
  }
  if (screen === 'loading') {
    loadingLabelEl.textContent = 'Reading and parsing the claim file…';
  }

  updateToolbarVisibility();
  updateInspectorVisibility();
}

function updateToolbarVisibility(): void {
  const tab = activeTab();
  const hasFile = currentScreen() === 'workspace' && tab !== null;
  zoomSepEl.hidden = !hasFile;
  zoomGroupEl.hidden = !hasFile;
  pageGroupEl.hidden = !hasFile || !tab || tab.pageCount <= 1;
  claimGroupEl.hidden = !hasFile || !tab || tab.summaries.length <= 1;
  inspectorToggleBtn.hidden = !hasFile;
  exportBtn.disabled = !hasFile;
  document.querySelectorAll<HTMLButtonElement>('[data-menu-disable="export"]').forEach((btn) => {
    btn.disabled = !hasFile;
  });
}

// ---------------------------------------------------------------------------
// Warnings banner / status bar / claim-detail-driven chrome
// ---------------------------------------------------------------------------

/**
 * §2f item 4: each shown warning gets its own severity glyph + explicit
 * word (never colour alone — filed as *critical* by the colour-blind
 * reviewer), built as real DOM nodes (not one joined textContent string,
 * the pre-tabs-build-item-4 approach) so a mixed warning+info banner can
 * show the right shape per entry. Same "first 2, then +N more" truncation
 * as before.
 */
function renderWarnBanner(detail: ClaimDetailDto): void {
  if (detail.warnings.length === 0) {
    warnBannerEl.hidden = true;
    return;
  }
  warnBannerEl.hidden = false;
  warnCountEl.textContent = detail.warnings.length === 1 ? '1 data warning' : `${detail.warnings.length} data warnings`;

  warnMessagesEl.innerHTML = '';
  const shown = detail.warnings.slice(0, 2);
  for (const w of shown) {
    const item = document.createElement('span');
    item.className = 'warnItem';
    item.setAttribute('aria-label', `${severityWord(w.severity)}: ${w.message}`);

    const glyph = document.createElement('span');
    glyph.className = `sevGlyph sevGlyph${w.severity === 'warning' ? 'Warn' : 'Note'}`;
    glyph.innerHTML = w.severity === 'warning' ? ICON_SEVERITY_WARNING : ICON_SEVERITY_NOTE;

    const word = document.createElement('span');
    word.className = 'warnItemWord';
    word.textContent = severityWord(w.severity);

    const msg = document.createElement('span');
    msg.className = 'warnItemMsg';
    msg.textContent = w.message;

    item.append(glyph, word, document.createTextNode(' — '), msg);
    warnMessagesEl.append(item);
  }
  if (detail.warnings.length > 2) {
    const extra = document.createElement('span');
    extra.className = 'warnItemExtra';
    extra.textContent = `+${detail.warnings.length - 2} more`;
    warnMessagesEl.append(extra);
  }
}

function renderStatusBar(tab: TabState, summary: ClaimSummaryDto, detail: ClaimDetailDto): void {
  statusFileNameEl.textContent = tab.fileName;
  statusFormTypeEl.textContent = formTypeText(summary.formType);
  const warnCount = detail.warnings.length;
  statusWarnBtnEl.textContent = warnCount === 0 ? 'No warnings' : warnCount === 1 ? '1 data warning' : `${warnCount} data warnings`;
  statusWarnBtnEl.classList.toggle('hasWarnings', warnCount > 0);
  const lineCount = detail.serviceLines.length;
  statusTotalsEl.textContent = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${formatMoney(detail.totals.totalCharge)} billed`;
}

/** Paints every piece of shared chrome that's driven by the active tab's cached claim-detail data (provenance chip, warnings banner, status bar, inspector, claim stepper). Called both right after a fresh claimApi.getDetail() fetch (loadClaimDetail) and on plain tab activation, where the data is already cached on the tab and nothing needs re-fetching. */
function renderActiveTabChrome(tab: TabState): void {
  const summary = tab.summaries[tab.currentIndex];
  const detail = tab.detail;
  if (!summary || !detail) return;

  provenanceChipTextEl.textContent = provenanceText(tab, summary, tab.currentIndex);
  // No field anywhere in Claim/ClaimSummaryDto/ClaimDetailDto distinguishes
  // "sample data" from a real claim, so the chip the design shows for demo
  // data is never shown here — there is nothing to key it off honestly.
  sampleChipEl.hidden = true;
  unsupportedNoteEl.hidden = summary.formType !== 'unsupported';

  renderWarnBanner(detail);
  renderStatusBar(tab, summary, detail);
  renderInspector(tab, detail);

  claimStepLabelEl.textContent = `Claim ${tab.currentIndex + 1} of ${tab.summaries.length}`;
  prevClaimBtn.disabled = tab.currentIndex <= 0;
  nextClaimBtn.disabled = tab.currentIndex >= tab.summaries.length - 1;

  updateToolbarVisibility();
}

// ---------------------------------------------------------------------------
// Claim loading — the two lifecycle primitives every content path
// (activation, claim stepping, this build's fresh-open, and later builds'
// lazy restore / fast mode) routes through, per docs/TABS_BUILD_PLAN.md §2.
// ---------------------------------------------------------------------------

/** Fetches claim-detail data for `index` on `tab` and — only if `tab` is still the active tab once the fetch resolves — paints every piece of chrome that depends on it. Inspector-and-friends only; never touches pdf.js/the canvas (see ensureClaimRendered). */
async function loadClaimDetail(tab: TabState, index: number): Promise<void> {
  if (!tab.sessionId) return;
  const summary = tab.summaries[index];
  if (!summary) return;
  tab.currentIndex = index;
  const detail = await window.claimApi.getDetail(tab.sessionId, index);
  tab.detail = detail;
  if (tab.tabId === state.activeTabId) {
    renderActiveTabChrome(tab);
  }
}

/**
 * Ensures `tab.pdfDoc` reflects `tab.currentIndex` (rebuilding it via
 * claimApi.getPdf + loadPdfDocument, through the leak-safe setActivePdfDoc,
 * whenever it's missing or `forceReload` says the claim index just
 * changed), then — only if `tab` is the active tab — paints it onto the
 * shared canvas. Safe to call for a background tab: the pdf.js document
 * still gets rebuilt (or left alone) as needed, but the shared canvas is
 * never touched for a tab that isn't currently showing.
 */
async function ensureClaimRendered(tab: TabState, opts: { forceReload?: boolean } = {}): Promise<void> {
  if (!tab.sessionId) return;
  const needsReload = opts.forceReload === true || !tab.pdfDoc;
  if (needsReload) {
    const bytes = await window.claimApi.getPdf(tab.sessionId, tab.currentIndex);
    const doc = await loadPdfDocument(bytes);
    await setActivePdfDoc(tab, doc);
    tab.pageCount = doc.numPages;
    tab.pageNum = 1;
  }
  tab.status = 'ready';
  if (tab.tabId !== state.activeTabId) return;
  syncScreenUI();
  if (needsReload) {
    await fitPage(tab, true);
  } else {
    await renderPdfPage(tab, true);
  }
}

/** First-ever content load for a brand-new (or freshly-filled-placeholder) tab: claim 0's detail, then a fresh pdf.js document fit to the page. */
async function loadTabContent(tab: TabState): Promise<void> {
  await loadClaimDetail(tab, 0);
  await ensureClaimRendered(tab, { forceReload: true });
}

async function stepClaim(delta: number): Promise<void> {
  if (currentScreen() !== 'workspace') return;
  // No claim navigation while any overlay is open — mirrors the Escape
  // special-casing elsewhere (the export dialog's manifest is rendered once
  // from the claim at the moment it opened, and never re-rendered).
  if (anyOverlayOpen()) return;
  const tab = activeTab();
  if (!tab) return;
  const next = tab.currentIndex + delta;
  if (next < 0 || next >= tab.summaries.length) return;
  try {
    await loadClaimDetail(tab, next);
    // A different claim index means a genuinely different PDF — this is
    // the "claim step" leak-fix site: forceReload always destroys the old
    // pdfDoc via setActivePdfDoc before the new one is built.
    await ensureClaimRendered(tab, { forceReload: true });
  } catch (err) {
    showToast(errorMessage(err), true);
  }
}

// ---------------------------------------------------------------------------
// Tab activation / close / cycling
// ---------------------------------------------------------------------------

/**
 * The one place a tab becomes the active tab and its content gets ensured
 * on screen — used by tab-strip clicks, the open flow's dedupe-focus path,
 * closing the active tab (picks a new one), and Ctrl+Tab / Ctrl+1-7.
 *
 * Background-tab memory release (§2b) lives here: switching AWAY from a
 * tab releases its pdf.js document (through setActivePdfDoc — the same
 * leak-safe helper every other pdfDoc reassignment uses), rebuilt lazily on
 * next activation by ensureClaimRendered's `!tab.pdfDoc` check. Any
 * in-flight render for the outgoing tab is cancelled first
 * (cancelInFlightRender) so its paint can never land on the canvas after
 * the newly active tab starts its own render (docs/TABS_BUILD_PLAN.md §2
 * watch-out (b)).
 */
async function activateTabById(tabId: string): Promise<void> {
  const previousTab = activeTab();
  const switchingAway = previousTab !== null && previousTab.tabId !== tabId;
  if (switchingAway) cancelInFlightRender();

  setActiveTab(tabId);
  const tab = activeTab();
  syncScreenUI();

  if (switchingAway && previousTab) {
    await setActivePdfDoc(previousTab, null);
  }
  if (!tab) return;

  if (tab.detail) renderActiveTabChrome(tab);
  try {
    if (tab.status !== 'ready') {
      await loadTabContent(tab);
    } else {
      await ensureClaimRendered(tab);
    }
  } catch (err) {
    tab.status = 'error';
    tab.errorMessage = errorMessage(err);
  }
  syncScreenUI();
}

let lastClosedTabPath: string | null = null;

async function closeTabById(tabId: string): Promise<void> {
  const tab = findTabById(tabId);
  if (tab && tab.filePath) {
    lastClosedTabPath = tab.filePath; // Ctrl+Shift+T target (§2b)
  }
  const wasActive = state.activeTabId === tabId;
  if (wasActive) cancelInFlightRender();

  const { nextActiveTabId } = await closeTab(tabId);
  syncScreenUI();

  if (wasActive && nextActiveTabId) {
    await activateTabById(nextActiveTabId);
  }
}

async function closeActiveTab(): Promise<void> {
  if (anyOverlayOpen()) return;
  const tab = activeTab();
  if (!tab) return;
  await closeTabById(tab.tabId);
}

function cycleTab(delta: number): void {
  if (anyOverlayOpen()) return;
  if (state.tabs.length === 0) return;
  const idx = state.tabs.findIndex((t) => t.tabId === state.activeTabId);
  const from = idx === -1 ? 0 : idx;
  const next = (((from + delta) % state.tabs.length) + state.tabs.length) % state.tabs.length;
  const target = state.tabs[next];
  if (target) void activateTabById(target.tabId);
}

function jumpToTab(oneBasedIndex: number): void {
  if (anyOverlayOpen()) return;
  const target = state.tabs[oneBasedIndex - 1];
  if (target) void activateTabById(target.tabId);
}

// ---------------------------------------------------------------------------
// Open file (native dialog / drag-drop / reopen-last-closed all share one
// path)
// ---------------------------------------------------------------------------

function tabInputFromResult(result: OpenClaimResultDto): NewTabInput {
  return { sessionId: result.sessionId, fileName: result.fileName, filePath: result.filePath, source: result.source, summaries: result.summaries };
}

function fillPlaceholder(tab: TabState, result: OpenClaimResultDto): TabState {
  tab.sessionId = result.sessionId;
  tab.fileName = result.fileName;
  tab.filePath = result.filePath;
  tab.source = result.source;
  tab.summaries = result.summaries;
  tab.currentIndex = 0;
  renderTabStrip();
  return tab;
}

type OpenSource = { kind: 'dialog' } | { kind: 'path'; path: string };

/**
 * The single implementation behind openClaimFlow (Ctrl+O / the Open
 * buttons), openDroppedClaimFile (drag-and-drop), and reopenLastClosedTab
 * (Ctrl+Shift+T) — all three just differ in how claimApi.openClaim() is
 * invoked (no argument opens the native dialog; a path skips straight to
 * reading that file, same as a drop).
 *
 * If there are no tabs open yet, a bare placeholder tab (status 'loading')
 * is created first so currentScreen() has something to derive 'loading'
 * from during the IPC round-trip — still fully tab-state-driven, never an
 * independent screen flag. If a tab is ALREADY open, the existing tab stays
 * visible/interactive throughout (no placeholder, no loading screen) while
 * the new file loads in the background, like a browser opening a new tab —
 * see LOADING_MIN_VISIBLE_MS's doc comment for why the loading floor only
 * ever applies to the placeholder case in practice.
 *
 * Same-file-twice dedupe (§2b): if the resolved session already belongs to
 * one of this renderer's tabs (main's openClaimAtPath returns the SAME
 * sessionId for a path that's already open), that tab is focused instead of
 * a duplicate being created. The tab that ends up owning a sessionId is
 * decided IMMEDIATELY once the IPC result arrives — before the loading
 * floor's artificial delay below — specifically so a second, concurrent
 * open of the same brand-new file (racing in while the first one's
 * placeholder is still mid-floor) reliably finds it via
 * findTabBySessionId() instead of both independently deciding "not a
 * duplicate yet" and creating two tabs for one session.
 */
async function performOpen(source: OpenSource): Promise<void> {
  const isFirstTab = state.tabs.length === 0;
  const placeholder = isFirstTab ? createTab() : null;
  if (placeholder) syncScreenUI();

  try {
    const result = source.kind === 'dialog' ? await window.claimApi.openClaim() : await window.claimApi.openClaim(source.path);

    if (!result) {
      if (placeholder) {
        await closeTab(placeholder.tabId);
        syncScreenUI();
      }
      return;
    }

    const existing = findTabBySessionId(result.sessionId);
    let tab: TabState;
    if (existing && existing !== placeholder) {
      if (placeholder) await closeTab(placeholder.tabId);
      tab = existing;
    } else if (placeholder) {
      tab = fillPlaceholder(placeholder, result);
    } else {
      tab = createTab(tabInputFromResult(result));
    }

    // The loading floor only ever applies to a genuinely new placeholder
    // tab that's about to show its very first content (see
    // LOADING_MIN_VISIBLE_MS's doc comment) — not to the dedupe-focus path
    // above, which just activates an already-live tab.
    if (placeholder && tab === placeholder) {
      await new Promise((resolve) => window.setTimeout(resolve, LOADING_MIN_VISIBLE_MS));
    }

    await activateTabById(tab.tabId);
  } catch (err) {
    if (placeholder) {
      placeholder.status = 'error';
      placeholder.errorMessage = errorMessage(err);
      syncScreenUI();
    } else {
      // A background open failing must never disturb whatever's already on
      // screen — just surface it as a toast.
      showToast(errorMessage(err), true);
    }
  }
}

async function openClaimFlow(): Promise<void> {
  await performOpen({ kind: 'dialog' });
}

/** Drag-and-drop open (welcome screen + workspace preview pane, spec §4) — see setupDragAndDrop() below. */
async function openDroppedClaimFile(filePath: string): Promise<void> {
  await performOpen({ kind: 'path', path: filePath });
}

/** Ctrl+Shift+T (§2b): reopens the most recently closed tab's file path, kept in renderer memory only (no persistent store yet — that's a later build, §2e). No-op if nothing has been closed yet this session. */
async function reopenLastClosedTab(): Promise<void> {
  if (anyOverlayOpen()) return;
  const path = lastClosedTabPath;
  if (!path) return;
  lastClosedTabPath = null;
  await performOpen({ kind: 'path', path });
}

const DROPPABLE_NAME_PATTERN = /\.(json|dat|edi|txt|837)$/i;

function firstDroppableFile(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) return null;
  for (const file of Array.from(dataTransfer.files)) {
    if (DROPPABLE_NAME_PATTERN.test(file.name)) return file;
  }
  return null;
}

/** Wires the welcome screen + workspace preview pane (both live inside #previewPane) as a single drop target for .json/.dat/.edi/.txt/.837 claim files (spec §4 / design ClaimViewer_v2.dc.html:562). Dropping while the (sole, first-tab) loading screen is up is ignored rather than racing two loads; dropping onto an existing workspace opens the file into a new tab in the background, same as Ctrl+O. */
function setupDragAndDrop(): void {
  previewPaneEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (currentScreen() === 'loading') return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    previewPaneEl.classList.add('isDragOver');
  });
  previewPaneEl.addEventListener('dragleave', (event) => {
    // Only clear the highlight once the pointer has actually left
    // #previewPane, not just moved between its children (which also fire
    // dragleave on the parent).
    if (event.relatedTarget instanceof Node && previewPaneEl.contains(event.relatedTarget)) return;
    previewPaneEl.classList.remove('isDragOver');
  });
  previewPaneEl.addEventListener('drop', (event) => {
    event.preventDefault();
    previewPaneEl.classList.remove('isDragOver');
    if (currentScreen() === 'loading') return;
    const dropped = firstDroppableFile(event.dataTransfer);
    if (!dropped) return;
    // `File.prototype.path` was removed; claimApi.getPathForFile is the
    // supported replacement (electron's webUtils.getPathForFile) — see
    // electron/preload.ts.
    const filePath = window.claimApi.getPathForFile(dropped);
    if (filePath) void openDroppedClaimFile(filePath);
  });
}

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------

/** Set by setupMenus() once the menu DOM exists; the keydown handler (shortcuts.ts, via initShortcuts's deps) also calls this (Escape collapses open menus). No-op before setupMenus() runs. */
let closeAllMenus: () => void = () => {};

function setupMenus(): void {
  const menus = Array.from(document.querySelectorAll<HTMLElement>('.menu'));

  closeAllMenus = () => {
    for (const m of menus) {
      const trigger = m.querySelector<HTMLButtonElement>('.menuTrigger');
      const panel = m.querySelector<HTMLElement>('.menuPanel');
      trigger?.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    }
  };

  for (const m of menus) {
    const trigger = m.querySelector<HTMLButtonElement>('.menuTrigger');
    const panel = m.querySelector<HTMLElement>('.menuPanel');
    if (!trigger || !panel) continue;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = !panel.hidden;
      closeAllMenus();
      if (!wasOpen) {
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  }

  document.addEventListener('click', () => closeAllMenus());

  document.querySelectorAll<HTMLButtonElement>('.menuPanel [data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeAllMenus();
      runAction(btn.dataset['action'] ?? '');
    });
  });
}

function runAction(action: string): void {
  switch (action) {
    case 'open':
      void openClaimFlow();
      break;
    case 'export':
      openExportDialog();
      break;
    case 'exportSkipDialog':
      void exportCurrentClaimSkipDialog();
      break;
    case 'close':
      void closeActiveTab();
      break;
    case 'reopenClosedTab':
      void reopenLastClosedTab();
      break;
    case 'zoomIn': {
      const tab = activeTab();
      if (tab) void zoomBy(tab, 0.1);
      break;
    }
    case 'zoomOut': {
      const tab = activeTab();
      if (tab) void zoomBy(tab, -0.1);
      break;
    }
    case 'zoomReset': {
      const tab = activeTab();
      if (tab) void zoomToActualSize(tab);
      break;
    }
    case 'fitPage': {
      const tab = activeTab();
      if (tab) void fitPage(tab);
      break;
    }
    case 'fitWidth': {
      const tab = activeTab();
      if (tab) void fitWidth(tab);
      break;
    }
    case 'toggleInspector':
      toggleInspector();
      break;
    case 'toggleTheme':
      toggleTheme();
      break;
    case 'shortcuts':
      openShortcuts();
      break;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

openBtn.addEventListener('click', () => void openClaimFlow());
welcomeOpenBtn.addEventListener('click', () => void openClaimFlow());
errorOpenBtn.addEventListener('click', () => void openClaimFlow());
exportBtn.addEventListener('click', openExportDialog);
exportConfirmBtn.addEventListener('click', () => void confirmExport());

errorCopyBtn.addEventListener('click', () => {
  copyToClipboard(errorDetailEl.textContent ?? '', 'Error details copied to the clipboard.');
});

// ---------------------------------------------------------------------------
// Clipboard/copy suite (docs/TABS_BUILD_PLAN.md §2f items 1 and 3) — the
// service-lines-TSV button lives in inspector.ts (next to the group it
// copies from) and Ctrl+Shift+C below calls the same formatter; these two
// live here because copySummaryBtn/warnCopyBtn sit in chrome main.ts
// already owns (status bar / warnings banner).
// ---------------------------------------------------------------------------

function copyServiceLinesTsv(): void {
  const tab = activeTab();
  if (!tab?.detail) return;
  copyToClipboard(formatServiceLinesTsv(tab.detail), 'Service lines copied to the clipboard.');
}

copySummaryBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (!tab?.detail) return;
  copyToClipboard(formatClaimSummary(tab.detail), 'Claim summary copied to the clipboard.');
});

warnCopyBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (!tab?.detail) return;
  copyToClipboard(formatWarningsAndReconciliation(tab.detail), 'Warnings and reconciliation copied to the clipboard.');
});

zoomInBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) void zoomBy(tab, 0.1);
});
zoomOutBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) void zoomBy(tab, -0.1);
});
fitPageBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) void fitPage(tab);
});
fitWidthBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) void fitWidth(tab);
});

prevPageBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) void stepPage(tab, -1);
});
nextPageBtn.addEventListener('click', () => {
  const tab = activeTab();
  if (tab) void stepPage(tab, 1);
});
prevClaimBtn.addEventListener('click', () => void stepClaim(-1));
nextClaimBtn.addEventListener('click', () => void stepClaim(1));

inspectorToggleBtn.addEventListener('click', toggleInspector);
themeToggleBtn.addEventListener('click', toggleTheme);

initTabStrip({
  onActivate: (tabId) => void activateTabById(tabId),
  onClose: (tabId) => void closeTabById(tabId),
});

/**
 * Toolbar -> form preview -> inspector, in that order (spec §8 / index.html's
 * shortcuts-sheet footnote) — the regions F6 cycles focus through below.
 * #pdfScroll and #inspector only count while the workspace screen is
 * actually showing: both live inside #workspaceScreen, and `hidden` is only
 * ever set on that ancestor (not on them directly), so checking
 * `currentScreen()` here — rather than each element's own `.hidden` — is
 * what keeps F6 from trying to focus a preview/inspector that isn't
 * rendered. The inspector is additionally skipped while visually collapsed,
 * so F6 never parks focus in a `.collapsed` (width:0) drawer.
 */
function f6Regions(): HTMLElement[] {
  const inWorkspace = currentScreen() === 'workspace';
  const regions: Array<HTMLElement | null> = [
    document.getElementById('toolbar'),
    inWorkspace ? pdfScrollEl : null,
    inWorkspace && state.inspectorOpen ? inspectorEl : null,
  ];
  return regions.filter((el): el is HTMLElement => el !== null);
}

/** F6 / Shift+F6: moves focus to the first focusable element of the next/previous region in f6Regions(), wrapping around. #pdfScroll has no focusable children (the form preview is a bare canvas), so it's focused directly via its tabindex="-1" (index.html). */
function cycleRegionFocus(delta: number): void {
  const regions = f6Regions();
  if (regions.length === 0) return;
  const current = document.activeElement;
  const currentIdx = regions.findIndex((r) => current instanceof Node && r.contains(current));
  const fromIdx = currentIdx === -1 ? (delta > 0 ? -1 : 0) : currentIdx;
  const nextIdx = (((fromIdx + delta) % regions.length) + regions.length) % regions.length;
  const target = regions[nextIdx]!;
  const target0 = focusableEls(target)[0];
  (target0 ?? target).focus();
}

initShortcuts({
  closeAllMenus: () => closeAllMenus(),
  cycleRegionFocus,
  openClaimFlow,
  closeActiveTab,
  toggleTheme,
  stepClaim,
  cycleTab,
  jumpToTab,
  reopenLastClosedTab,
  copyServiceLinesTsv,
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initTheme();
setupMenus();
renderShortcuts();
setupDragAndDrop();
renderTabStrip();
syncScreenUI();
