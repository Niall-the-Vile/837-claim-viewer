import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// `?url` gives Vite's resolved asset URL for the worker file (bundled and
// copied into dist/renderer at build time) instead of trying to parse it as
// a JS module — this is what keeps the pdf.js worker fully local/offline;
// it is never fetched from a CDN.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OpenClaimResultDto, ClaimSummaryDto, ClaimDetailDto } from '../../electron/preload.js';
import type { FormType } from '../model/claim.js';

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
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Screen = 'welcome' | 'loading' | 'error' | 'workspace';
type ZoomMode = 'manual' | 'fit-page' | 'fit-width';

interface AppState {
  screen: Screen;
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

  inspectorOpen: boolean;
  theme: 'light' | 'dark';

  errorMessage: string;
}

const state: AppState = {
  screen: 'welcome',
  fileName: '',
  source: null,
  summaries: [],
  currentIndex: 0,
  detail: null,
  pdfDoc: null,
  pageNum: 1,
  pageCount: 1,
  zoom: 1,
  zoomMode: 'fit-page',
  inspectorOpen: true,
  theme: 'light',
  errorMessage: '',
};

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

const titlebarFileNameEl = requireEl<HTMLSpanElement>('titlebarFileName');

const openBtn = requireEl<HTMLButtonElement>('openBtn');
const exportBtn = requireEl<HTMLButtonElement>('exportBtn');

const zoomSepEl = requireEl<HTMLSpanElement>('zoomSep');
const zoomGroupEl = requireEl<HTMLDivElement>('zoomGroup');
const zoomOutBtn = requireEl<HTMLButtonElement>('zoomOutBtn');
const zoomLabelEl = requireEl<HTMLSpanElement>('zoomLabel');
const zoomInBtn = requireEl<HTMLButtonElement>('zoomInBtn');
const fitPageBtn = requireEl<HTMLButtonElement>('fitPageBtn');
const fitWidthBtn = requireEl<HTMLButtonElement>('fitWidthBtn');

const pageGroupEl = requireEl<HTMLDivElement>('pageGroup');
const prevPageBtn = requireEl<HTMLButtonElement>('prevPageBtn');
const pageLabelEl = requireEl<HTMLSpanElement>('pageLabel');
const nextPageBtn = requireEl<HTMLButtonElement>('nextPageBtn');

const claimGroupEl = requireEl<HTMLDivElement>('claimGroup');
const prevClaimBtn = requireEl<HTMLButtonElement>('prevClaimBtn');
const claimStepLabelEl = requireEl<HTMLSpanElement>('claimStepLabel');
const nextClaimBtn = requireEl<HTMLButtonElement>('nextClaimBtn');

const inspectorToggleBtn = requireEl<HTMLButtonElement>('inspectorToggleBtn');
const inspectorToggleLabelEl = requireEl<HTMLSpanElement>('inspectorToggleLabel');
const themeToggleBtn = requireEl<HTMLButtonElement>('themeToggleBtn');
const themeToggleLabelEl = requireEl<HTMLSpanElement>('themeToggleLabel');

const warnBannerEl = requireEl<HTMLDivElement>('warnBanner');
const warnCountEl = requireEl<HTMLSpanElement>('warnCount');
const warnMessagesEl = requireEl<HTMLSpanElement>('warnMessages');
const warnReviewBtn = requireEl<HTMLButtonElement>('warnReviewBtn');

const welcomeScreenEl = requireEl<HTMLDivElement>('welcomeScreen');
const welcomeOpenBtn = requireEl<HTMLButtonElement>('welcomeOpenBtn');

const loadingScreenEl = requireEl<HTMLDivElement>('loadingScreen');
const loadingLabelEl = requireEl<HTMLDivElement>('loadingLabel');

const errorScreenEl = requireEl<HTMLDivElement>('errorScreen');
const errorDetailEl = requireEl<HTMLDivElement>('errorDetail');
const errorOpenBtn = requireEl<HTMLButtonElement>('errorOpenBtn');
const errorCopyBtn = requireEl<HTMLButtonElement>('errorCopyBtn');

