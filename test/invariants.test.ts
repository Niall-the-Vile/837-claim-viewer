import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { renderCms1500 } from '../src/render/cms1500/renderCms1500.js';
import { renderUb04 } from '../src/render/ub04/renderUb04.js';
import { renderDental } from '../src/render/dental/renderDental.js';
import { BOX24_TABLE } from '../src/render/cms1500/layout.js';
import { GRID_TABLE as UB_GRID_TABLE } from '../src/render/ub04/layout.js';
import { GRID_TABLE as DENT_GRID_TABLE } from '../src/render/dental/layout.js';
import type { Claim, ServiceLine } from '../src/model/claim.js';
import { assertCleanLayout } from './support/geometry.js';
import type { Rect } from './support/geometry.js';
import { cms1500Regions, cms1500RegionsPerPage, ub04Regions, dentalRegions, CMS1500_PAGE, UB04_PAGE, DENTAL_PAGE } from './support/regions.js';

/**
 * The permanent, form-agnostic version of the ad-hoc geometry checks that
 * first caught the CMS-1500 checkbox overlap and the UB-04 FL39-41 VALUE
 * CODES / FL50 PAYER NAME collision (see test/renderDental.test.ts's
 * original "layout verification" describe block, which this generalizes to
 * every form via test/support/geometry.ts + test/support/regions.ts).
 *
 * Two kinds of coverage:
 *  1. Layout invariants (page-bounds / text-vs-box / text-vs-text) across
 *     ALL forms x ALL fixtures — both the synthetic JSON fixture and the
 *     synthetic 837 corpus, plus a multi-page variant of each.
 *  2. Pagination invariants: a synthesized >6-line CMS-1500 / >22-line
 *     UB-04 / >10-line dental produces the right page count with no dropped
 *     lines — verified two ways: the renderer's own drop-detection throw
 *     (see renderCms1500/renderUb04/renderDental's pagination guard) AND an
 *     independent check that every synthesized line's unique marker code
 *     is actually present somewhere in the rendered text.
 */

const here = dirname(fileURLToPath(import.meta.url));
const standardFontDataUrl = join(here, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';

const jsonSrc = new JsonClaimSource();
const x12Src = new X12ClaimSource();

function fixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', ...parts), 'utf8');
}

function loadJsonCms1500(): Claim {
  return jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
}
function loadX12Cms1500(): Claim {
  return x12Src.parse(fixture('x12', '837P-all-fields.dat'))[0]!;
}
function loadX12Ub04Minimal(): Claim {
  return x12Src.parse(fixture('x12', '837I-minimal.dat'))[0]!;
}
function loadX12Ub04AllFields(): Claim {
  return x12Src.parse(fixture('x12', '837I-all-fields.dat'))[0]!;
}
function loadX12Dental(): Claim {
  return x12Src.parse(fixture('x12', '837D-all-fields.dat'))[0]!;
}
function loadJsonCms1500ManyDiagnoses(): Claim {
  return jsonSrc.parse(fixture('1500-14-diagnoses.json'))[0]!;
}

// ---------------------------------------------------------------------------
// 1. Layout invariants — every form x every corpus fixture.
// ---------------------------------------------------------------------------

interface GeometryCase {
  label: string;
  claim: Claim;
  render: (c: Claim) => Promise<Uint8Array>;
  spec: { pageWidth: number; pageHeight: number; regions: Rect[] | ((pageIndex: number, pageCount: number) => Rect[]) };
}

