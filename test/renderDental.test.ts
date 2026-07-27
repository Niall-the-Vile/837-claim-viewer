import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
// pdfjs-dist's Node ("legacy") build — used only by the geometry-verification
// tests below to read back what was actually drawn (text positions/widths)
// so overlap/bounds can be asserted from outside the renderer, not just
// "it didn't throw".
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { renderDental, getDentalBoxLines, maxLinesForHeight, wrapWithOverflow } from '../src/render/dental/renderDental.js';
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  GRID_TABLE,
  HEADER_FIELD_BOXES,
  HEADER_INFO_BOX,
  TOTAL_FEE_BOX,
  PROVIDER_FIELD_BOXES,
  FOOTER_Y,
  toPdfRect,
} from '../src/render/dental/layout.js';
import type { Rect } from '../src/render/dental/layout.js';
import type { Claim, ServiceLine } from '../src/model/claim.js';

const here = dirname(fileURLToPath(import.meta.url));
const dental837DAllFields = readFileSync(join(here, 'fixtures', 'x12', '837D-all-fields.dat'), 'utf8');
const src = new X12ClaimSource();

function loadFixtureClaim(): Claim {
  const claims = src.parse(dental837DAllFields);
  expect(claims.length).toBeGreaterThanOrEqual(1);
  return claims[0]!;
}

function bytesToText(bytes: Uint8Array, length: number): string {
  return Buffer.from(bytes.slice(0, length)).toString('latin1');
}

/** Builds a synthetic dental service line (all synthetic test data — no PHI). */
function makeLine(i: number): ServiceLine {
  return {
    fromDate: '2026-05-07',
    thruDate: '2026-05-07',
    placeOfService: '',
    procCode: `D${1100 + (i % 900)}`,
    modifiers: [],
    diagPointers: [],
    charge: 25 + i,
    units: '1',
    chargeId: `L${i}`,
    patientResponsibility: 0,
    toothNumbers: String(1 + (i % 32)),
    toothSurfaces: 'M',
    oralCavityArea: '',
  };
}

function withServiceLines(claim: Claim, count: number): Claim {
  const lines = Array.from({ length: count }, (_, i) => makeLine(i));
  const totalCharge = lines.reduce((sum, l) => sum + l.charge, 0);
  return {
    ...claim,
    serviceLines: lines,
    totals: { ...claim.totals, totalCharge },
  };
}

