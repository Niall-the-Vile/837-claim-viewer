import type { RenderTask } from 'pdfjs-dist';
import { RenderingCancelledException } from 'pdfjs-dist';
import { pdfScrollEl, pdfCanvasEl, pageLabelEl, prevPageBtn, nextPageBtn, zoomLabelEl, fitPageBtn, fitWidthBtn } from './dom.js';
import { state, currentScreen, activeTab, type TabState } from './tabs.js';
import { computeFitPageZoom, computeFitWidthZoom } from './fitMath.js';

/**
 * pdf.js load/render/zoom/page-stepping for the single shared preview
 * canvas. Pure-moved out of main.ts — see docs/TABS_BUILD_PLAN.md §2 Item 0
 * — then made tab-aware for multi-file tabs (§2 watch-out (b)).
 *
 * THE CANVAS IS SHARED AND STAYS SHARED: there is exactly one
 * `<canvas id="pdfCanvas">`, and every zoom/page/pageNum value below lives
 * on the `TabState` a caller passes in, NOT on this module. But the render
 * SERIALIZATION (`renderRunning`/`pendingTab`/`pendingFade` below) stays
 * module-level on purpose — one canvas, one render loop. Moving it per-tab
 * would let two tabs' render loops target the same canvas concurrently and
 * reintroduce the pdf.js "Cannot use the same canvas during multiple
 * render() operations" error this serialization exists to prevent. Instead,
 * each render request is stamped with the tab that issued it;
 * `renderPdfPageNow` re-checks `state.activeTabId` before (and again after
 * every await) touching the canvas and bails if the requesting tab is no
 * longer active, and `cancelInFlightRender()` cancels any in-flight
 * `page.render()` via `RenderTask.cancel()` on tab switch (see main.ts's
 * `activateTabById`), swallowing the resulting `RenderingCancelledException`.
 *
 * Document creation/destruction (loadPdfDocument / setActivePdfDoc) lives in
 * tabs.ts, not here — see that file's header comment for why (pdf.js's real
 * `.destroy()` lives on the `PDFDocumentLoadingTask`, which this module
 * never sees — only the `PDFDocumentProxy` a tab's `pdfDoc` holds).
 */

// ---------------------------------------------------------------------------
// PDF preview: loading, rendering, zoom, pagination
// ---------------------------------------------------------------------------

/**
 * The #pdfScroll element's content-box size (its border-box rect minus its
 * own padding), i.e. the space actually available to draw the page into.
 *
 * docs/UI_REQUIREMENTS_v3_queued_features.md §9: this reading is
 * deliberately NOT corrected for the View menu's UI text scale
 * (`--ui-scale`) — #pdfScroll is one of the two elements (with #pdfCanvas)
 * style.css's chrome-scaling rules explicitly never zoom, and it never sits
 * inside an ancestor that does either (#app/#body/#previewPane carry no
 * `zoom`; only the standalone chrome regions like #inspector/#toolbar do,
 * as independent siblings — see style.css's `--ui-scale` comment). So
 * `getBoundingClientRect()` here already returns real, un-scaled pixels at
 * every --ui-scale setting, and fitMath.ts's computeFitPageZoom/
 * computeFitWidthZoom take no scale argument for the same reason: dividing
 * an already-correct measurement by the scale would be a bug, not a fix
 * (it would make fitWidth() return a SMALLER PDF zoom% as --ui-scale grows,
 * which is exactly the invariant e2e/uiScale.spec.ts's "fitWidth is
 * unaffected by --ui-scale" test guards against).
 */
function availableViewport(): { width: number; height: number } {
  const rect = pdfScrollEl.getBoundingClientRect();
  const style = getComputedStyle(pdfScrollEl);
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return { width: Math.max(100, rect.width - padX), height: Math.max(100, rect.height - padY) };
}