const previewPaneEl = requireEl<HTMLDivElement>('previewPane');
const workspaceScreenEl = requireEl<HTMLDivElement>('workspaceScreen');
const provenanceChipTextEl = requireEl<HTMLSpanElement>('provenanceChipText');
const sampleChipEl = requireEl<HTMLSpanElement>('sampleChip');
const unsupportedNoteEl = requireEl<HTMLDivElement>('unsupportedNote');
const pdfScrollEl = requireEl<HTMLDivElement>('pdfScroll');
const pdfCanvasEl = requireEl<HTMLCanvasElement>('pdfCanvas');

const inspectorEl = requireEl<HTMLElement>('inspector');
const expandAllBtn = requireEl<HTMLButtonElement>('expandAllBtn');
const inspectorBodyEl = requireEl<HTMLDivElement>('inspectorBody');

const statusFileGroupEl = requireEl<HTMLSpanElement>('statusFileGroup');
const statusFileNameEl = requireEl<HTMLSpanElement>('statusFileName');
const statusFormTypeEl = requireEl<HTMLSpanElement>('statusFormType');
const statusWarnBtnEl = requireEl<HTMLButtonElement>('statusWarnBtn');
const statusTotalsEl = requireEl<HTMLSpanElement>('statusTotals');
const statusNoFileEl = requireEl<HTMLSpanElement>('statusNoFile');

const exportOverlayEl = requireEl<HTMLDivElement>('exportOverlay');
const exportIntroEl = requireEl<HTMLParagraphElement>('exportIntro');
const manifestFormEl = requireEl<HTMLSpanElement>('manifestForm');
const manifestLinesEl = requireEl<HTMLSpanElement>('manifestLines');
const manifestTotalEl = requireEl<HTMLSpanElement>('manifestTotal');
const manifestWarningsEl = requireEl<HTMLSpanElement>('manifestWarnings');
const exportConfirmBtn = requireEl<HTMLButtonElement>('exportConfirmBtn');

const shortcutsOverlayEl = requireEl<HTMLDivElement>('shortcutsOverlay');
const shortcutsGridEl = requireEl<HTMLDivElement>('shortcutsGrid');

const toastEl = requireEl<HTMLDivElement>('toast');
const toastMessageEl = requireEl<HTMLSpanElement>('toastMessage');
const toastActionsEl = requireEl<HTMLDivElement>('toastActions');
const toastOpenFolderBtn = requireEl<HTMLButtonElement>('toastOpenFolderBtn');
const toastOpenPdfBtn = requireEl<HTMLButtonElement>('toastOpenPdfBtn');
const toastCloseBtn = requireEl<HTMLButtonElement>('toastCloseBtn');

// ---------------------------------------------------------------------------
// Small formatting helpers (kept local to the renderer — see task notes:
// this file owns src/renderer/** and stays self-contained rather than
// reaching into src/render/text.ts, which belongs to the PDF-rendering
// surface this task doesn't touch).
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function orDash(value: string): string {
  return value === '' ? '—' : value;
}

