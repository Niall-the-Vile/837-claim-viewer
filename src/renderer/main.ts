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
  statusNoFileEl,
  exportConfirmBtn,
} from './dom.js';
import { state, type Screen } from './tabs.js';
import { loadPdfDocument, renderPdfPage, fitPage, fitWidth, zoomBy, zoomToActualSize, stepPage } from './preview.js';
import { renderInspector, updateInspectorVisibility, toggleInspector, formatMoney, formTypeText } from './inspector.js';
import { errorMessage, showToast, anyOverlayOpen, focusableEls, openExportDialog, confirmExport, exportCurrentClaimSkipDialog } from './overlays.js';
import { renderShortcuts, openShortcuts, initShortcuts } from './shortcuts.js';

/**
 * Claim Viewer renderer chrome: title bar, menu bar, toolbar (open/export,
 * zoom, page + claim steppers, inspector toggle), the data-warnings banner,
 * the pdf.js form preview, the inspector drawer, and the export/shortcuts
 * dialogs — matching docs/design/ClaimViewer_v2.dc.html.
 *
 * Sandbox-safe by construction: this file never touches Node or Electron
 * APIs directly — the only bridge to the main process is the frozen
 * `window.claimApi` (see electron/preload.ts). Every DOM event listener is
 * attached here in script, never via an inline `on*=` HTML attribute, so
 * the page's `script-src 'self'` CSP (see index.html / electron/main.ts's
 * installOfflineKillSwitch) is never at odds with the UI.
 *
 * This file is init + wiring: the DOM handles live in dom.ts, the state
 * singleton in tabs.ts, pdf.js load/render/zoom/paging in preview.ts, the
 * inspector drawer in inspector.ts, the export dialog/shortcuts sheet
 * overlay mechanics/toast in overlays.ts, and the keyboard shortcuts sheet
 * content + global keydown dispatcher in shortcuts.ts (pure-moved out of
 * this file — see docs/TABS_BUILD_PLAN.md §2 Item 0). What's left here is
 * theme, the loading-floor timing, screen/toolbar visibility, claim
 * loading/stepping, open/close-file, the menu bar, and wiring everything
 * together.
 */

// ---------------------------------------------------------------------------
// Small formatting helpers (kept local to the renderer — see task notes:
// this file owns src/renderer/** and stays self-contained rather than
// reaching into src/render/text.ts, which belongs to the PDF-rendering
// surface this task doesn't touch).
// ---------------------------------------------------------------------------

