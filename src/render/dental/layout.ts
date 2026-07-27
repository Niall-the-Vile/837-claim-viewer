/**
 * Self-authored ADA 2024 Dental Claim Form coordinate map.
 *
 * Like the CMS-1500 layout (src/render/cms1500/layout.ts) and the UB-04
 * layout (src/render/ub04/layout.ts), this is OUR OWN clean, readable,
 * black-and-white facsimile grid — it does NOT reproduce the official ADA
 * form's geometry, artwork, or copyrighted layout pixel-for-pixel. It only
 * borrows the ADA's public box *numbers* (1, 2, 3, 12-17, 18-23, 24-31,
 * 32, 33, 34/34a, 48-52, 53-58) as reference labels, the way a claim
 * scrubber or clearinghouse UI would.
 *
 * Structure follows the approved design (docs/design/ClaimViewer_v2.dc.html,
 * the `isDental` block) and the CMS-1500 restyle's conventions: a centered
 * title block, a full-width header-info box with real transaction-type
 * checkboxes, a subscriber/payer row, a patient/diagnoses row, a full-width
 * missing-teeth row (rendered as a plain text list — see the renderer's
 * header comment on why this deliberately does NOT reproduce the design's
 * graphical tooth chart), the box-24-31 Record-of-Services grid with a
 * shaded header + shaded total-fee bar, and a billing/treating dentist row.
 * A few of the design's boxes (4-11 other coverage, 35 remarks, 36-38
 * authorizations, 39-47 ancillary/treatment detail) have no home in the
 * normalized Claim model and are intentionally omitted rather than drawn
 * with permanently-dashed placeholders — see the renderer's file header.
 *
 * Coordinates are TOP-LEFT origin (see cms1500/layout.ts for the
 * rationale); `toPdfRect` flips to pdf-lib's bottom-left origin at draw
 * time so nothing outside this module needs to think about the flip.
 */

export const PAGE_WIDTH = 612; // US Letter, points
export const PAGE_HEIGHT = 792;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Converts a top-left-origin rect to pdf-lib's bottom-left-origin rect. */
export function toPdfRect(rect: Rect, pageHeight: number = PAGE_HEIGHT): Rect {
  return { x: rect.x, y: pageHeight - rect.y - rect.height, width: rect.width, height: rect.height };
}

/** A single labeled, bordered field box on the form. `key` identifies the Claim-derived value the renderer draws inside it. */
export interface FieldBox {
  key: string;
  /** ADA box number(s), e.g. "1 / 2 / 38", "12-17". '' for boxes with no official number. */
  number: string;
  label: string;
  rect: Rect;
  align?: 'left' | 'right';
}

// ---------------------------------------------------------------------------
// Layout constants — tune these and the whole page reflows.
// ---------------------------------------------------------------------------

const MARGIN = 24;
const ROW_GAP = 3;
const FULL_W = PAGE_WIDTH - 2 * MARGIN; // 564
const COL_GAP = 12;
const COL_W = (FULL_W - COL_GAP) / 2; // 276
const LEFT_X = MARGIN;
const RIGHT_X = MARGIN + COL_W + COL_GAP;

// --- Centered title block (design: "ADA DENTAL CLAIM FORM" + facsimile subtitle) ---
export const TITLE_TOP_Y = 20; // baseline (top-origin) of the bold title line
export const SUBTITLE_TOP_Y = TITLE_TOP_Y + 11; // baseline of the small gray subtitle line beneath it

// A small cursor-based builder so row Y positions are computed, not
// hand-copied — keeps the layout easy to re-tune without arithmetic drift.
let cursor = SUBTITLE_TOP_Y + 14;
function takeRow(height: number): number {
  const top = cursor;
  cursor += height + ROW_GAP;
  return top;
}

// --- Row 0: header info — transaction type checkboxes / predetermination # / place of treatment (1 / 2 / 38), full width ---
const HEADER_INFO_H = 34;
export const HEADER_INFO_BOX: Rect = { x: LEFT_X, y: takeRow(HEADER_INFO_H), width: FULL_W, height: HEADER_INFO_H };

// --- Row A: policyholder/subscriber (12-17) | dental benefit plan/payer (3) — mirrors the design's pairing ---
const ROW_A_H = 62;
const rowA = takeRow(ROW_A_H);

// --- Row B: patient (18-23) | diagnosis codes (34/34a) ---
const ROW_B_H = 52;
const rowB = takeRow(ROW_B_H);

// --- Row C: missing teeth (33), full width — a plain text list, not a graphical odontogram (ADA copyright) ---
const ROW_C_H = 32;
const rowC = takeRow(ROW_C_H);

