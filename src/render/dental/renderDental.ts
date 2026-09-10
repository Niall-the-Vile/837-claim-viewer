import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { Claim, Address, Name, ServiceLine, Diagnosis } from '../../model/claim.js';
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  TITLE_TOP_Y,
  SUBTITLE_TOP_Y,
  HEADER_INFO_BOX,
  HEADER_FIELD_BOXES,
  GRID_TABLE,
  GRID_COLUMNS,
  GRID_COLUMN_X,
  TOTAL_FEE_BOX,
  PROVIDER_FIELD_BOXES,
  FOOTER_Y,
  toPdfRect,
} from './layout.js';
import type { FieldBox, Rect, GridColumn } from './layout.js';
import { safeText, orDash, fitText, formatMoney, rightAlignX, composeName, composeAddressLine, EM_DASH, embedUnicodeFonts, drawProvenanceFooterLines } from '../text.js';
import type { RenderProvenance } from '../provenance.js';

/**
 * Renders a normalized Claim as an ADA 2024 Dental Claim Form facsimile PDF.
 *
 * Same conventions as the CMS-1500 / UB-04 renderers: self-authored
 * black-and-white facsimile grid (NOT a reproduction of the ADA's own
 * copyrighted artwork/layout — only its public box *numbers* are borrowed
 * as reference labels), the bundled Unicode TTFs (falling back to
 * StandardFonts) routed through safeText(), fixed metadata/creation date
 * for byte-reproducible output, and "—" for any missing value. See text.ts
 * for the embed/fallback details. Structure follows the approved design
 * (docs/design/ClaimViewer_v2.dc.html, the `isDental` block) and the
 * CMS-1500 restyle's conventions — see layout.ts for the box map and the
 * design-mapping notes on each section.
 *
 * Two deliberate departures from the design mock:
 *  - Box 30 (CDT procedure description) is intentionally always left blank
 *    — this viewer ships no CDT description dictionary, and the CDT code
 *    set/descriptions are ADA-licensed content.
 *  - Box 33 (missing teeth) is drawn as a plain comma/space-separated text
 *    list of tooth numbers, never the design's graphical 1-32 tooth chart —
 *    a rendered odontogram would be reproducing the ADA form's own
 *    copyrighted artwork, not just borrowing its box numbers as labels.
 *
 * A handful of the design's other boxes (4-11 other coverage, 35 remarks,
 * 36-38 authorizations, 39-47 ancillary claim/treatment detail) have no
 * corresponding field anywhere in the normalized Claim model; rather than
 * draw permanently-dashed placeholder boxes for data this viewer can never
 * populate, they're omitted from this facsimile entirely.
 *
 * TODO: embed a Unicode TTF via @pdf-lib/fontkit — see the same TODO on the
 * CMS-1500 renderer; this one has the identical WinAnsi-only limitation.
 */

const PRODUCER = 'claim-viewer/dental-renderer';
const CREATOR = 'claim-viewer';
/** Fixed epoch date so the same claim always produces byte-identical PDFs. */
const FIXED_DATE = new Date(0);

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.35, 0.35, 0.35);
/** Grid column-header shade, matching the CMS-1500 restyle's box-24 header (design: #e3e3e3). */
const SHADE_HEADER = rgb(0.89, 0.89, 0.89);
/** Total-fee bar shade, matching the design's totals row (design: #f0f0f0). */
const SHADE_TOTAL = rgb(0.94, 0.94, 0.94);

const BORDER_WIDTH = 0.75;
const LABEL_SIZE = 5.5;
const LABEL_PAD_TOP = 3;
const LABEL_PAD_X = 3;
const VALUE_TOP_OFFSET = 13; // distance from box top to the first value line's baseline area
const VALUE_LINE_GAP = 9.5; // baseline-to-baseline spacing for multi-line values
const VALUE_MAX_SIZE = 7.5;
const VALUE_MIN_SIZE = 6;

// Checkbox row (transaction type) needs clearance BELOW the header-info
// box's own number+label line, mirroring the CMS-1500 restyle's box-1
// checkbox-row treatment.
const CHECKBOX_ROW_TOP_OFFSET = 16;
const CHECKBOX_OPTION_MAX_SIZE = 6;
const CHECKBOX_OPTION_MIN_SIZE = 4.5;
const CHECKBOX_GLYPH_SIZE = 5.5;

