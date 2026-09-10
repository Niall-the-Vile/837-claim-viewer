import { expect, type Page } from '@playwright/test';

/**
 * Shared canvas-readiness helper for the E2E suite (docs/AUDIT_BUILD2.md).
 *
 * WHY THIS EXISTS: `#pdfCanvas` is declared in index.html with no width or
 * height attributes, so before pdf.js has rendered into it, it reports the
 * HTML default of 300x150 — not 0x0. And src/renderer/main.ts marks a tab
 * `ready` and calls syncScreenUI() (which reveals #workspaceScreen) BEFORE
 * awaiting fitPage/renderPdfPage, so "the workspace is visible" does not
 * imply "the canvas has been rendered into".
 *
 * That combination made two different mistakes possible across the suite:
 *   - `expect(canvas.width).toBeGreaterThan(0)` under a comment claiming it
 *     proves "a real render, not just an empty <canvas>" — vacuous, since
 *     the 300x150 default satisfies it.
 *   - Capturing a `before` baseline for a later comparison without waiting,
 *     which could snapshot {300,150} and then compare it against a real
 *     render — an intermittent red rather than a real signal.
 *
 * Always call this before capturing a canvas baseline or asserting on canvas
 * dimensions.
 *
 * The check is "width has moved away from the default", not "width is
 * greater than the default": on a small-viewport runner (e.g. the
 * windows-latest GitHub Actions runner's virtual display, which has no
 * physical monitor) fit-to-page math can legitimately render the page at a
 * pixel width *below* 300, not just above it. Asserting `> 300` treated that
 * as an eternally-unrendered canvas and timed out for real, watched renders.
 */

/** The width an unrendered <canvas> reports when it carries no width attribute. */
export const UNRENDERED_CANVAS_WIDTH = 300;

/**
 * Waits until pdf.js has actually sized `#pdfCanvas` away from the HTML
 * default, i.e. a first real render has landed.
 */
export async function waitForFirstRender(page: Page): Promise<void> {
  await expect
    .poll(
      async () => page.locator('#pdfCanvas').evaluate((el) => (el as HTMLCanvasElement).width),
      { message: 'pdf.js never rendered into #pdfCanvas (still at the unrendered 300px default)' },
    )
    .not.toBe(UNRENDERED_CANVAS_WIDTH);
}

/** Reads the canvas's current pixel dimensions, after waiting for a first real render. */
export async function renderedCanvasSize(page: Page): Promise<{ width: number; height: number }> {
  await waitForFirstRender(page);
  return page.locator('#pdfCanvas').evaluate((el) => ({ width: (el as HTMLCanvasElement).width, height: (el as HTMLCanvasElement).height }));
}