function formTypeText(formType: FormType): string {
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
// Motion: prefers-reduced-motion + the loading screen's minimum-visible floor
// ---------------------------------------------------------------------------

/**
 * Read once via matchMedia rather than inferring it from CSS, so the two
 * JS-driven timing decisions below (the toast/dialog close delay) can honor
 * the same preference style.css's `@media (prefers-reduced-motion: reduce)`
 * block already collapses every animation/transition under — a user who
 * asked the OS for reduced motion shouldn't still sit through a close
 * delay whose animation became invisible but whose timer didn't.
 */
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

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

function updateInspectorVisibility(): void {
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

function toggleInspector(): void {
  state.inspectorOpen = !state.inspectorOpen;
  updateInspectorVisibility();
}

// ---------------------------------------------------------------------------
// PDF preview: rendering, zoom, pagination
// ---------------------------------------------------------------------------

/** The #pdfScroll element's content-box size (its border-box rect minus its own padding), i.e. the space actually available to draw the page into. */
function availableViewport(): { width: number; height: number } {
  const rect = pdfScrollEl.getBoundingClientRect();
  const style = getComputedStyle(pdfScrollEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return { width: Math.max(100, rect.width - padX), height: Math.max(100, rect.height - padY) };
}

async function pageBaseSize(): Promise<{ width: number; height: number }> {
  if (!state.pdfDoc) return { width: 612, height: 792 };
  const page = await state.pdfDoc.getPage(state.pageNum);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/*
 * Preview renders are serialized: pdf.js rejects a second render() on a
 * canvas that is still painting, which a burst of Ctrl+wheel zoom events
 * would otherwise trigger ("Cannot use the same canvas during multiple
 * render() operations"). Each call marks the preview dirty; one in-flight
 * loop keeps redrawing until it settles on the latest zoom/page, so a fast
 * burst collapses into the final frame instead of throwing.
 */
let renderRunning = false;
let renderDirty = false;
// OR-accumulated across whatever calls stack up while a render is already
// in flight (e.g. a burst of Ctrl+wheel zoom steps landing between a page
// change) — if any of the pending calls asked for the fade, the frame that
// eventually settles still plays it, rather than losing it to coalescing.
let renderDirtyFade = false;

/**
 * `fade`: true for an actual claim/page change (spec requirement 7 — the
 * preview shouldn't hard-cut when the user steps pages/claims); false
 * (default) for a zoom-triggered redraw, where the same canvas repaints
 * many times a second during Ctrl+wheel zoom and fading on every frame
 * would flicker rather than read as polish — see #pdfCanvas.isFadingIn's
 * comment in style.css.
 */
async function renderPdfPage(fade = false): Promise<void> {
  renderDirty = true;
  renderDirtyFade = renderDirtyFade || fade;
  if (renderRunning) return;
  renderRunning = true;
  try {
    while (renderDirty) {
      renderDirty = false;
      const shouldFade = renderDirtyFade;
      renderDirtyFade = false;
      await renderPdfPageNow(shouldFade);
    }
  } finally {
    renderRunning = false;
  }
}

async function renderPdfPageNow(fade: boolean): Promise<void> {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.pageNum);
  const viewport = page.getViewport({ scale: state.zoom });

  pdfCanvasEl.width = viewport.width;
  pdfCanvasEl.height = viewport.height;
  const ctx = pdfCanvasEl.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  await page.render({ canvasContext: ctx, viewport, canvas: pdfCanvasEl }).promise;

  if (fade) {
    // Restart the CSS animation even if it's already mid-fade (rapid page
    // stepping): remove the class, force a synchronous style flush by
    // reading a layout property, then re-add it — otherwise a browser can
    // coalesce "remove then immediately re-add the same class" into a
    // no-op style recalculation and the animation never restarts.
    pdfCanvasEl.classList.remove('isFadingIn');
    void pdfCanvasEl.offsetWidth;
    pdfCanvasEl.classList.add('isFadingIn');
  }

  pageLabelEl.textContent = `Page ${state.pageNum} of ${state.pageCount}`;
  prevPageBtn.disabled = state.pageNum <= 1;
  nextPageBtn.disabled = state.pageNum >= state.pageCount;
}

/** Sets zoom (clamped 25%-400%), updates the toolbar label/active states, and redraws the current page. Does not change zoomMode — callers set that first. `fade` only ever arrives `true` from loadCurrentClaim()'s initial fitPage() — see renderPdfPage()'s doc comment. */
async function applyZoom(z: number, fade = false): Promise<void> {
  state.zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));
  zoomLabelEl.textContent = `${Math.round(state.zoom * 100)}%`;
  fitPageBtn.classList.toggle('isActive', state.zoomMode === 'fit-page');
  fitWidthBtn.classList.toggle('isActive', state.zoomMode === 'fit-width');
  await renderPdfPage(fade);
}

async function zoomBy(delta: number): Promise<void> {
  state.zoomMode = 'manual';
  await applyZoom(state.zoom + delta);
}

async function zoomToActualSize(): Promise<void> {
  state.zoomMode = 'manual';
  await applyZoom(1);
}

async function fitPage(fade = false): Promise<void> {
  state.zoomMode = 'fit-page';
  const avail = availableViewport();
  const base = await pageBaseSize();
  await applyZoom(Math.min(avail.width / base.width, avail.height / base.height), fade);
}

async function fitWidth(fade = false): Promise<void> {
  state.zoomMode = 'fit-width';
  const avail = availableViewport();
  const base = await pageBaseSize();
  // Small allowance so the page edge doesn't butt exactly against the
  // scroll container (and never trigger a horizontal scrollbar right at
  // 100% fit-width).
  await applyZoom((avail.width - 4) / base.width, fade);
}

async function stepPage(delta: number): Promise<void> {
  const next = state.pageNum + delta;
  if (next < 1 || next > state.pageCount) return;
  state.pageNum = next;
  await renderPdfPage(true);
}

// Re-fit on window resize, but only while the user is in a "fit" mode —
// a manually chosen zoom percentage should never silently change under
// them just because the window moved.
let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  if (state.screen !== 'workspace' || state.zoomMode === 'manual') return;
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    void (state.zoomMode === 'fit-width' ? fitWidth() : fitPage());
  }, 120);
});

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Ctrl+wheel zoom step, as a multiplier exponent per unit of wheel delta.
 * Deliberately gentle (~7% per standard mouse notch) so the page size can be
 * dialled in precisely rather than jumping past the size you wanted — raise
 * it for coarser, faster steps.
 */