/** A small, unobtrusive identity mark in the footer only — the form body itself stays print-true black-on-white (per UI_REQUIREMENTS_v2 §5). */
const FOOTER_MARK = 'Anabaptist Brotherhood';

interface Fonts {
  label: PDFFont; // DejaVu Sans (falls back to Helvetica)
  titleBold: PDFFont; // DejaVu Sans Bold, title only (falls back to Helvetica-Bold)
  value: PDFFont; // DejaVu Sans Mono (falls back to Courier)
}

export async function renderDental(claim: Claim, provenance?: RenderProvenance): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer(PRODUCER);
  doc.setCreator(CREATOR);
  doc.setTitle(`ADA 2024 Dental Claim - ${claim.claimId}`);
  doc.setSubject('ADA 2024 dental claim facsimile');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const unicodeFonts = await embedUnicodeFonts(doc);
  const label = unicodeFonts?.sans ?? (await doc.embedFont(StandardFonts.Helvetica));
  const titleBold = unicodeFonts?.sansBold ?? (await doc.embedFont(StandardFonts.HelveticaBold));
  const value = unicodeFonts?.mono ?? (await doc.embedFont(StandardFonts.Courier));
  const fonts: Fonts = { label, titleBold, value };

  const pages = paginateServiceLines(claim.serviceLines);
  const drawnLineCount = pages.reduce((sum, p) => sum + p.length, 0);
  if (drawnLineCount !== claim.serviceLines.length) {
    throw new Error(`Dental pagination would drop service lines: paginated ${drawnLineCount} of ${claim.serviceLines.length}.`);
  }

  const totalPages = pages.length;
  pages.forEach((lines, pageIndex) => {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPage(page, fonts, claim, lines, pageIndex, totalPages, provenance);
  });

  return doc.save();
}

// ---------------------------------------------------------------------------
// Pagination — the Record-of-Services grid is a fixed 10-row-per-page slot
// count (GRID_MAX_ROWS); unlike the UB-04's revenue grid there's no summary
// row competing for a slot, so every page (including the last) has the full
// 10-row capacity. Never drops a line — see the throw in renderDental above.
// ---------------------------------------------------------------------------

function paginateServiceLines(lines: ServiceLine[]): ServiceLine[][] {
  const perPage = GRID_TABLE.maxRowsPerPage;
  if (lines.length === 0) return [[]];
  const pages: ServiceLine[][] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Page drawing
// ---------------------------------------------------------------------------

function drawPage(page: PDFPage, fonts: Fonts, claim: Claim, lines: ServiceLine[], pageIndex: number, totalPages: number, provenance: RenderProvenance | undefined): void {
  const isLastPage = pageIndex === totalPages - 1;

  drawTitle(page, fonts);
  drawHeaderInfoBox(page, fonts, claim);

  // The header boxes (subscriber/payer/patient/diagnoses/missing-teeth) repeat on every page.
  for (const box of HEADER_FIELD_BOXES) {
    drawFieldBox(page, fonts, box, getDentalBoxLines(claim, box));
  }

  drawGridTable(page, fonts, lines);

  // Total fee (32) is carried to the last page only, per the pagination spec.
  if (isLastPage) {
    drawTotalFee(page, fonts, claim);
  }

  // Billing dentist (48-52) / treating dentist (53-58) repeat on every page.
  for (const box of PROVIDER_FIELD_BOXES) {
    drawFieldBox(page, fonts, box, getDentalBoxLines(claim, box));
  }

  drawFooter(page, fonts, claim, lines.length, claim.serviceLines.length, pageIndex, totalPages, provenance);
}

/** Centered "ADA DENTAL CLAIM FORM" title + a small gray facsimile subtitle (design: the isDental block's centered header). */
function drawTitle(page: PDFPage, fonts: Fonts): void {
  const title = 'ADA DENTAL CLAIM FORM';
  const titleSize = 11.5;
  const titleWidth = fonts.titleBold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: PAGE_WIDTH / 2 - titleWidth / 2,
    y: PAGE_HEIGHT - TITLE_TOP_Y,
    size: titleSize,
    font: fonts.titleBold,
    color: BLACK,
  });

  const subtitle = 'ADA 2024 FACSIMILE  ·  UNVERIFIED — NOT AN OFFICIAL ADA FORM';
  const subtitleSize = 6;
  const subtitleWidth = fonts.label.widthOfTextAtSize(subtitle, subtitleSize);
  page.drawText(subtitle, {
    x: PAGE_WIDTH / 2 - subtitleWidth / 2,
    y: PAGE_HEIGHT - SUBTITLE_TOP_Y,
    size: subtitleSize,
    font: fonts.label,
    color: GRAY,
  });
}

