import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// `?url` gives Vite's resolved asset URL for the worker file (bundled and
// copied into dist/renderer at build time) instead of trying to parse it as
// a JS module — this is what keeps the pdf.js worker fully local/offline;
// it is never fetched from a CDN.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfScrollEl, pdfCanvasEl, pageLabelEl, prevPageBtn, nextPageBtn, zoomLabelEl, fitPageBtn, fitWidthBtn } from './dom.js';
import { state } from './tabs.js';

/**
 * pdf.js load/render/zoom/page-stepping for the single shared preview
 * canvas. Pure-moved out of main.ts — see docs/TABS_BUILD_PLAN.md §2 Item 0.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ---------------------------------------------------------------------------
// PDF preview: loading, rendering, zoom, pagination
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

/** Loads a claim's PDF bytes into a fresh pdf.js document. pdf.js may transfer/detach the buffer it's given; hand it a fresh copy so re-rendering (stepping back and forth, zooming) never operates on a stale one. */
export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  return loadingTask.promise;
}

/*
 * Preview renders are serialized: pdf.js rejects a second render() on a
 * canvas that is still painting, which a burst of Ctrl+wheel zoom events
 * would otherwise trigger ("Cannot use the same canvas during multiple
 * render() operations"). Each call marks the preview dirty; one in-flight
 * loop keeps redrawing until it settles on the latest zoom/page, so a fast
 * burst collapses into the final frame instead of throwing.
 *
 * These flags MUST stay module-level (one canvas, one loop) — see
 * docs/ROADMAP.md §1 / TABS_BUILD_PLAN.md §2 watch-out (b). Do not move them
 * into per-tab state.
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
export async function renderPdfPage(fade = false): Promise<void> {
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
export async function applyZoom(z: number, fade = false): Promise<void> {
  state.zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));
  zoomLabelEl.textContent = `${Math.round(state.zoom * 100)}%`;
  fitPageBtn.classList.toggle('isActive', state.zoomMode === 'fit-page');
  fitWidthBtn.classList.toggle('isActive', state.zoomMode === 'fit-width');
  await renderPdfPage(fade);
}

export async function zoomBy(delta: number): Promise<void> {
  state.zoomMode = 'manual';
  await applyZoom(state.zoom + delta);
}

export async function zoomToActualSize(): Promise<void> {
  state.zoomMode = 'manual';
  await applyZoom(1);
}

export async function fitPage(fade = false): Promise<void> {
  state.zoomMode = 'fit-page';
  const avail = availableViewport();
  const base = await pageBaseSize();
  await applyZoom(Math.min(avail.width / base.width, avail.height / base.height), fade);
}

export async function fitWidth(fade = false): Promise<void> {
  state.zoomMode = 'fit-width';
  const avail = availableViewport();
  const base = await pageBaseSize();
  // Small allowance so the page edge doesn't butt exactly against the
  // scroll container (and never trigger a horizontal scrollbar right at
  // 100% fit-width).
  await applyZoom((avail.width - 4) / base.width, fade);
}

export async function stepPage(delta: number): Promise<void> {
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