function geometryCases(): GeometryCase[] {
  const cmsSpec = { pageWidth: CMS1500_PAGE.width, pageHeight: CMS1500_PAGE.height, regions: cms1500Regions() };
  const ubSpec = { pageWidth: UB04_PAGE.width, pageHeight: UB04_PAGE.height, regions: ub04Regions() };
  const dentSpec = { pageWidth: DENTAL_PAGE.width, pageHeight: DENTAL_PAGE.height, regions: dentalRegions() };
  // 1500-14-diagnoses.json has 2 service lines (1 service-line page) plus 2
  // diagnoses beyond pointer L, so renderCms1500 appends exactly one
  // continuation page — the per-page selector routes page 0 through the
  // normal CMS-1500 regions and page 1 through the continuation page's own.
  const cmsOverflowSpec = { pageWidth: CMS1500_PAGE.width, pageHeight: CMS1500_PAGE.height, regions: cms1500RegionsPerPage(1, true) };

  return [
    { label: 'cms1500 (synthetic JSON fixture)', claim: loadJsonCms1500(), render: renderCms1500, spec: cmsSpec },
    { label: 'cms1500 (837P-all-fields.dat)', claim: loadX12Cms1500(), render: renderCms1500, spec: cmsSpec },
    { label: 'cms1500 (1500-14-diagnoses.json, diagnosis-overflow continuation page)', claim: loadJsonCms1500ManyDiagnoses(), render: renderCms1500, spec: cmsOverflowSpec },
    { label: 'ub04 (837I-minimal.dat)', claim: loadX12Ub04Minimal(), render: renderUb04, spec: ubSpec },
    { label: 'ub04 (837I-all-fields.dat, 12-of-each overflow)', claim: loadX12Ub04AllFields(), render: renderUb04, spec: ubSpec },
    { label: 'dental (837D-all-fields.dat)', claim: loadX12Dental(), render: renderDental, spec: dentSpec },
  ];
}

describe('layout invariants — page-bounds, text-vs-box, text-vs-text (all forms x all fixtures)', () => {
  for (const { label, claim, render, spec } of geometryCases()) {
    it(`${label}: every drawn text run is in-bounds, inside a known box, and non-overlapping`, async () => {
      const bytes = await render(claim);
      await assertCleanLayout(bytes, spec, label, standardFontDataUrl);
    });
  }
});

// ---------------------------------------------------------------------------
// CMS-1500 diagnosis overflow (Build 3.2(a)) — the confirmed silent-
// truncation gap: DIAG_CELLS has exactly 12 cells (pointers A-L), so
// diagnoses 13+ used to vanish from the rendered PDF entirely, with no
// indicator anywhere on the form. Verified against the required
// test/fixtures/1500-14-diagnoses.json fixture (14 diagnoses) two ways: the
// dropped codes must actually appear somewhere in the rendered text (not
// just "a continuation page exists"), and the page count must reflect the
// appended continuation page.
// ---------------------------------------------------------------------------

describe('CMS-1500 diagnosis overflow — Build 3.2(a)', () => {
  it('renders exactly one extra (continuation) page beyond the normal service-line page count', async () => {
    const claim = loadJsonCms1500ManyDiagnoses();
    expect(claim.diagnoses).toHaveLength(14); // sanity-check the fixture itself carries the overflow this test exercises
    const bytes = await renderCms1500(claim);
    const loaded = await PDFDocument.load(bytes);
    // 2 service lines -> 1 service-line page, + 1 continuation page for diagnoses 13-14.
    expect(loaded.getPageCount()).toBe(2);
  });

  it('diagnoses beyond pointer L (13th and 14th) are present in the rendered text, not silently dropped', async () => {
    const claim = loadJsonCms1500ManyDiagnoses();
    const overflow = claim.diagnoses.filter((d) => d.ordinal > 12);
    expect(overflow.map((d) => d.code)).toEqual(['M25561', 'H269']); // pins the fixture's own overflow codes
    const bytes = await renderCms1500(claim);
    const text = await allPageText(bytes);
    for (const d of overflow) {
      expect(text, `overflow diagnosis ${d.ordinal} (${d.code}) is missing from the rendered CMS-1500`).toContain(d.code);
    }
    // Independent of the shared-code coincidence noted below: ordinal 13's
    // code (M25561) is unique to this fixture, so its presence alone proves
    // the continuation page actually rendered content, not just a page count.
    expect(text).toContain('DIAGNOSIS CONTINUATION');
  });

  it('a claim with 12 or fewer diagnoses renders no continuation page', async () => {
    const claim = loadJsonCms1500();
    expect(claim.diagnoses.length).toBeLessThanOrEqual(12);
    const bytes = await renderCms1500(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    const text = await allPageText(bytes);
    expect(text).not.toContain('DIAGNOSIS CONTINUATION');
  });

  it('combines correctly with multi-page service lines: totals still land on the LAST SERVICE-LINE page, not the continuation page', async () => {
    // 13 service lines -> ceil(13/6) = 3 service-line pages, + 1 continuation
    // page for the fixture's 14 diagnoses = 4 pages total. This exercises
    // the isLastServiceLinePage/pageNumber decoupling directly: totals must
    // still appear exactly once, on page 3 (the actual last service-line
    // page), and PAGE X OF Y numbering must count the continuation page.
    const claim = withLines(loadJsonCms1500ManyDiagnoses(), 13, makeCms1500Line);
    const bytes = await renderCms1500(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(4);

    const doc = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((it) => (it as { str: string }).str).join(' '));
    }
    const totalStr = formatMoneyForTest(claim.totals.totalCharge);
    const pagesWithTotal = pageTexts.filter((t) => t.includes(totalStr));
    expect(pagesWithTotal).toHaveLength(1); // drawn exactly once, not on every page and not on the continuation page
    expect(pageTexts[2]).toContain(totalStr); // 0-indexed page 2 = the 3rd page = the last service-line page
    expect(pageTexts[3]).not.toContain(totalStr); // continuation page carries no money totals
    expect(pageTexts[3]).toContain('PAGE 4 OF 4');
    expect(pageTexts[0]).toContain('PAGE 1 OF 4');
  });
});