/**
 * Footer: brand mark (left), claim id + line count + page stamp (center),
 * disclaimer (right) — mirrors the CMS-1500 restyle's three-column footer.
 * `provenance` (Build 3.3) is optional and additive only — see
 * renderCms1500.ts's drawFooter for the full rationale.
 */
function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  claim: Claim,
  drawnOnPage: number,
  totalLines: number,
  pageIndex: number,
  totalPages: number,
  provenance?: RenderProvenance,
): void {
  const y = PAGE_HEIGHT - FOOTER_Y;
  const size = 5.5;

  const left = safeText(fonts.label, `ADA 2024 Dental Claim Form (Facsimile)  ${EM_DASH}  ${FOOTER_MARK}`);
  page.drawText(left, { x: 24, y, size, font: fonts.label, color: GRAY });

  const claimId = safeText(fonts.label, orDash(claim.claimId));
  const center = `CLAIM ${claimId}  ·  Service lines: ${drawnOnPage} of ${totalLines}  ·  PAGE ${pageIndex + 1} OF ${totalPages}`;
  const centerWidth = fonts.label.widthOfTextAtSize(center, size);
  page.drawText(center, { x: PAGE_WIDTH / 2 - centerWidth / 2, y, size, font: fonts.label, color: GRAY });

  const right = 'UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM';
  const rightX = rightAlignX(fonts.label, right, size, PAGE_WIDTH - 24, 0);
  page.drawText(right, { x: rightX, y, size, font: fonts.label, color: GRAY });

  if (provenance) {
    drawProvenanceFooterLines(page, fonts.label, provenance, 24, y);
  }
}

/** Draws a bordered box: number + label at top, then one or more value lines. Never draws past the box's own bottom border. */
function drawFieldBox(page: PDFPage, fonts: Fonts, box: FieldBox, lines: string[]): void {
  drawFrame(page, box.rect);

  const labelText = safeText(fonts.label, `${box.number ? box.number + ' ' : ''}${box.label}`.trim());
  const labelFit = fitText(fonts.label, labelText, box.rect.width - 2 * LABEL_PAD_X, { maxSize: LABEL_SIZE, minSize: 4 });
  const labelBaselineTopY = box.rect.y + LABEL_PAD_TOP + LABEL_SIZE;
  page.drawText(labelFit.text, {
    x: box.rect.x + LABEL_PAD_X,
    y: PAGE_HEIGHT - labelBaselineTopY,
    size: labelFit.size,
    font: fonts.label,
    color: GRAY,
  });

  const maxWidth = box.rect.width - 2 * LABEL_PAD_X;
  lines.forEach((rawLine, i) => {
    const line = safeText(fonts.value, rawLine);
    const fit = fitText(fonts.value, line, maxWidth, { maxSize: VALUE_MAX_SIZE, minSize: VALUE_MIN_SIZE });
    const baselineTopY = box.rect.y + VALUE_TOP_OFFSET + i * VALUE_LINE_GAP + fit.size;
    if (baselineTopY > box.rect.y + box.rect.height - 1) return; // overflow guard: never draw past the box's own bottom border
    const x =
      box.align === 'right'
        ? rightAlignX(fonts.value, fit.text, fit.size, box.rect.x + box.rect.width, LABEL_PAD_X)
        : box.rect.x + LABEL_PAD_X;
    page.drawText(fit.text, { x, y: PAGE_HEIGHT - baselineTopY, size: fit.size, font: fonts.value, color: BLACK });
  });
}

function drawFrame(page: PDFPage, rect: Rect): void {
  const pdfRect = toPdfRect(rect, PAGE_HEIGHT);
  page.drawRectangle({
    x: pdfRect.x,
    y: pdfRect.y,
    width: pdfRect.width,
    height: pdfRect.height,
    borderColor: BLACK,
    borderWidth: BORDER_WIDTH,
  });
}

// ---------------------------------------------------------------------------
// Header info (1 / 2 / 38) — transaction-type checkboxes + predetermination
// # + place of treatment, full width. Mirrors the CMS-1500 restyle's box-1
// checkbox-row treatment.
// ---------------------------------------------------------------------------

interface CheckOption {
  text: string;
  checked: boolean;
}