async function pageBaseSize(tab: TabState): Promise<{ width: number; height: number }> {
  if (!tab.pdfDoc) return { width: 612, height: 792 };
  const page = await tab.pdfDoc.getPage(tab.pageNum);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/*
 * Preview renders are serialized: pdf.js rejects a second render() on a
 * canvas that is still painting, which a burst of Ctrl+wheel zoom events
 * would otherwise trigger ("Cannot use the same canvas during multiple
 * render() operations"). Each call marks the preview dirty with the tab that
 * requested it; one in-flight loop keeps redrawing until it settles on the
 * latest request, so a fast burst (including one that switches tabs
 * mid-flight) collapses into the final frame instead of throwing.
 *
 * These MUST stay module-level (one canvas, one loop) — see this file's
 * header comment and docs/ROADMAP.md §1 / TABS_BUILD_PLAN.md §2 watch-out
 * (b). Do not move them into per-tab state.
 */
let renderRunning = false;
let pendingTab: TabState | null = null;
// OR-accumulated across whatever calls stack up while a render is already
// in flight — if any of the pending calls asked for the fade, the frame
// that eventually settles still plays it, rather than losing it to
// coalescing.
let pendingFade = false;
/** The in-flight `page.render()` task, if any — cancelled by cancelInFlightRender() on tab switch so an outgoing tab's paint can never land on the canvas after the newly active tab starts its own render. */
let currentRenderTask: RenderTask | null = null;

/**
 * `fade`: true for an actual claim/page change (spec requirement 7 — the
 * preview shouldn't hard-cut when the user steps pages/claims); false
 * (default) for a zoom-triggered redraw, where the same canvas repaints
 * many times a second during Ctrl+wheel zoom and fading on every frame
 * would flicker rather than read as polish — see #pdfCanvas.isFadingIn's
 * comment in style.css.
 */
export async function renderPdfPage(tab: TabState, fade = false): Promise<void> {
  pendingTab = tab;
  pendingFade = pendingFade || fade;
  if (renderRunning) return;
  renderRunning = true;
  try {
    while (pendingTab) {
      const tabToRender = pendingTab;
      const shouldFade = pendingFade;
      pendingTab = null;
      pendingFade = false;
      await renderPdfPageNow(tabToRender, shouldFade);
    }
  } finally {
    renderRunning = false;
  }
}

async function renderPdfPageNow(tab: TabState, fade: boolean): Promise<void> {
  // Bail if the requesting tab is no longer active by the time it's this
  // iteration's turn — a fast tab switch can leave a stale request queued.
  if (tab.tabId !== state.activeTabId) return;
  if (!tab.pdfDoc) return;
  const page = await tab.pdfDoc.getPage(tab.pageNum);
  // Re-check after the async getPage() — the active tab may have changed
  // while awaiting.
  if (tab.tabId !== state.activeTabId) return;
  const viewport = page.getViewport({ scale: tab.zoom });

  pdfCanvasEl.width = viewport.width;
  pdfCanvasEl.height = viewport.height;
  const ctx = pdfCanvasEl.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const task = page.render({ canvasContext: ctx, viewport, canvas: pdfCanvasEl });
  currentRenderTask = task;
  try {
    await task.promise;
  } catch (err) {
    if (err instanceof RenderingCancelledException) return; // tab switch cancelled this — see cancelInFlightRender()
    throw err;
  } finally {
    if (currentRenderTask === task) currentRenderTask = null;
  }
  if (tab.tabId !== state.activeTabId) return; // switched away mid-render; the finished paint belongs to a tab that's no longer showing

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

  pageLabelEl.textContent = `Page ${tab.pageNum} of ${tab.pageCount}`;
  prevPageBtn.disabled = tab.pageNum <= 1;
  nextPageBtn.disabled = tab.pageNum >= tab.pageCount;
}

/** Cancels any in-flight page.render() — call on every tab switch (main.ts's activateTabById), before the newly active tab starts its own render. RenderTask.cancel() rejects the render's own promise with RenderingCancelledException, swallowed above. */
export function cancelInFlightRender(): void {
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
    } catch {
      // Already settled — nothing to cancel.
    }
    currentRenderTask = null;
  }
}

/** Sets zoom (clamped 25%-400%), updates the toolbar label/active states (only when `tab` is the active tab — a background tab's zoom change, if that ever happens, must never touch chrome for the wrong tab), and redraws. Does not change zoomMode — callers set that first. `fade` only ever arrives `true` from fitPage()'s initial call on a freshly loaded claim. */
export async function applyZoom(tab: TabState, z: number, fade = false): Promise<void> {
  tab.zoom = Math.min(4, Math.max(0.25, Math.round(z * 100) / 100));
  if (tab.tabId === state.activeTabId) {
    zoomLabelEl.textContent = `${Math.round(tab.zoom * 100)}%`;
    fitPageBtn.classList.toggle('isActive', tab.zoomMode === 'fit-page');
    fitWidthBtn.classList.toggle('isActive', tab.zoomMode === 'fit-width');
  }
  await renderPdfPage(tab, fade);
}

export async function zoomBy(tab: TabState, delta: number): Promise<void> {
  tab.zoomMode = 'manual';
  await applyZoom(tab, tab.zoom + delta);
}

export async function zoomToActualSize(tab: TabState): Promise<void> {
  tab.zoomMode = 'manual';
  await applyZoom(tab, 1);
}

export async function fitPage(tab: TabState, fade = false): Promise<void> {
  tab.zoomMode = 'fit-page';
  const avail = availableViewport();
  const base = await pageBaseSize(tab);
  await applyZoom(tab, computeFitPageZoom(avail, base), fade);
}

export async function fitWidth(tab: TabState, fade = false): Promise<void> {
  tab.zoomMode = 'fit-width';
  const avail = availableViewport();
  const base = await pageBaseSize(tab);
  // Small allowance so the page edge doesn't butt exactly against the
  // scroll container (and never trigger a horizontal scrollbar right at
  // 100% fit-width) — see fitMath.ts's computeFitWidthZoom.
  await applyZoom(tab, computeFitWidthZoom(avail, base), fade);
}

export async function stepPage(tab: TabState, delta: number): Promise<void> {
  const next = tab.pageNum + delta;
  if (next < 1 || next > tab.pageCount) return;
  tab.pageNum = next;
  await renderPdfPage(tab, true);
}

// Re-fit on window resize, but only while the active tab is in a "fit"
// mode — a manually chosen zoom percentage should never silently change
// under them just because the window moved.
let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  const tab = activeTab();
  if (!tab || currentScreen() !== 'workspace' || tab.zoomMode === 'manual') return;
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const t = activeTab();
    if (!t) return;
    void (t.zoomMode === 'fit-width' ? fitWidth(t) : fitPage(t));
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
    const tab = activeTab();
    if (currentScreen() !== 'workspace' || !tab || !tab.pdfDoc) return;
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
    const current = tab.zoom;
    let target = current * Math.exp(-unit * ZOOM_WHEEL_SENSITIVITY);
    // applyZoom snaps to whole percent; nudge a full step when a very small
    // (trackpad) delta would otherwise round back to the same zoom forever.
    if (Math.round(target * 100) === Math.round(current * 100)) {
      target = current + (unit < 0 ? 0.01 : -0.01);
    }

    tab.zoomMode = 'manual';
    void applyZoom(tab, target).then(() => {
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
