import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect } from 'vitest';

/**
 * Reusable rendered-PDF geometry checker, extracted from the ad-hoc version
 * that first shipped inside test/renderDental.test.ts (the one that caught
 * the checkbox + value-code overlaps). This is the PERMANENT, form-agnostic
 * version: it reads a rendered PDF back with pdfjs-dist (never trusting the
 * drawing code's own arithmetic) and checks three independent geometric
 * properties per page:
 *   1. page-bounds  — every drawn text run stays within the page.
 *   2. text-vs-box  — every drawn text run falls inside one of the form's
 *      known field-box / grid / footer regions (nothing stray in a gap).
 *   3. text-vs-text — no two drawn text runs' bounding boxes overlap.
 *
 * test/invariants.test.ts is the only caller; it supplies the page size and
 * the allowed regions per form (see test/support/regions.ts).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBox {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** pdfjs reports the standard-14 fonts' *substituted* metrics (no embedded font program), which run a percent or two wider than pdf-lib's real widths for the same text/size. A small relative+absolute slack absorbs that measurement gap without hiding a genuine overflow (which is many points, not fractions of one). */
export const GEOMETRY_TOLERANCE = 2.5;

/**
 * Approximates a text run's ink bounding box from its pdfjs transform/width.
 * Handles ROTATED text correctly (e.g. the CMS-1500 renderer's vertical band
 * labels, drawn via pdf-lib's `rotate: degrees(90)`): rather than assuming a
 * horizontal transform (transform[4]/[5] + width along X), this decomposes
 * the transform into an "along the baseline" unit vector (a,b) and an
 * "ascent/descent" unit vector (c,d) — both already scaled to the font size
 * by the PDF text matrix convention — and sweeps the glyph run's box through
 * both, so a 90°-rotated label gets a correctly axis-aligned enclosing box
 * instead of a box computed as if it were horizontal.
 */
function textItemBBox(item: { str: string; width: number; height: number; transform: number[] }): TextBox {
  const a = item.transform[0] ?? 0;
  const b = item.transform[1] ?? 0;
  const c = item.transform[2] ?? 0;
  const d = item.transform[3] ?? 0;
  const e = item.transform[4] ?? 0;
  const f = item.transform[5] ?? 0;

  const size = Math.hypot(a, b) || Math.hypot(c, d) || item.height || 1;
  const alongX = a / size;
  const alongY = b / size;
  const upX = c / size;
  const upY = d / size;

  const w = item.width;
  const descent = -0.22 * size; // descender allowance
  const ascent = 0.8 * size; // ascender/cap-height allowance

  const corners: Array<[number, number]> = [
    [0, descent],
    [w, descent],
    [w, ascent],
    [0, ascent],
  ].map(([along, vert]) => [e + along! * alongX + vert! * upX, f + along! * alongY + vert! * upY]);

  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { str: item.str, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Reads every non-blank text run on every page of a rendered PDF, as bounding boxes in PDF (bottom-left-origin) page coordinates. */
export async function renderedTextBoxesByPage(bytes: Uint8Array, standardFontDataUrl: string): Promise<TextBox[][]> {
  // pdfjs's getDocument({data}) transfers (detaches) `data.buffer` into its
  // fake worker via structuredClone(..., {transfer: [data.buffer]}) — a
  // second getDocument() call against the SAME Uint8Array would then throw
  // "DataCloneError: Cannot transfer object of unsupported type." because
  // the buffer is already neutered. Passing a copy keeps the caller's
  // `bytes` reusable across multiple reads (e.g. this function and
  // allPageText() in invariants.test.ts both reading the same rendered PDF).
  const doc = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const pages: TextBox[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const boxes = content.items
      .map((raw) => raw as { str: string; width: number; height: number; transform: number[] })
      .filter((item) => item.str.trim() !== '') // pdfjs also emits zero-width EOL markers between drawText() calls
      .map(textItemBBox);
    pages.push(boxes);
  }
  return pages;
}

export function containedIn(box: TextBox, region: Rect, tol: number): boolean {
  return box.x0 >= region.x - tol && box.x1 <= region.x + region.width + tol && box.y0 >= region.y - tol && box.y1 <= region.y + region.height + tol;
}

export function rectsOverlap(a: TextBox, b: TextBox, tol: number): boolean {
  return a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
}

export interface LayoutSpec {
  pageWidth: number;
  pageHeight: number;
  /**
   * Every region text is allowed to be drawn in, already in PDF
   * (bottom-left-origin) page coordinates — see test/support/regions.ts's
   * `toPdfRect` conversions. A plain array applies uniformly to every page
   * (the original, still-valid shape for every single-page-kind form). A
   * function selects a DIFFERENT region set per page — needed once a form
   * can append a page of a different kind (e.g. the CMS-1500 diagnosis
   * continuation page, Build 3.2) whose content lives in different rects
   * than a service-line page's; `pageCount` is passed too so a selector can
   * tell "last page" from "any other page" without hard-coding a page index.
   */
  regions: Rect[] | ((pageIndex: number, pageCount: number) => Rect[]);
}

/** Runs all three geometry checks against every page of `bytes`, failing (via `expect`) with a descriptive message the moment any one fails. */
export async function assertCleanLayout(bytes: Uint8Array, spec: LayoutSpec, label: string, standardFontDataUrl: string): Promise<void> {
  const pages = await renderedTextBoxesByPage(bytes, standardFontDataUrl);

  pages.forEach((boxes, pageIndex) => {
    const regionsForPage = typeof spec.regions === 'function' ? spec.regions(pageIndex, pages.length) : spec.regions;
    for (const box of boxes) {
      // 1. Page-bounds.
      expect(
        box.x0 >= -GEOMETRY_TOLERANCE &&
          box.x1 <= spec.pageWidth + GEOMETRY_TOLERANCE &&
          box.y0 >= -GEOMETRY_TOLERANCE &&
          box.y1 <= spec.pageHeight + GEOMETRY_TOLERANCE,
        `${label} page ${pageIndex + 1}: text "${box.str}" at [${box.x0.toFixed(1)},${box.y0.toFixed(1)}]-[${box.x1.toFixed(1)},${box.y1.toFixed(1)}] falls outside the ${spec.pageWidth}x${spec.pageHeight} page`,
      ).toBe(true);

      // 2. Text-vs-box: must land inside at least one known region.
      const inABox = regionsForPage.some((r) => containedIn(box, r, GEOMETRY_TOLERANCE));
      expect(
        inABox,
        `${label} page ${pageIndex + 1}: text "${box.str}" at [${box.x0.toFixed(1)},${box.y0.toFixed(1)}]-[${box.x1.toFixed(1)},${box.y1.toFixed(1)}] is outside every known field box/table/footer region`,
      ).toBe(true);
    }

    // 3. Text-vs-text: no two runs on the same page may overlap.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        expect(
          rectsOverlap(a, b, 0.3),
          `${label} page ${pageIndex + 1}: text "${a.str}" and "${b.str}" overlap ([${a.x0.toFixed(1)},${a.y0.toFixed(1)}]-[${a.x1.toFixed(1)},${a.y1.toFixed(1)}] vs [${b.x0.toFixed(1)},${b.y0.toFixed(1)}]-[${b.x1.toFixed(1)},${b.y1.toFixed(1)}])`,
        ).toBe(false);
      }
    }
  });
}