/**
 * Which of the ADA box-1 transaction-type checkboxes should be marked, from
 * the free-form `Dental.transactionType` string. The 837D corpus this
 * project reads has no segment/qualifier this task's IG maps to that field
 * (see x12ClaimSource.ts's dental-transaction-type-unknown warning), so in
 * practice this is usually '' and every option is drawn unchecked
 * (structural only) — same convention as the CMS-1500 restyle's box-1
 * insurance-type row. A populated value (e.g. from a future JSON source)
 * still resolves to the right box via a loose keyword match.
 */
function transactionTypeChecks(type: string): { statement: boolean; predetermination: boolean; epsdt: boolean } {
  const t = type.toLowerCase();
  if (t === '') return { statement: false, predetermination: false, epsdt: false };
  if (t.includes('predetermin') || t.includes('preauthor')) return { statement: false, predetermination: true, epsdt: false };
  if (t.includes('epsdt')) return { statement: false, predetermination: false, epsdt: true };
  return { statement: true, predetermination: false, epsdt: false };
}

function drawHeaderInfoBox(page: PDFPage, fonts: Fonts, claim: Claim): void {
  const box = HEADER_INFO_BOX;
  drawFrame(page, box);

  const labelText = safeText(fonts.label, '1 / 2 / 38  TRANSACTION TYPE / PREDETERMINATION # / PLACE OF TREATMENT');
  const labelFit = fitText(fonts.label, labelText, box.width - 2 * LABEL_PAD_X, { maxSize: LABEL_SIZE, minSize: 4 });
  page.drawText(labelFit.text, {
    x: box.x + LABEL_PAD_X,
    y: PAGE_HEIGHT - (box.y + LABEL_PAD_TOP + LABEL_SIZE),
    size: labelFit.size,
    font: fonts.label,
    color: GRAY,
  });

  const checks = transactionTypeChecks(claim.dental?.transactionType ?? '');
  const options: CheckOption[] = [
    { text: 'Statement of Actual Services', checked: checks.statement },
    { text: 'Request for Predetermination', checked: checks.predetermination },
    { text: 'EPSDT', checked: checks.epsdt },
  ];
  const rowTopY = box.y + CHECKBOX_ROW_TOP_OFFSET;
  drawCheckRow(page, fonts, box.x + LABEL_PAD_X, rowTopY, options, box.width - 2 * LABEL_PAD_X);

  const predetermination = claim.dental && claim.dental.predeterminationNumber !== '' ? claim.dental.predeterminationNumber : EM_DASH;
  const place = claim.dental && claim.dental.placeOfTreatment !== '' ? claim.dental.placeOfTreatment : EM_DASH;
  const line2 = safeText(fonts.value, `2. PREDETERMINATION #: ${predetermination}     38. PLACE OF TREATMENT: ${place}`);
  const fit = fitText(fonts.value, line2, box.width - 2 * LABEL_PAD_X, { maxSize: VALUE_MAX_SIZE, minSize: VALUE_MIN_SIZE });
  const baselineTopY = rowTopY + VALUE_LINE_GAP;
  if (baselineTopY <= box.y + box.height - 1) {
    page.drawText(fit.text, { x: box.x + LABEL_PAD_X, y: PAGE_HEIGHT - baselineTopY, size: fit.size, font: fonts.value, color: BLACK });
  }
}

/**
 * A row of small checkbox+label pairs, shrinking to fit `maxWidth` if the
 * options don't fit at the default size. `rowTopY` is the row's own
 * baseline (top-origin). Self-contained duplicate of the CMS-1500 restyle's
 * own checkbox-row helper (each renderer file is deliberately self-contained
 * — see the layout.ts file header).
 */