/** Mirrors formatMoney's "$xx.xx" shape without importing the renderer-internal helper — just enough to search rendered text for the total. */
function formatMoneyForTest(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// 2. Pagination invariants — correct page count, no dropped lines.
// ---------------------------------------------------------------------------

/** A short, unique-per-index marker used as a service line's proc/CDT code so a dropped line is independently detectable in the rendered text, not just inferred from a page count. */
function lineCode(i: number): string {
  return `L${String(i).padStart(3, '0')}`;
}

function makeCms1500Line(i: number): ServiceLine {
  return {
    fromDate: '2026-05-07',
    thruDate: '2026-05-07',
    placeOfService: '11',
    procCode: lineCode(i),
    modifiers: [],
    diagPointers: ['A'],
    charge: 25 + i,
    units: '1',
    chargeId: `L${i}`,
    patientResponsibility: 0,
  };
}

function makeUb04Line(i: number): ServiceLine {
  return {
    fromDate: '2026-05-07',
    thruDate: '2026-05-07',
    placeOfService: '',
    procCode: lineCode(i),
    modifiers: [],
    diagPointers: [],
    charge: 25 + i,
    units: '1',
    chargeId: `L${i}`,
    patientResponsibility: 0,
    revenueCode: `030${i % 10}`,
    revenueDescription: `Line ${i}`,
  };
}

function makeDentalLine(i: number): ServiceLine {
  return {
    fromDate: '2026-05-07',
    thruDate: '2026-05-07',
    placeOfService: '',
    procCode: lineCode(i),
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

function withLines(claim: Claim, count: number, make: (i: number) => ServiceLine): Claim {
  const lines = Array.from({ length: count }, (_, i) => make(i));
  const totalCharge = lines.reduce((sum, l) => sum + l.charge, 0);
  return { ...claim, serviceLines: lines, totals: { ...claim.totals, totalCharge } };
}

/**
 * Flattens every non-blank text run on every page into one searchable
 * string, so "no dropped lines" can be checked directly against the
 * rendered PDF rather than only inferred from a page count.
 *
 * Copies `bytes` before handing it to pdfjs: getDocument({data}) transfers
 * (detaches) the underlying ArrayBuffer via structuredClone's transfer
 * list, so every pagination test below also calls assertCleanLayout(bytes,
 * ...) afterwards on the SAME `bytes` — without the copy, that second
 * getDocument() call fails with "DataCloneError: Cannot transfer object of
 * unsupported type." because the buffer is already neutered. This was the
 * actual root cause of the original 3 pagination-invariant failures (a test
 * bug, not a renderer bug — confirmed by reproducing the identical error
 * from `structuredClone(x, {transfer:[alreadyDetachedBuffer]})` directly).
 */
async function allPageText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(...content.items.map((it) => (it as { str: string }).str));
  }
  return parts.join(' ');
}

describe('pagination invariants — correct page count, no dropped lines', () => {
  it('cms1500: >6 service lines pages correctly (6/page) and every line survives', async () => {
    const n = 19; // ceil(19/6) = 4 pages, none of them an exact multiple
    const claim = withLines(loadJsonCms1500(), n, makeCms1500Line);
    const bytes = await renderCms1500(claim);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(Math.ceil(n / BOX24_TABLE.maxRowsPerPage));

    const text = await allPageText(bytes);
    for (let i = 0; i < n; i++) {
      expect(text, `line ${i} (code ${lineCode(i)}) is missing from the rendered CMS-1500`).toContain(lineCode(i));
    }
    await assertCleanLayout(bytes, { pageWidth: CMS1500_PAGE.width, pageHeight: CMS1500_PAGE.height, regions: cms1500Regions() }, 'cms1500 (19 lines)', standardFontDataUrl);
  });

  it('ub04: >22 service lines pages correctly (22/page, last page reserves 1 for the 0001 total row) and every line survives', async () => {
    const n = 25; // > GRID_TABLE.maxRowsPerPage (22)
    const claim = withLines(loadX12Ub04Minimal(), n, makeUb04Line);
    const bytes = await renderUb04(claim);

    const maxRows = UB_GRID_TABLE.maxRowsPerPage;
    const lastPageCapacity = maxRows - 1;
    // Mirrors renderUb04.ts's own paginateServiceLines formula (not
    // exported) — documented here rather than re-implemented as a guess.
    const expectedPages = n <= lastPageCapacity ? 1 : Math.ceil((n - lastPageCapacity) / maxRows) + 1;

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(expectedPages);

    const text = await allPageText(bytes);
    for (let i = 0; i < n; i++) {
      expect(text, `line ${i} (code ${lineCode(i)}) is missing from the rendered UB-04`).toContain(lineCode(i));
    }
    await assertCleanLayout(bytes, { pageWidth: UB04_PAGE.width, pageHeight: UB04_PAGE.height, regions: ub04Regions() }, 'ub04 (25 lines)', standardFontDataUrl);
  });

  it('dental: >10 service lines pages correctly (10/page) and every line survives', async () => {
    const n = 23; // ceil(23/10) = 3 pages
    const claim = withLines(loadX12Dental(), n, makeDentalLine);
    const bytes = await renderDental(claim);

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(Math.ceil(n / DENT_GRID_TABLE.maxRowsPerPage));

    const text = await allPageText(bytes);
    for (let i = 0; i < n; i++) {
      expect(text, `line ${i} (code ${lineCode(i)}) is missing from the rendered dental claim`).toContain(lineCode(i));
    }
    await assertCleanLayout(bytes, { pageWidth: DENTAL_PAGE.width, pageHeight: DENTAL_PAGE.height, regions: dentalRegions() }, 'dental (23 lines)', standardFontDataUrl);
  });

  it('does not paginate below each form’s per-page capacity (1 page)', async () => {
    const cms = await renderCms1500(withLines(loadJsonCms1500(), BOX24_TABLE.maxRowsPerPage, makeCms1500Line));
    expect((await PDFDocument.load(cms)).getPageCount()).toBe(1);

    const ub = await renderUb04(withLines(loadX12Ub04Minimal(), UB_GRID_TABLE.maxRowsPerPage - 1, makeUb04Line));
    expect((await PDFDocument.load(ub)).getPageCount()).toBe(1);

    const dent = await renderDental(withLines(loadX12Dental(), DENT_GRID_TABLE.maxRowsPerPage, makeDentalLine));
    expect((await PDFDocument.load(dent)).getPageCount()).toBe(1);
  });
});
