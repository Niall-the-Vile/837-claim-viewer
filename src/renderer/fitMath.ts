/**
 * Pure fit-page / fit-width math, extracted out of preview.ts so it's
 * unit-testable under vitest without touching the DOM — preview.ts (and
 * dom.ts, which it imports) call `document.getElementById` at module scope,
 * which throws under vitest's Node test environment; see
 * test/tabState.test.ts's header comment for the same "split the DOM-free
 * logic into its own importable module" pattern this file follows.
 *
 * docs/UI_REQUIREMENTS_v3_queued_features.md §9 mandatory sub-task 2: fit
 * math must produce the SAME resulting PDF zoom% regardless of the View
 * menu's UI text scale (`--ui-scale`). That holds here by construction
 * rather than by a correction applied inside this module: these functions
 * take no `uiScale` argument at all, on purpose. The values they receive
 * (`avail`, from preview.ts's `availableViewport()`) are already accurate,
 * un-scaled PDF-point measurements at every --ui-scale setting — because
 * `#pdfScroll` deliberately never inherits any ambient chrome zoom (see
 * style.css's `--ui-scale` comment and `preview.ts`'s `availableViewport`
 * doc comment for the full architecture). A function that took a scale
 * factor and divided by it here would be compensating for a corruption this
 * app's CSS architecture doesn't have — and would actively BREAK the
 * "fitWidth yields the same zoom at 175% as at 100%" invariant by shrinking
 * an already-correct measurement a second time. See e2e/uiScale.spec.ts for
 * where that invariant is verified against the real, running app (a
 * pure-function unit test alone cannot prove the upstream DOM measurement
 * itself is uncorrupted — only that this math is correct given accurate
 * inputs, which is what the tests in test/fitMath.test.ts cover).
 */

export interface FitSize {
  width: number;
  height: number;
}

/** fitPage's ratio: the larger of `base` scaled to fit entirely inside `avail` on both axes (the smaller of the two per-axis ratios). */
export function computeFitPageZoom(avail: FitSize, base: FitSize): number {
  return Math.min(avail.width / base.width, avail.height / base.height);
}

/** fitWidth's ratio: `base`'s width scaled to `avail`'s width, minus the same small clearance fitWidth has always used so the page edge doesn't butt exactly against the scroll container. */
export function computeFitWidthZoom(avail: FitSize, base: FitSize): number {
  return (avail.width - 4) / base.width;
}