function drawCheckRow(page: PDFPage, fonts: Fonts, x: number, rowTopY: number, options: CheckOption[], maxWidth: number): void {
  const boxSize = CHECKBOX_GLYPH_SIZE;
  const gap = 2.5;
  const optGap = 8;

  const widthAt = (size: number): number =>
    options.reduce(
      (sum, o, i) => sum + boxSize + gap + fonts.value.widthOfTextAtSize(safeText(fonts.value, o.text), size) + (i < options.length - 1 ? optGap : 0),
      0,
    );

  let size = CHECKBOX_OPTION_MAX_SIZE;
  while (size > CHECKBOX_OPTION_MIN_SIZE && widthAt(size) > maxWidth) {
    size = Math.round((size - 0.5) * 100) / 100;
  }

  let curX = x;
  const boxTopY = rowTopY - boxSize + 1;
  for (const opt of options) {
    const boxRect: Rect = { x: curX, y: boxTopY, width: boxSize, height: boxSize };
    drawFrame(page, boxRect);
    if (opt.checked) {
      page.drawText('X', {
        x: curX + 0.6,
        y: PAGE_HEIGHT - (boxTopY + boxSize - 0.6),
        size: boxSize - 0.8,
        font: fonts.value,
        color: BLACK,
      });
    }
    curX += boxSize + gap;
    const label = safeText(fonts.value, opt.text);
    page.drawText(label, { x: curX, y: PAGE_HEIGHT - rowTopY, size, font: fonts.value, color: BLACK });
    curX += fonts.value.widthOfTextAtSize(label, size) + optGap;
  }
}

// ---------------------------------------------------------------------------
// 24-31 — Record of Services grid.
// ---------------------------------------------------------------------------

function drawGridTable(page: PDFPage, fonts: Fonts, lines: ServiceLine[]): void {
  const table = GRID_TABLE;
  const outer: Rect = {
    x: table.x,
    y: table.y,
    width: table.width,
    height: table.headerHeight + table.rowHeight * table.maxRowsPerPage,
  };
  drawFrame(page, outer);

  // Header row — shaded like the design's #e3e3e3 column-header strip / the CMS-1500 restyle's box-24 header.
  const headerRect: Rect = { x: table.x, y: table.y, width: table.width, height: table.headerHeight };
  page.drawRectangle({ ...toPdfRect(headerRect, PAGE_HEIGHT), color: SHADE_HEADER });
  drawFrame(page, headerRect);
  GRID_COLUMNS.forEach((col, i) => {
    const x = GRID_COLUMN_X[i]!;
    if (i > 0) drawVLine(page, x, table.y, table.y + outer.height);
    const headerText = safeText(fonts.label, col.header);
    const fit = fitText(fonts.label, headerText, col.width - 2 * LABEL_PAD_X, { maxSize: 5.5, minSize: 4.5 });
    page.drawText(fit.text, {
      x: x + LABEL_PAD_X,
      y: PAGE_HEIGHT - (table.y + table.headerHeight - 4),
      size: fit.size,
      font: fonts.label,
      color: GRAY,
    });
  });

  // Body rows: a fixed maxRowsPerPage grid is drawn on every page; unused slots stay blank.
  for (let r = 0; r < table.maxRowsPerPage; r++) {
    const rowTop = table.y + table.headerHeight + r * table.rowHeight;
    const rowRect: Rect = { x: table.x, y: rowTop, width: table.width, height: table.rowHeight };
    drawFrame(page, rowRect);
    GRID_COLUMNS.forEach((_col, i) => {
      const x = GRID_COLUMN_X[i]!;
      if (i > 0) drawVLine(page, x, rowTop, rowTop + table.rowHeight);
    });

    const line = lines[r];
    if (!line) continue; // blank row slot — no data, not a "missing field"

    const cells = gridCellValues(line);
    GRID_COLUMNS.forEach((col, i) => {
      const x = GRID_COLUMN_X[i]!;
      const raw = cells[col.key];
      if (raw === '') return; // box 30 (description) is intentionally always blank — see file header
      const text = safeText(fonts.value, raw);
      const maxWidth = col.width - 2 * LABEL_PAD_X;
      const fit = fitText(fonts.value, text, maxWidth, { maxSize: VALUE_MAX_SIZE, minSize: VALUE_MIN_SIZE });
      const baselineTopY = rowTop + table.rowHeight / 2 + fit.size / 2 - 1;
      const drawX = col.align === 'right' ? rightAlignX(fonts.value, fit.text, fit.size, x + col.width, LABEL_PAD_X) : x + LABEL_PAD_X;
      page.drawText(fit.text, { x: drawX, y: PAGE_HEIGHT - baselineTopY, size: fit.size, font: fonts.value, color: BLACK });
    });
  }
}

function drawVLine(page: PDFPage, xTop: number, yTopStart: number, yTopEnd: number): void {
  page.drawLine({
    start: { x: xTop, y: PAGE_HEIGHT - yTopStart },
    end: { x: xTop, y: PAGE_HEIGHT - yTopEnd },
    thickness: BORDER_WIDTH,
    color: BLACK,
  });
}