function provenanceText(summary: ClaimSummaryDto, index: number): string {
  if (state.source === 'json') return `Rendered from JSON claim ${summary.claimId || index + 1}`;
  const kind =
    summary.formType === 'ub04' ? 'institutional' : summary.formType === 'dental' ? 'dental' : summary.formType === 'unsupported' ? 'unsupported' : 'professional';
  return `837 claim ${index + 1} of ${state.summaries.length} — ${kind}`;
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
 * otherwise flash on and off inside a single frame (or not render at all
 * before the next paint), which reads as a stutter rather than "it's
 * working" (spec requirement 1). openClaimFlow() / openDroppedClaimFile()
 * wrap the read/parse call in this so whatever happens next — success,
 * parse failure, or the user cancelling the native picker — never leaves
 * the loading screen up for less than LOADING_MIN_VISIBLE_MS. Intentionally
 * NOT covered by prefers-reduced-motion (see style.css's reduced-motion
 * block): this is a perceived-performance guarantee, not decorative motion.
 */
const LOADING_MIN_VISIBLE_MS = 1000;

async function withLoadingFloor<T>(work: Promise<T>): Promise<T> {
  const shownAt = performance.now();
  try {
    return await work;
  } finally {
    const remaining = LOADING_MIN_VISIBLE_MS - (performance.now() - shownAt);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
}

/**
 * Holds the loading screen for the floor duration counted from NOW.
 *
 * openClaimFlow can't wrap claimApi.openClaim() in withLoadingFloor, because
 * that one call BOTH opens the native file picker and reads/parses the chosen
 * file — so the floor would start ticking while the picker was still open. By
 * the time a file was actually chosen the floor had long since elapsed, and
 * the loading state flicked past before it could paint. That was invisible on
 * the welcome screen (the loading panel simply sat there while you browsed)
 * but obvious when a document was already open: the workspace appeared to
 * jump straight to the new claim with no loading state at all.
 *
 * Counting from after the picker closes is what makes it genuinely visible.
 */
async function holdLoadingScreen(): Promise<void> {
  if (state.screen !== 'loading') showScreen('loading');
  await new Promise((resolve) => window.setTimeout(resolve, LOADING_MIN_VISIBLE_MS));
}

// ---------------------------------------------------------------------------
// Screen / visibility management
// ---------------------------------------------------------------------------

function showScreen(screen: Screen): void {
  state.screen = screen;
  welcomeScreenEl.hidden = screen !== 'welcome';
  loadingScreenEl.hidden = screen !== 'loading';
  errorScreenEl.hidden = screen !== 'error';
  workspaceScreenEl.hidden = screen !== 'workspace';

  statusFileGroupEl.hidden = screen !== 'workspace';
  statusNoFileEl.hidden = screen === 'workspace';
  if (screen !== 'workspace') warnBannerEl.hidden = true;

  updateToolbarVisibility();
  updateInspectorVisibility();
}

function updateToolbarVisibility(): void {
  const hasFile = state.screen === 'workspace';
  zoomSepEl.hidden = !hasFile;
  zoomGroupEl.hidden = !hasFile;
  pageGroupEl.hidden = !hasFile || state.pageCount <= 1;
  claimGroupEl.hidden = !hasFile || state.summaries.length <= 1;
  inspectorToggleBtn.hidden = !hasFile;
  exportBtn.disabled = !hasFile;
  document.querySelectorAll<HTMLButtonElement>('[data-menu-disable="export"]').forEach((btn) => {
    btn.disabled = !hasFile;
  });
}

// ---------------------------------------------------------------------------
// Warnings banner / status bar
// ---------------------------------------------------------------------------

function renderWarnBanner(detail: ClaimDetailDto): void {
  if (detail.warnings.length === 0) {
    warnBannerEl.hidden = true;
    return;
  }
  warnBannerEl.hidden = false;
  warnCountEl.textContent = detail.warnings.length === 1 ? '1 data warning' : `${detail.warnings.length} data warnings`;
  const shown = detail.warnings.slice(0, 2).map((w) => w.message);
  const extra = detail.warnings.length > 2 ? ` (+${detail.warnings.length - 2} more)` : '';
  warnMessagesEl.textContent = shown.join('  ·  ') + extra;
}

function renderStatusBar(summary: ClaimSummaryDto, detail: ClaimDetailDto): void {
  statusFileNameEl.textContent = state.fileName;
  statusFormTypeEl.textContent = formTypeText(summary.formType);
  const warnCount = detail.warnings.length;
  statusWarnBtnEl.textContent = warnCount === 0 ? 'No warnings' : warnCount === 1 ? '1 data warning' : `${warnCount} data warnings`;
  statusWarnBtnEl.classList.toggle('hasWarnings', warnCount > 0);
  const lineCount = detail.serviceLines.length;
  statusTotalsEl.textContent = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${formatMoney(detail.totals.totalCharge)} billed`;
}

// ---------------------------------------------------------------------------
// Claim loading / stepping
// ---------------------------------------------------------------------------

async function loadCurrentClaim(isNewFile: boolean): Promise<void> {
  const index = state.currentIndex;
  const summary = state.summaries[index];
  if (!summary) return;

  const [detail, bytes] = await Promise.all([window.claimApi.getDetail(index), window.claimApi.getPdf(index)]);
  state.detail = detail;

  state.pdfDoc = await loadPdfDocument(bytes);
  state.pageCount = state.pdfDoc.numPages;
  state.pageNum = 1;

  provenanceChipTextEl.textContent = provenanceText(summary, index);
  // No field anywhere in Claim/ClaimSummaryDto/ClaimDetailDto distinguishes
  // "sample data" from a real claim, so the chip the design shows for demo
  // data is never shown here — there is nothing to key it off honestly.
  sampleChipEl.hidden = true;
  unsupportedNoteEl.hidden = summary.formType !== 'unsupported';

  renderWarnBanner(detail);
  renderStatusBar(summary, detail);
  renderInspector(detail);

  claimStepLabelEl.textContent = `Claim ${index + 1} of ${state.summaries.length}`;
  prevClaimBtn.disabled = index <= 0;
  nextClaimBtn.disabled = index >= state.summaries.length - 1;

  updateToolbarVisibility();

  if (isNewFile) {
    await fitPage(true);
  } else {
    await renderPdfPage(true);
  }
}

async function stepClaim(delta: number): Promise<void> {
  if (state.screen !== 'workspace') return;
  // The export dialog's manifest (form/lines/total/warnings) is rendered
  // once, from the claim at the moment it opened, and never re-rendered —
  // stepping to a different claim while it's open would silently export a
  // claim other than the one the manifest still shows (the MAJOR finding
  // this guards). Simplest correct fix: no claim navigation while ANY
  // overlay is open, mirroring the Escape special-casing below.
  if (anyOverlayOpen()) return;
  const next = state.currentIndex + delta;
  if (next < 0 || next >= state.summaries.length) return;
  state.currentIndex = next;
  try {
    await loadCurrentClaim(false);
  } catch (err) {
    showToast(errorMessage(err), true);
  }
}

// ---------------------------------------------------------------------------
// Open / close file
// ---------------------------------------------------------------------------

function renderErrorScreen(): void {
  errorDetailEl.textContent = `Problem: ${state.errorMessage}`;
}

/** Adopts an already-fetched open result into state — shared by the native-dialog open flow and the drag-and-drop open flow below. */
function applyOpenedClaimFile(result: OpenClaimResultDto): void {
  if (result.summaries.length === 0) {
    throw new Error('This file contains no claims.');
  }
  state.fileName = result.fileName;
  state.source = result.source;
  state.summaries = result.summaries;
  state.currentIndex = 0;
  titlebarFileNameEl.textContent = result.fileName;
}

async function openClaimFlow(): Promise<void> {
  const previousScreen = state.screen;
  loadingLabelEl.textContent = 'Reading and parsing the claim file…';
  showScreen('loading');

  try {
    const result: OpenClaimResultDto | null = await window.claimApi.openClaim();
    if (!result) {
      // User cancelled the native file picker — return to whatever was
      // showing before (or the welcome screen, if we were on it already).
      showScreen(previousScreen === 'loading' ? 'welcome' : previousScreen);
      return;
    }
    // Only now — with the picker closed and a real file chosen — is there
    // work worth showing a loading state for. See holdLoadingScreen().
    await holdLoadingScreen();
    applyOpenedClaimFile(result);
    showScreen('workspace');
    await loadCurrentClaim(true);
  } catch (err) {
    state.errorMessage = errorMessage(err);
    renderErrorScreen();
    showScreen('error');
  }
}

/** Drag-and-drop open (welcome screen + workspace preview pane, spec §4): same read/parse/adopt path as openClaimFlow, but claimApi.openClaim is given the dropped file's path so it skips the native dialog — see setupDragAndDrop() below. */
async function openDroppedClaimFile(filePath: string): Promise<void> {
  loadingLabelEl.textContent = 'Reading and parsing the claim file…';
  showScreen('loading');

  try {
    const result = await withLoadingFloor(window.claimApi.openClaim(filePath));
    if (!result) throw new Error('Could not open the dropped file.');
    applyOpenedClaimFile(result);
    showScreen('workspace');
    await loadCurrentClaim(true);
  } catch (err) {
    state.errorMessage = errorMessage(err);
    renderErrorScreen();
    showScreen('error');
  }
}

const DROPPABLE_NAME_PATTERN = /\.(json|dat|edi|txt|837)$/i;

function firstDroppableFile(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) return null;
  for (const file of Array.from(dataTransfer.files)) {
    if (DROPPABLE_NAME_PATTERN.test(file.name)) return file;
  }
  return null;
}

/** Wires the welcome screen + workspace preview pane (both live inside #previewPane) as a single drop target for .json/.dat/.edi/.txt/.837 claim files (spec §4 / design ClaimViewer_v2.dc.html:562). Dropping while a file is already loading is ignored rather than racing two loads. */
function setupDragAndDrop(): void {
  previewPaneEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (state.screen === 'loading') return;
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
    if (state.screen === 'loading') return;
    const dropped = firstDroppableFile(event.dataTransfer);
    if (!dropped) return;
    // `File.prototype.path` was removed; claimApi.getPathForFile is the
    // supported replacement (electron's webUtils.getPathForFile) — see
    // electron/preload.ts.
    const filePath = window.claimApi.getPathForFile(dropped);
    if (filePath) void openDroppedClaimFile(filePath);
  });
}

function closeFile(): void {
  state.fileName = '';
  state.source = null;
  state.summaries = [];
  state.currentIndex = 0;
  state.detail = null;
  state.pdfDoc = null;
  state.pageNum = 1;
  state.pageCount = 1;
  titlebarFileNameEl.textContent = 'no file open';
  showScreen('welcome');
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
      closeFile();
      break;
    case 'zoomIn':
      void zoomBy(0.1);
      break;
    case 'zoomOut':
      void zoomBy(-0.1);
      break;
    case 'zoomReset':
      void zoomToActualSize();
      break;
    case 'fitPage':
      void fitPage();
      break;
    case 'fitWidth':
      void fitWidth();
      break;
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
  const text = errorDetailEl.textContent ?? '';
  void navigator.clipboard.writeText(text).then(
    () => showToast('Error details copied to the clipboard.', false),
    () => showToast('Could not copy to the clipboard.', true),
  );
});

zoomInBtn.addEventListener('click', () => void zoomBy(0.1));
zoomOutBtn.addEventListener('click', () => void zoomBy(-0.1));
fitPageBtn.addEventListener('click', () => void fitPage());
fitWidthBtn.addEventListener('click', () => void fitWidth());

prevPageBtn.addEventListener('click', () => void stepPage(-1));
nextPageBtn.addEventListener('click', () => void stepPage(1));
prevClaimBtn.addEventListener('click', () => void stepClaim(-1));
nextClaimBtn.addEventListener('click', () => void stepClaim(1));

inspectorToggleBtn.addEventListener('click', toggleInspector);
themeToggleBtn.addEventListener('click', toggleTheme);

/**
 * Toolbar -> form preview -> inspector, in that order (spec §8 / index.html's
 * shortcuts-sheet footnote) — the regions F6 cycles focus through below.
 * #pdfScroll and #inspector only count while the workspace screen is
 * actually showing: both live inside #workspaceScreen, and `hidden` is only
 * ever set on that ancestor (not on them directly), so checking
 * `state.screen` here — rather than each element's own `.hidden` — is what
 * keeps F6 from trying to focus a preview/inspector that isn't rendered.
 * The inspector is additionally skipped while visually collapsed, so F6
 * never parks focus in a `.collapsed` (width:0) drawer.
 */
function f6Regions(): HTMLElement[] {
  const inWorkspace = state.screen === 'workspace';
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
  const nextIdx = ((fromIdx + delta) % regions.length + regions.length) % regions.length;
  const target = regions[nextIdx]!;
  const target0 = focusableEls(target)[0];
  (target0 ?? target).focus();
}

initShortcuts({
  closeAllMenus: () => closeAllMenus(),
  cycleRegionFocus,
  openClaimFlow,
  closeFile,
  toggleTheme,
  stepClaim,
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initTheme();
setupMenus();
renderShortcuts();
setupDragAndDrop();
showScreen('welcome');