const ZOOM_WHEEL_SENSITIVITY = 0.00075;

/*
 * Ctrl/Cmd + wheel zooms the preview, anchored at the pointer so whatever
 * is under the cursor stays under it. A plain wheel still scrolls the page
 * (and Shift+wheel still scrolls horizontally), so only the modified
 * gesture is intercepted. preventDefault stops Chromium from browser-zooming
 * the whole UI instead. Trackpad pinch arrives as a ctrlKey wheel event too,
 * so pinch-to-zoom rides the same path for free.
 */
pdfScrollEl.addEventListener(
  'wheel',
  (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (state.screen !== 'workspace' || !state.pdfDoc) return;
    event.preventDefault();

    // Cursor position as a 0-1 fraction of the rendered page. Recomputed per
    // event from the live rect, so a fast burst self-corrects rather than
    // drifting off the anchor.
    const before = pdfCanvasEl.getBoundingClientRect();
    const fracX = before.width > 0 ? clamp01((event.clientX - before.left) / before.width) : 0.5;
    const fracY = before.height > 0 ? clamp01((event.clientY - before.top) / before.height) : 0.5;
    const { clientX, clientY } = event;

    // Multiplicative step so a notch feels the same at 25% and at 400%.
    // deltaMode 1 (lines) / 2 (pages) report far smaller numbers than pixels.
    const unit = event.deltaMode === 0 ? event.deltaY : event.deltaY * 16;
    const current = state.zoom;
    let target = current * Math.exp(-unit * ZOOM_WHEEL_SENSITIVITY);
    // applyZoom snaps to whole percent; nudge a full step when a very small
    // (trackpad) delta would otherwise round back to the same zoom forever.
    if (Math.round(target * 100) === Math.round(current * 100)) {
      target = current + (unit < 0 ? 0.01 : -0.01);
    }

    state.zoomMode = 'manual';
    void applyZoom(target).then(() => {
      // Re-read after the redraw, then scroll the anchor back under the
      // cursor. Reading the real rect handles the centred-page case (small
      // page in a wide pane) without special-casing it.
      requestAnimationFrame(() => {
        const after = pdfCanvasEl.getBoundingClientRect();
        pdfScrollEl.scrollLeft += after.left + fracX * after.width - clientX;
        pdfScrollEl.scrollTop += after.top + fracY * after.height - clientY;
      });
    });
  },
  { passive: false },
);

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