function gridCellValues(line: ServiceLine): Record<GridColumn['key'], string> {
  const hcpcs = [line.procCode, ...line.modifiers].filter((p) => p !== '').join(' ');
  return {
    date: line.fromDate === '' ? EM_DASH : formatDateShort(line.fromDate),
    area: orDash(line.oralCavityArea ?? ''),
    // ADA box 26 "tooth system" (e.g. Universal/ISO) has no field in the
    // normalized Claim model — the 837D TOO segment carries a designation-
    // system qualifier (TOO01) that isn't captured anywhere on ServiceLine,
    // so this column always shows "—" (see the parser's report note).
    system: EM_DASH,
    toothNumbers: orDash(line.toothNumbers ?? ''),
    surface: orDash(line.toothSurfaces ?? ''),
    cdt: orDash(hcpcs),
    diagPtr: orDash(line.diagPointers.join('')),
    qty: orDash(line.units),
    // Box 30 CDT description is intentionally always blank — no CDT
    // description dictionary is shipped with this viewer (ADA licensing).
    description: '',
    fee: formatMoney(line.charge),
  };
}

// ---------------------------------------------------------------------------
// Total fee (32) — shaded bar directly beneath the grid, matching the
// design's totals row.
// ---------------------------------------------------------------------------

function drawTotalFee(page: PDFPage, fonts: Fonts, claim: Claim): void {
  const box = TOTAL_FEE_BOX;
  page.drawRectangle({ ...toPdfRect(box.rect, PAGE_HEIGHT), color: SHADE_TOTAL });
  drawFrame(page, box.rect);

  const label = safeText(fonts.label, '32. TOTAL FEE');
  const labelSize = 6.5;
  const labelWidth = fonts.label.widthOfTextAtSize(label, labelSize);
  const centerTopY = box.rect.y + box.rect.height / 2 + labelSize / 2 - 1;
  const amount = safeText(fonts.value, formatMoney(claim.totals.totalCharge));
  const amountSize = 8.5;
  const amountX = rightAlignX(fonts.value, amount, amountSize, box.rect.x + box.rect.width, LABEL_PAD_X);
  page.drawText(label, { x: amountX - labelWidth - 10, y: PAGE_HEIGHT - centerTopY, size: labelSize, font: fonts.label, color: GRAY });
  page.drawText(amount, { x: amountX, y: PAGE_HEIGHT - centerTopY, size: amountSize, font: fonts.value, color: BLACK });
}

// ---------------------------------------------------------------------------
// Box-height overflow clamping — same policy as the UB-04 renderer's
// wrapWithOverflow: a variable-length list (missing teeth, diagnoses) must
// never draw more lines than its box can hold, and a truncated list must say
// so visibly ("+N more") rather than overflow into whatever is drawn next.
// ---------------------------------------------------------------------------

const BOTTOM_MARGIN = 2;
export function maxLinesForHeight(height: number): number {
  return Math.max(1, Math.floor((height - VALUE_TOP_OFFSET - VALUE_MAX_SIZE - BOTTOM_MARGIN) / VALUE_LINE_GAP) + 1);
}

function wrapTokens(tokens: string[], perLine: number): string[] {
  if (tokens.length === 0) return [];
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i += perLine) {
    lines.push(tokens.slice(i, i + perLine).join('  '));
  }
  return lines;
}

export function wrapWithOverflow(tokens: string[], perLine: number, maxLines: number): string[] {
  if (tokens.length === 0) return [];
  const capacity = perLine * maxLines;
  if (tokens.length <= capacity) return wrapTokens(tokens, perLine);

  const shownCount = Math.max(1, capacity - 1);
  const shown = tokens.slice(0, shownCount);
  const hidden = tokens.length - shown.length;
  const lines = wrapTokens(shown, perLine);
  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex]}  +${hidden} more`;
  return lines;
}

// The missing-teeth row is now full page width (was half-width before this
// restyle), so more tokens comfortably fit per line before truncating.
const MISSING_TEETH_PER_LINE = 16;
const DIAGNOSES_PER_LINE = 2;

function diagnosisToken(d: Diagnosis): string {
  return `${d.pointer !== '' ? d.pointer : String(d.ordinal)}:${d.code}`;
}

// ---------------------------------------------------------------------------
// Claim -> box value mapping
// ---------------------------------------------------------------------------

function formatDateShort(iso: string): string {
  if (iso === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]!.slice(2)}`;
}