describe('renderDental — basic rendering', () => {
  it('renders a parsed 837D claim to a valid PDF of the right page size', async () => {
    const claim = loadFixtureClaim();
    const bytes = await renderDental(claim);

    expect(bytesToText(bytes, 5)).toBe('%PDF-');

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
    const page = loaded.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });

  it('renders a dental claim with no dental block and no service lines without throwing', async () => {
    const base = loadFixtureClaim();
    const { dental: _dental, ...rest } = base;
    const claim: Claim = { ...rest, diagnoses: [], serviceLines: [] };
    const bytes = await renderDental(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});

describe('renderDental — pagination (10-row grid)', () => {
  const maxRows = GRID_TABLE.maxRowsPerPage; // 10

  it(`fits on 1 page at exactly the grid capacity (${maxRows} lines)`, async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, maxRows);
    const bytes = await renderDental(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('spills to a 2nd page one line past the grid capacity (>10 lines)', async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, maxRows + 1);
    const bytes = await renderDental(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
    for (let i = 0; i < loaded.getPageCount(); i++) {
      const { width, height } = loaded.getPage(i).getSize();
      expect(width).toBe(612);
      expect(height).toBe(792);
    }
  });

  it('drops no service lines across many pages and carries the total fee to the last page', async () => {
    const base = loadFixtureClaim();
    const lineCount = maxRows * 3 + 4; // forces several full pages plus a partial last page
    const claim = withServiceLines(base, lineCount);
    // renderDental itself throws if pagination would drop a line; reaching a resolved promise is proof none were dropped.
    const bytes = await renderDental(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(4);
  });
});

describe('renderDental — determinism', () => {
  it('renders byte-identical output for the same claim twice', async () => {
    const claim = loadFixtureClaim();
    const a = await renderDental(claim);
    const b = await renderDental(claim);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('renders byte-identical output across a fresh claim parse (not just object identity)', async () => {
    const claimA = loadFixtureClaim();
    const claimB = loadFixtureClaim();
    const a = await renderDental(claimA);
    const b = await renderDental(claimB);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('renderDental — safe text handling', () => {
  it('renders a patient name with a character outside WinAnsi without throwing', async () => {
    const base = loadFixtureClaim();
    const claim: Claim = {
      ...base,
      patient: { ...base.patient, name: { last: 'MUÑOZ', first: 'JOŠE', middle: '' } },
    };
    const bytes = await renderDental(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
  });
});

describe('renderDental — box-height overflow clamping', () => {
  it('wrapWithOverflow never returns more lines than maxLines, and flags the drop visibly when tokens don\'t fit', () => {
    const tokens = Array.from({ length: 12 }, (_, i) => `T${i}`);
    for (const maxLines of [1, 2]) {
      const lines = wrapWithOverflow(tokens, 4, maxLines);
      expect(lines.length).toBeLessThanOrEqual(maxLines);
      expect(lines.join(' ')).toMatch(/\+\d+ more/);
    }
    const exact = wrapWithOverflow(tokens, 4, 3);
    expect(exact.length).toBeLessThanOrEqual(3);
    expect(exact.join(' ')).not.toMatch(/more/);
  });

  it('getDentalBoxLines never exceeds a header box\'s own line capacity even with a synthetically large missing-teeth / diagnosis list', () => {
    const base = loadFixtureClaim();
    const manyMissingTeeth = Array.from({ length: 32 }, (_, i) => String(i + 1));
    const manyDiagnoses = Array.from({ length: 20 }, (_, i) => ({
      pointer: i < 12 ? String.fromCharCode(65 + i) : '',
      ordinal: i + 1,
      code: `Z${100 + i}`,
      poa: '',
    }));
    const claim: Claim = {
      ...base,
      diagnoses: manyDiagnoses,
      dental: base.dental
        ? { ...base.dental, missingTeeth: manyMissingTeeth }
        : {
            transactionType: '',
            predeterminationNumber: '',
            placeOfTreatment: '',
            missingTeeth: manyMissingTeeth,
            orthodontics: null,
            treatingDentist: { last: '', first: '', middle: '' },
          },
    };

    const CLAMPED_KEYS = ['missingTeeth', 'diagnoses'];
    for (const box of HEADER_FIELD_BOXES.filter((b) => CLAMPED_KEYS.includes(b.key))) {
      const lines = getDentalBoxLines(claim, box);
      const capacity = maxLinesForHeight(box.rect.height);
      expect(lines.length, `box "${box.key}" (height ${box.rect.height}) drew ${lines.length} lines, capacity is ${capacity}`).toBeLessThanOrEqual(capacity);
      expect(lines.join(' '), `box "${box.key}" should show a "+N more" indicator`).toMatch(/\+\d+ more/);
    }

    // And the full render must not throw despite the overflow.
    return renderDental(claim).then((bytes) => {
      expect(bytesToText(bytes, 5)).toBe('%PDF-');
    });
  });

  it('does not falsely flag overflow on the missing-teeth box for the small real fixture', () => {
    const claim = loadFixtureClaim();
    const box = HEADER_FIELD_BOXES.find((b) => b.key === 'missingTeeth')!;
    const capacity = maxLinesForHeight(box.rect.height);
    const lines = getDentalBoxLines(claim, box);
    expect(lines.length).toBeLessThanOrEqual(capacity);
    expect(lines.join(' ')).not.toMatch(/\+\d+ more/);
  });
});

// ---------------------------------------------------------------------------
// Layout verification — reads the rendered PDF back with pdfjs-dist (rather
// than trusting the drawing code's own arithmetic) and checks three
// independent geometric properties per page:
//   1. page-bounds  — every drawn text run stays within the 612x792 page.
//   2. text-vs-box  — every drawn text run falls inside one of the form's
//      known field-box / grid / footer regions (nothing stray in a gap).
//   3. text-vs-text — no two drawn text runs' bounding boxes overlap.
// ---------------------------------------------------------------------------

interface TextBox {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** pdfjs reports the standard-14 fonts' *substituted* metrics (no embedded font program, hence the "standardFontDataUrl" warning it logs), which run a percent or two wider than pdf-lib's real widths for the same text/size. A small relative+absolute slack absorbs that measurement gap without hiding a genuine overflow (which is many points, not fractions of one). */
const GEOMETRY_TOLERANCE = 2.5;

/** Approximates a text run's ink bounding box from its pdfjs transform/width, using typographic ascent/descent fractions rather than the full em box (which would make adjacent same-box lines look like they overlap when they don't). */
function textItemBBox(item: { str: string; width: number; height: number; transform: number[] }): TextBox {
  const size = Math.abs(item.transform[3] ?? 0) || Math.abs(item.transform[0] ?? 0) || item.height || 0;
  const x = item.transform[4] ?? 0;
  const baseline = item.transform[5] ?? 0;
  return {
    str: item.str,
    x0: x,
    x1: x + item.width,
    y0: baseline - size * 0.22, // descender allowance
    y1: baseline + size * 0.8, // ascender/cap-height allowance
  };
}

// Points pdfjs at its own bundled standard-font metrics so it can measure
// the base-14 fonts (Helvetica/Courier) without a network fetch or the
// "standardFontDataUrl" warning — doesn't change what's measured, just quiets it.
const standardFontDataUrl = join(here, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';

async function renderedTextBoxesByPage(bytes: Uint8Array): Promise<TextBox[][]> {
  const doc = await getDocument({ data: bytes, standardFontDataUrl }).promise;
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

/** All regions the renderer is allowed to put text in, in PDF (bottom-left-origin) coordinates. Anything drawn outside every one of these is stray. */
function allowedRegions(): Rect[] {
  const topOrigin: Rect[] = [
    // Centered title/subtitle band, above the header-info box.
    { x: 0, y: 0, width: PAGE_WIDTH, height: HEADER_INFO_BOX.y },
    HEADER_INFO_BOX,
    ...HEADER_FIELD_BOXES.map((b) => b.rect),
    { x: GRID_TABLE.x, y: GRID_TABLE.y, width: GRID_TABLE.width, height: GRID_TABLE.headerHeight + GRID_TABLE.rowHeight * GRID_TABLE.maxRowsPerPage },
    TOTAL_FEE_BOX.rect,
    ...PROVIDER_FIELD_BOXES.map((b) => b.rect),
    // Footer band, from just above the footer baseline to the bottom edge.
    { x: 0, y: FOOTER_Y - 8, width: PAGE_WIDTH, height: PAGE_HEIGHT - (FOOTER_Y - 8) },
  ];
  return topOrigin.map((r) => toPdfRect(r, PAGE_HEIGHT));
}

function containedIn(box: TextBox, region: Rect, tol: number): boolean {
  return (
    box.x0 >= region.x - tol &&
    box.x1 <= region.x + region.width + tol &&
    box.y0 >= region.y - tol &&
    box.y1 <= region.y + region.height + tol
  );
}

function rectsOverlap(a: TextBox, b: TextBox, tol: number): boolean {
  return a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
}

/** Runs all three geometry checks against every page of `bytes`, throwing (via `expect`) a descriptive failure the moment any one fails. */
async function assertCleanLayout(bytes: Uint8Array, label: string): Promise<void> {
  const pages = await renderedTextBoxesByPage(bytes);
  const regions = allowedRegions();

  pages.forEach((boxes, pageIndex) => {
    for (const box of boxes) {
      // 1. Page-bounds.
      expect(
        box.x0 >= -GEOMETRY_TOLERANCE && box.x1 <= PAGE_WIDTH + GEOMETRY_TOLERANCE && box.y0 >= -GEOMETRY_TOLERANCE && box.y1 <= PAGE_HEIGHT + GEOMETRY_TOLERANCE,
        `${label} page ${pageIndex + 1}: text "${box.str}" at [${box.x0.toFixed(1)},${box.y0.toFixed(1)}]-[${box.x1.toFixed(1)},${box.y1.toFixed(1)}] falls outside the ${PAGE_WIDTH}x${PAGE_HEIGHT} page`,
      ).toBe(true);

      // 2. Text-vs-box: must land inside at least one known region.
      const inABox = regions.some((r) => containedIn(box, r, GEOMETRY_TOLERANCE));
      expect(inABox, `${label} page ${pageIndex + 1}: text "${box.str}" at [${box.x0.toFixed(1)},${box.y0.toFixed(1)}]-[${box.x1.toFixed(1)},${box.y1.toFixed(1)}] is outside every known field box/table/footer region`).toBe(
        true,
      );
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

describe('renderDental — layout verification (page-bounds, text-vs-box, text-vs-text)', () => {
  it('keeps every drawn text run in-bounds, inside a known box, and non-overlapping for the real 837D fixture', async () => {
    const claim = loadFixtureClaim();
    const bytes = await renderDental(claim);
    await assertCleanLayout(bytes, '837D fixture');
  });

  it('keeps every drawn text run in-bounds, inside a known box, and non-overlapping across a multi-page (>10-line) claim', async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, GRID_TABLE.maxRowsPerPage + 7); // forces a 2nd page
    const bytes = await renderDental(claim);
    await assertCleanLayout(bytes, 'multi-page synthetic claim');
  });

  it('keeps every drawn text run in-bounds, inside a known box, and non-overlapping when header lists overflow ("+N more")', async () => {
    const base = loadFixtureClaim();
    const manyMissingTeeth = Array.from({ length: 32 }, (_, i) => String(i + 1));
    const manyDiagnoses = Array.from({ length: 20 }, (_, i) => ({
      pointer: i < 12 ? String.fromCharCode(65 + i) : '',
      ordinal: i + 1,
      code: `Z${100 + i}`,
      poa: '',
    }));
    const claim: Claim = {
      ...base,
      diagnoses: manyDiagnoses,
      dental: base.dental
        ? { ...base.dental, missingTeeth: manyMissingTeeth }
        : {
            transactionType: '',
            predeterminationNumber: '',
            placeOfTreatment: '',
            missingTeeth: manyMissingTeeth,
            orthodontics: null,
            treatingDentist: { last: '', first: '', middle: '' },
          },
    };
    const bytes = await renderDental(claim);
    await assertCleanLayout(bytes, 'overflow-list claim');
  });
});