/** Boxes redrawn on every page (everything except the header-info box, the Record-of-Services grid, and the total-fee bar). */
export const HEADER_FIELD_BOXES: FieldBox[] = [
  { key: 'subscriber', number: '12-17', label: 'POLICYHOLDER/SUBSCRIBER NAME / ADDRESS / ID / GROUP / EMPLOYER', rect: { x: LEFT_X, y: rowA, width: COL_W, height: ROW_A_H } },
  { key: 'payer', number: '3', label: 'DENTAL BENEFIT PLAN / PAYER NAME / ID / ADDRESS', rect: { x: RIGHT_X, y: rowA, width: COL_W, height: ROW_A_H } },

  { key: 'patient', number: '18-23', label: 'PATIENT NAME / RELATIONSHIP / ADDRESS / DOB-SEX / ID', rect: { x: LEFT_X, y: rowB, width: COL_W, height: ROW_B_H } },
  { key: 'diagnoses', number: '34 / 34a', label: 'DIAGNOSIS CODES', rect: { x: RIGHT_X, y: rowB, width: COL_W, height: ROW_B_H } },

  { key: 'missingTeeth', number: '33', label: 'MISSING TEETH INFORMATION', rect: { x: LEFT_X, y: rowC, width: FULL_W, height: ROW_C_H } },
];

// ---------------------------------------------------------------------------
// 24-31 — Record of Services grid.
// ---------------------------------------------------------------------------

const GRID_HEADER_H = 16;
export const GRID_ROW_H = 18;
export const GRID_MAX_ROWS = 10;
const gridTop = takeRow(GRID_HEADER_H + GRID_ROW_H * GRID_MAX_ROWS);
const gridBottom = gridTop + GRID_HEADER_H + GRID_ROW_H * GRID_MAX_ROWS;

export interface GridColumn {
  key: 'date' | 'area' | 'system' | 'toothNumbers' | 'surface' | 'cdt' | 'diagPtr' | 'qty' | 'description' | 'fee';
  header: string;
  width: number;
  align?: 'left' | 'right';
}

export const GRID_COLUMNS: GridColumn[] = [
  { key: 'date', header: '24 DATE', width: 56 },
  { key: 'area', header: '25 AREA', width: 40 },
  { key: 'system', header: '26 SYSTEM', width: 40 },
  { key: 'toothNumbers', header: '27 TOOTH #', width: 50 },
  { key: 'surface', header: '28 SURF.', width: 40 },
  { key: 'cdt', header: '29 PROCEDURE CODE', width: 56 },
  { key: 'diagPtr', header: '29A DX PTR', width: 40 },
  { key: 'qty', header: '29B QTY', width: 32, align: 'right' },
  { key: 'description', header: '30 DESCRIPTION', width: 130 },
  { key: 'fee', header: '31 FEE', width: 80, align: 'right' },
];

export const GRID_TABLE = {
  x: LEFT_X,
  y: gridTop,
  width: FULL_W,
  headerHeight: GRID_HEADER_H,
  rowHeight: GRID_ROW_H,
  maxRowsPerPage: GRID_MAX_ROWS,
};

/** Left X of each grid column, in table order. */
export const GRID_COLUMN_X: number[] = (() => {
  const xs: number[] = [];
  let x = GRID_TABLE.x;
  for (const col of GRID_COLUMNS) {
    xs.push(x);
    x += col.width;
  }
  return xs;
})();

// --- Total fee (32) — last-page-only, full width, right-aligned, shaded
// like the design's totals bar; abuts the grid's own bottom border rather
// than floating below it, so it reads as the grid's closing row. ---
const TOTAL_FEE_H = 20;
export const TOTAL_FEE_BOX: FieldBox = {
  key: 'totalFee',
  number: '32',
  label: 'TOTAL FEE',
  rect: { x: LEFT_X, y: gridBottom, width: FULL_W, height: TOTAL_FEE_H },
  align: 'right',
};
cursor = gridBottom + TOTAL_FEE_H + ROW_GAP;

// --- Billing dentist (48-52) | Treating dentist (53-58) ---
const PROVIDERS_H = 50;
const providersTop = takeRow(PROVIDERS_H);
export const PROVIDER_FIELD_BOXES: FieldBox[] = [
  { key: 'billingDentist', number: '48-52', label: 'BILLING DENTIST NAME / ADDRESS / NPI / TIN', rect: { x: LEFT_X, y: providersTop, width: COL_W, height: PROVIDERS_H } },
  { key: 'treatingDentist', number: '53-58', label: 'TREATING DENTIST NAME / NPI / SPECIALTY', rect: { x: RIGHT_X, y: providersTop, width: COL_W, height: PROVIDERS_H } },
];

export const CONTENT_BOTTOM = cursor;

// --- Footer ------------------------------------------------------------------
export const FOOTER_Y = PAGE_HEIGHT - 20;