function addressLine(addr: Address): string {
  const composed = composeAddressLine(addr);
  return composed === '' ? EM_DASH : composed;
}

function nameOrDash(name: Name): string {
  const composed = composeName(name);
  return composed === '' ? EM_DASH : composed;
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  '18': 'SELF',
  '01': 'SPOUSE',
  '19': 'CHILD',
  G8: 'OTHER',
};

function relationshipLabel(code: string): string {
  if (code === '') return EM_DASH;
  return RELATIONSHIP_LABELS[code] ?? code;
}

function dobSexIdLine(dob: string, sex: string, id: string): string {
  return `DOB ${orDash(formatDateShort(dob))}   SEX ${orDash(sex)}   ID ${orDash(id)}`;
}

/** Returns the value line(s) to draw inside a header/provider FieldBox — never more lines than the box's own height can hold for the variable-length lists (see wrapWithOverflow). */
export function getDentalBoxLines(claim: Claim, box: FieldBox): string[] {
  const dental = claim.dental;
  const key = box.key;
  const maxLines = maxLinesForHeight(box.rect.height);

  switch (key) {
    case 'payer': {
      const idPart = claim.payer.id !== '' ? ` (ID: ${claim.payer.id})` : '';
      return [`${orDash(claim.payer.name)}${idPart}`, addressLine(claim.payer.address)];
    }

    case 'subscriber': {
      const groupPlan = [claim.insured.group !== '' ? `GROUP ${claim.insured.group}` : '', claim.insured.plan !== '' ? `PLAN ${claim.insured.plan}` : '']
        .filter((l) => l !== '')
        .join('   ');
      return [
        nameOrDash(claim.insured.name),
        addressLine(claim.insured.address),
        dobSexIdLine(claim.insured.dob, claim.insured.sex, claim.insured.memberId),
        groupPlan === '' ? EM_DASH : groupPlan,
        `EMPLOYER ${orDash(claim.insured.employer)}`,
      ];
    }

    case 'patient':
      return [
        nameOrDash(claim.patient.name),
        `REL ${relationshipLabel(claim.patient.relationshipToInsured)}`,
        addressLine(claim.patient.address),
        dobSexIdLine(claim.patient.dob, claim.patient.sex, claim.patient.accountNumber),
      ];

    case 'missingTeeth': {
      const teethTokens = dental?.missingTeeth ?? [];
      const ortho = dental?.orthodontics;
      const orthoLine = ortho ? `ORTHO: ${orDash(ortho.monthsRemaining)} MO. REMAINING${ortho.appliancePlacedDate !== '' ? ` (PLACED ${formatDateShort(ortho.appliancePlacedDate)})` : ''}` : '';
      // The orthodontics line always takes one of the box's line slots (when
      // present) so the missing-teeth token wrap below never overflows the
      // box even after the extra line is added.
      const reserve = orthoLine !== '' ? 1 : 0;
      const teethLines = teethTokens.length > 0 ? wrapWithOverflow(teethTokens, MISSING_TEETH_PER_LINE, Math.max(1, maxLines - reserve)) : [EM_DASH];
      return orthoLine !== '' ? [...teethLines, orthoLine] : teethLines;
    }

    case 'diagnoses': {
      const tokens = claim.diagnoses.map(diagnosisToken);
      return tokens.length > 0 ? wrapWithOverflow(tokens, DIAGNOSES_PER_LINE, maxLines) : [EM_DASH];
    }

    case 'billingDentist': {
      const addrPhone = [addressLine(claim.billingProvider.address), claim.billingProvider.phone !== '' ? `PH: ${claim.billingProvider.phone}` : '']
        .filter((l) => l !== '')
        .join('  ');
      const tin = claim.billingProvider.taxId !== '' ? `   TIN: ${claim.billingProvider.taxId}` : '';
      return [orDash(claim.billingProvider.name), addrPhone === '' ? EM_DASH : addrPhone, `NPI: ${orDash(claim.billingProvider.npi)}${tin}`];
    }

    case 'treatingDentist': {
      const name = dental ? nameOrDash(dental.treatingDentist) : EM_DASH;
      const taxonomy = claim.renderingProvider.taxonomy !== '' ? `   SPECIALTY: ${claim.renderingProvider.taxonomy}` : '';
      return [name, `NPI: ${orDash(claim.renderingProvider.npi)}${taxonomy}`];
    }

    default:
      return [EM_DASH];
  }
}