function renderInspector(detail: ClaimDetailDto): void {
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

  // pdf.js may transfer/detach the buffer it's given; hand it a fresh copy
  // so re-rendering (stepping back and forth, zooming) never operates on a
  // stale one.
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  state.pdfDoc = await loadingTask.promise;
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
// Export dialog
// ---------------------------------------------------------------------------

/**
 * Modal dialog focus management (WCAG-AA — spec §2): on open, focus moves
 * into the dialog; Tab/Shift+Tab is trapped inside it (see
 * trapTabInOverlay(), wired from the keydown handler below) so
 * behind-the-scrim controls are never Tab-reachable while a dialog is open;
 * on close, focus is restored to whatever control invoked the dialog.
 */
let lastFocusedBeforeOverlay: HTMLElement | null = null;

/**
 * The scrim + dialog fade/scale out on close (spec requirement 4) rather
 * than vanishing on the spot like every other `hidden`-driven element in
 * this file — see style.css's `.overlay.isClosing` comment for why a
 * dialog close can afford the brief, deliberate delay that a hot-path
 * element (menu dropdown, state screen) can't. Keyed by overlay id so
 * opening one overlay can never cancel an in-flight close of the other.
 */
const OVERLAY_EXIT_MS = 150; // keep in sync with .overlay.isClosing / .dialog's exit-animation duration in style.css
const overlayCloseTimers: Record<'export' | 'shortcuts', number | undefined> = { export: undefined, shortcuts: undefined };

function overlayElFor(id: 'export' | 'shortcuts'): HTMLDivElement {
  return id === 'export' ? exportOverlayEl : shortcutsOverlayEl;
}

/** All focusable elements within `container`, in DOM order — used both to find the dialog's first control on open and to compute the Tab-trap boundary. */
function focusableEls(container: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

function openOverlay(id: 'export' | 'shortcuts'): void {
  // Reopening while a previous close is still fading out (fast double-toggle)
  // must win outright: drop the pending hide so it can't fire mid-reopen.
  const pendingClose = overlayCloseTimers[id];
  if (pendingClose !== undefined) {
    window.clearTimeout(pendingClose);
    overlayCloseTimers[id] = undefined;
  }
  const overlay = overlayElFor(id);
  overlay.classList.remove('isClosing');

  lastFocusedBeforeOverlay = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay.hidden = false;
  const dialog = overlay.querySelector<HTMLElement>('.dialog');
  if (!dialog) return;
  // Focus the dialog container itself (its accessible name comes from
  // aria-labelledby -> the title span), rather than guessing which inner
  // control counts as "first" — this reads the title to screen-reader users
  // immediately on open and is a well-established APG pattern for dialogs
  // that don't have one obvious initial control.
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  dialog.focus();
}

function closeOverlay(id: 'export' | 'shortcuts'): void {
  const overlay = overlayElFor(id);
  if (overlay.hidden || overlay.classList.contains('isClosing')) return; // already closed, or already closing
  const restore = lastFocusedBeforeOverlay;
  lastFocusedBeforeOverlay = null;

  const finish = (): void => {
    overlay.hidden = true;
    overlay.classList.remove('isClosing');
    overlayCloseTimers[id] = undefined;
    restore?.focus();
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }
  overlay.classList.add('isClosing');
  overlayCloseTimers[id] = window.setTimeout(finish, OVERLAY_EXIT_MS);
}

function anyOverlayOpen(): boolean {
  return !exportOverlayEl.hidden || !shortcutsOverlayEl.hidden;
}

/** Tab/Shift+Tab trap for whichever overlay is currently open — called from the keydown handler below whenever anyOverlayOpen() and the key is Tab. */
function trapTabInOverlay(event: KeyboardEvent): void {
  const activeOverlay = !exportOverlayEl.hidden ? exportOverlayEl : !shortcutsOverlayEl.hidden ? shortcutsOverlayEl : null;
  if (!activeOverlay) return;
  const dialog = activeOverlay.querySelector<HTMLElement>('.dialog');
  if (!dialog) return;

  const focusables = focusableEls(dialog);
  if (focusables.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const current = document.activeElement;
  const insideDialog = current instanceof Node && dialog.contains(current);

  if (event.shiftKey) {
    if (!insideDialog || current === first || current === dialog) {
      event.preventDefault();
      last.focus();
    }
  } else if (!insideDialog || current === last) {
    event.preventDefault();
    first.focus();
  }
}

function openExportDialog(): void {
  if (exportBtn.disabled) return;
  const summary = state.summaries[state.currentIndex];
  const detail = state.detail;
  if (!summary || !detail) return;

  exportIntroEl.textContent = `Export this claim (${summary.claimId || 'claim'}) as a PDF.`;
  manifestFormEl.textContent = formTypeText(summary.formType);
  manifestLinesEl.textContent = String(detail.serviceLines.length);
  manifestTotalEl.textContent = formatMoney(detail.totals.totalCharge);
  manifestWarningsEl.textContent = detail.warnings.length === 0 ? 'None' : `${detail.warnings.length} noted in the inspector`;

  exportConfirmBtn.disabled = false;
  exportConfirmBtn.textContent = 'Export';
  openOverlay('export');
}

async function confirmExport(): Promise<void> {
  exportConfirmBtn.disabled = true;
  exportConfirmBtn.textContent = 'Exporting…';
  try {
    // claimApi.exportPdf opens its own native save-file dialog (with a
    // PHI-free default name) and writes the PDF; it resolves the saved
    // path, or null if the user cancels that dialog.
    const path = await window.claimApi.exportPdf(state.currentIndex);
    closeOverlay('export');
    // The export "done" state (Open containing folder / Open PDF, design
    // ClaimViewer_v2.dc.html:776-777 / spec §7) lives in the toast rather
    // than as a second screen inside the export dialog itself, so
    // confirming export still closes the dialog immediately — exactly what
    // it did before these actions existed.
    if (path) showToast(`Exported to ${path}`, false, true);
  } catch (err) {
    closeOverlay('export');
    showToast(errorMessage(err), true);
  } finally {
    exportConfirmBtn.disabled = false;
    exportConfirmBtn.textContent = 'Export';
  }
}

/** Ctrl+Shift+E ("export this claim, skip the confirmation dialog"): calls claimApi.exportPdf directly — the user still sees the native OS save dialog (there's no way around that), only the app's own manifest/PHI-notice confirmation step is skipped. */
async function exportCurrentClaimSkipDialog(): Promise<void> {
  if (exportBtn.disabled) return;
  if (anyOverlayOpen()) return;
  try {
    const path = await window.claimApi.exportPdf(state.currentIndex);
    if (path) showToast(`Exported to ${path}`, false, true);
  } catch (err) {
    showToast(errorMessage(err), true);
  }
}

exportOverlayEl.addEventListener('click', (event) => {
  if (event.target === exportOverlayEl) closeOverlay('export');
});
shortcutsOverlayEl.addEventListener('click', (event) => {
  if (event.target === shortcutsOverlayEl) closeOverlay('shortcuts');
});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset['close'];
    if (id === 'export' || id === 'shortcuts') closeOverlay(id);
  });
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastAutoDismissTimer: number | undefined;
let toastHideTimer: number | undefined;

const TOAST_EXIT_MS = 150; // keep in sync with .toast.isClosing's exit-animation duration in style.css

/** Fades the toast out (spec requirement 3) and only then hides it — same close-is-a-deliberate-action reasoning, and the same pattern, as closeOverlay() above. Safe to call while the toast is already hidden or already closing (both no-op). */
function dismissToast(): void {
  if (toastEl.hidden || toastEl.classList.contains('isClosing')) return;
  if (toastAutoDismissTimer !== undefined) {
    window.clearTimeout(toastAutoDismissTimer);
    toastAutoDismissTimer = undefined;
  }

  const finish = (): void => {
    toastEl.hidden = true;
    toastEl.classList.remove('isClosing');
    toastHideTimer = undefined;
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }
  toastEl.classList.add('isClosing');
  toastHideTimer = window.setTimeout(finish, TOAST_EXIT_MS);
}

/** `withActions`: shows the "Open containing folder" / "Open PDF" export-done actions (spec §7) alongside the message, and stays up longer so there's time to click one. */
function showToast(message: string, isError: boolean, withActions = false): void {
  if (toastAutoDismissTimer !== undefined) window.clearTimeout(toastAutoDismissTimer);
  if (toastHideTimer !== undefined) window.clearTimeout(toastHideTimer);
  toastEl.classList.remove('isClosing');
  toastMessageEl.textContent = message;
  toastEl.classList.toggle('isError', isError);
  toastActionsEl.hidden = !withActions;
  toastEl.hidden = false;
  toastAutoDismissTimer = window.setTimeout(dismissToast, withActions ? 15000 : 6000);
}

toastCloseBtn.addEventListener('click', dismissToast);

toastOpenFolderBtn.addEventListener('click', () => {
  void window.claimApi.openExport('folder').catch((err) => showToast(errorMessage(err), true));
});
toastOpenPdfBtn.addEventListener('click', () => {
  void window.claimApi.openExport('file').catch((err) => showToast(errorMessage(err), true));
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts dialog (content)
// ---------------------------------------------------------------------------

const KEY_GROUPS: Array<{ title: string; items: Array<{ label: string; keys: string }> }> = [
  {
    title: 'File',
    items: [
      { label: 'Open a claim file', keys: 'Ctrl+O' },
      { label: 'Export this claim…', keys: 'Ctrl+E' },
      { label: 'Export this claim (skip dialog)', keys: 'Ctrl+Shift+E' },
      { label: 'Close file', keys: 'Ctrl+W' },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Zoom in / out', keys: 'Ctrl+ + / Ctrl+ −' },
      { label: 'Zoom at the pointer', keys: 'Ctrl + scroll' },
      { label: 'Actual size', keys: 'Ctrl+0' },
      { label: 'Fit page', keys: 'Ctrl+9' },
      { label: 'Fit width', keys: 'Ctrl+8' },
      { label: 'Toggle inspector', keys: 'Ctrl+D' },
      { label: 'Light / dark', keys: 'Ctrl+Shift+L' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { label: 'Previous / next form page', keys: 'Ctrl+← / Ctrl+→' },
      { label: 'Previous / next claim (837 file)', keys: 'PageUp / PageDown' },
    ],
  },
  {
    title: 'Help',
    items: [
      { label: 'Keyboard shortcuts', keys: 'F1' },
      { label: 'Dismiss dialog', keys: 'Esc' },
    ],
  },
];

function renderShortcuts(): void {
  shortcutsGridEl.innerHTML = '';
  for (const group of KEY_GROUPS) {
    const col = document.createElement('div');
    col.className = 'shortcutsCol';
    const title = document.createElement('div');
    title.className = 'shortcutsColTitle';
    title.textContent = group.title;
    col.append(title);
    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'shortcutRow';
      const label = document.createElement('span');
      label.className = 'shortcutLabel';
      label.textContent = item.label;
      const keys = document.createElement('kbd');
      keys.textContent = item.keys;
      row.append(label, keys);
      col.append(row);
    }
    shortcutsGridEl.append(col);
  }
}

function openShortcuts(): void {
  openOverlay('shortcuts');
}

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------

/** Set by setupMenus() once the menu DOM exists; the keydown handler below also calls this (Escape collapses open menus). No-op before setupMenus() runs. */
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

window.addEventListener('keydown', (event) => {
  if (event.key === 'F1') {
    event.preventDefault();
    openShortcuts();
    return;
  }
  if (event.key === 'Tab' && anyOverlayOpen()) {
    trapTabInOverlay(event);
    return;
  }
  if (event.key === 'Escape') {
    if (anyOverlayOpen()) {
      closeOverlay('export');
      closeOverlay('shortcuts');
    }
    closeAllMenus();
    return;
  }
  if (event.key === 'F6' && !anyOverlayOpen()) {
    event.preventDefault();
    cycleRegionFocus(event.shiftKey ? -1 : 1);
    return;
  }
  if (event.key === 'PageUp') {
    event.preventDefault();
    void stepClaim(-1);
    return;
  }
  if (event.key === 'PageDown') {
    event.preventDefault();
    void stepClaim(1);
    return;
  }

  const ctrlOrCmd = event.ctrlKey || event.metaKey;
  if (!ctrlOrCmd) return;

  if (event.shiftKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    toggleTheme();
    return;
  }
  if (event.shiftKey && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    void exportCurrentClaimSkipDialog();
    return;
  }

  switch (event.key.toLowerCase()) {
    case 'o':
      event.preventDefault();
      void openClaimFlow();
      break;
    case 'e':
      event.preventDefault();
      openExportDialog();
      break;
    case 'd':
      event.preventDefault();
      toggleInspector();
      break;
    case 'w':
      event.preventDefault();
      closeFile();
      break;
    case '+':
    case '=':
      event.preventDefault();
      void zoomBy(0.1);
      break;
    case '-':
      event.preventDefault();
      void zoomBy(-0.1);
      break;
    case '0':
      event.preventDefault();
      void zoomToActualSize();
      break;
    case '9':
      event.preventDefault();
      void fitPage();
      break;
    case '8':
      event.preventDefault();
      void fitWidth();
      break;
    case 'arrowleft':
      event.preventDefault();
      void stepPage(-1);
      break;
    case 'arrowright':
      event.preventDefault();
      void stepPage(1);
      break;
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initTheme();
setupMenus();
renderShortcuts();
setupDragAndDrop();
showScreen('welcome');
