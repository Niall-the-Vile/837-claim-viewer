/**
 * Per-form "allowed region" builders for the layout-invariant checker (see
 * test/support/geometry.ts and test/invariants.test.ts). Each function
 * returns every rectangle a renderer is permitted to draw text inside, in
 * PDF (bottom-left-origin) page coordinates — derived directly from each
 * form's own layout.ts coordinate map (never hand-copied), so a layout
 * re-tune never has to touch this file. Anything drawn outside every one of
 * these regions is stray.
 *
 * The dental version mirrors the `allowedRegions()` that already shipped in
 * test/renderDental.test.ts; the cms1500 and ub04 versions are new — those
 * two renderers previously had no equivalent geometry coverage at all.
 */

import {
  PAGE_WIDTH as CMS_PAGE_WIDTH,
  PAGE_HEIGHT as CMS_PAGE_HEIGHT,
  BAND1_TOP,
  BOX1,
  BOX1A,
  BAND1_LABEL_RECT,
  FIELD_BOXES,
  BOX3_SEX,
  BOX6_RELATIONSHIP,
  BOX10A_EMPLOYMENT,
  BOX10B_AUTO,
  BOX11A_SEX,
  BOX11D_OTHER_PLAN,
  BAND2_LABEL_RECT,
  READBACK_RECT,
  BOX12_SIGNATURE,
  BOX13_SIGNATURE,
  SIG_ROW_LABEL_STRIP,
  BAND3_HEADER_BOXES,
  DIAG_BOX,
  BOX22,
  BOX23,
  BOX24_TABLE,
  BOX25_TAXID,
  BOX26_ACCOUNT,
  BOX27_ASSIGNMENT,
  BOX28_TOTAL,
  BOX29_PAID,
  BOX30_BALANCE,
  BOX31_RENDERING,
  BOX32_FACILITY,
  BOX33_BILLING,
  BAND3_LABEL_RECT,
  FOOTER_Y as CMS_FOOTER_Y,
  DIAG_CONT_TITLE_RECT,
  DIAG_CONT_LIST_RECT,
  toPdfRect as cmsToPdfRect,
} from '../../src/render/cms1500/layout.js';
import type { Rect as CmsRect } from '../../src/render/cms1500/layout.js';

import {
  PAGE_WIDTH as UB_PAGE_WIDTH,
  PAGE_HEIGHT as UB_PAGE_HEIGHT,
  TITLE_RECT,
  HEADER_FIELD_BOXES as UB_HEADER_FIELD_BOXES,
  GRID_TABLE as UB_GRID_TABLE,
  FOOTER_Y as UB_FOOTER_Y,
  toPdfRect as ubToPdfRect,
} from '../../src/render/ub04/layout.js';
import type { Rect as UbRect } from '../../src/render/ub04/layout.js';

import {
  PAGE_WIDTH as DENT_PAGE_WIDTH,
  PAGE_HEIGHT as DENT_PAGE_HEIGHT,
  HEADER_INFO_BOX,
  HEADER_FIELD_BOXES as DENT_HEADER_FIELD_BOXES,
  GRID_TABLE as DENT_GRID_TABLE,
  TOTAL_FEE_BOX,
  PROVIDER_FIELD_BOXES,
  FOOTER_Y as DENT_FOOTER_Y,
  toPdfRect as dentToPdfRect,
} from '../../src/render/dental/layout.js';
import type { Rect as DentRect } from '../../src/render/dental/layout.js';

import type { Rect } from './geometry.js';

export function cms1500Regions(): Rect[] {
  const topOrigin: CmsRect[] = [
    // Header ("1500" mark, title, NUCC note, payer block) + PICA boxes.
    { x: 0, y: 0, width: CMS_PAGE_WIDTH, height: BAND1_TOP },
    BOX1,
    BOX1A.rect,
    BAND1_LABEL_RECT,
    ...FIELD_BOXES.map((b) => b.rect),
    BOX3_SEX.rect,
    BOX6_RELATIONSHIP.rect,
    BOX10A_EMPLOYMENT.rect,
    BOX10B_AUTO.rect,
    BOX11A_SEX.rect,
    BOX11D_OTHER_PLAN.rect,
    BAND2_LABEL_RECT,
    READBACK_RECT,
    BOX12_SIGNATURE.rect,
    BOX13_SIGNATURE.rect,
    SIG_ROW_LABEL_STRIP,
    ...BAND3_HEADER_BOXES.map((b) => b.rect),
    DIAG_BOX,
    BOX22.rect,
    BOX23.rect,
    { x: BOX24_TABLE.x, y: BOX24_TABLE.y, width: BOX24_TABLE.width, height: BOX24_TABLE.headerHeight + BOX24_TABLE.rowHeight * BOX24_TABLE.maxRowsPerPage },
    BOX25_TAXID.rect,
    BOX26_ACCOUNT.rect,
    BOX27_ASSIGNMENT.rect,
    BOX28_TOTAL.rect,
    BOX29_PAID.rect,
    BOX30_BALANCE.rect,
    BOX31_RENDERING.rect,
    BOX32_FACILITY.rect,
    BOX33_BILLING.rect,
    BAND3_LABEL_RECT,
    // Footer band, from just above the footer baseline to the bottom edge.
    { x: 0, y: CMS_FOOTER_Y - 8, width: CMS_PAGE_WIDTH, height: CMS_PAGE_HEIGHT - (CMS_FOOTER_Y - 8) },
  ];
  return topOrigin.map((r) => cmsToPdfRect(r, CMS_PAGE_HEIGHT));
}

/**
 * CMS-1500 diagnosis continuation page (Build 3.2(a)) — a different page
 * kind from every other CMS-1500 page, so it gets its own region set
 * derived from its own layout constants (title band, list band, and the
 * same footer band every other page uses), never hand-copied coordinates.
 */
export function cms1500ContinuationRegions(): Rect[] {
  const topOrigin: CmsRect[] = [
    DIAG_CONT_TITLE_RECT,
    DIAG_CONT_LIST_RECT,
    { x: 0, y: CMS_FOOTER_Y - 8, width: CMS_PAGE_WIDTH, height: CMS_PAGE_HEIGHT - (CMS_FOOTER_Y - 8) },
  ];
  return topOrigin.map((r) => cmsToPdfRect(r, CMS_PAGE_HEIGHT));
}

/**
 * Per-page region selector for a CMS-1500 render that MAY have appended a
 * diagnosis continuation page: every page up through `serviceLinePageCount`
 * uses the normal form regions, and the final page (only present when
 * `hasContinuation` is true) uses the continuation page's own regions.
 * Matches test/support/geometry.ts's LayoutSpec.regions function shape.
 */
export function cms1500RegionsPerPage(serviceLinePageCount: number, hasContinuation: boolean): (pageIndex: number, pageCount: number) => Rect[] {
  const normal = cms1500Regions();
  const continuation = cms1500ContinuationRegions();
  return (pageIndex: number) => (hasContinuation && pageIndex >= serviceLinePageCount ? continuation : normal);
}

export function ub04Regions(): Rect[] {
  const firstHeaderBoxY = UB_HEADER_FIELD_BOXES[0]!.rect.y;
  const topOrigin: UbRect[] = [
    // Small masthead title, above the first header field box.
    { x: 0, y: 0, width: UB_PAGE_WIDTH, height: firstHeaderBoxY },
    TITLE_RECT,
    ...UB_HEADER_FIELD_BOXES.map((b) => b.rect),
    { x: UB_GRID_TABLE.x, y: UB_GRID_TABLE.y, width: UB_GRID_TABLE.width, height: UB_GRID_TABLE.headerHeight + UB_GRID_TABLE.rowHeight * UB_GRID_TABLE.maxRowsPerPage },
    // Footer band, from just above the footer baseline to the bottom edge.
    { x: 0, y: UB_FOOTER_Y - 8, width: UB_PAGE_WIDTH, height: UB_PAGE_HEIGHT - (UB_FOOTER_Y - 8) },
  ];
  return topOrigin.map((r) => ubToPdfRect(r, UB_PAGE_HEIGHT));
}

export function dentalRegions(): Rect[] {
  const topOrigin: DentRect[] = [
    // Centered title/subtitle band, above the header-info box.
    { x: 0, y: 0, width: DENT_PAGE_WIDTH, height: HEADER_INFO_BOX.y },
    HEADER_INFO_BOX,
    ...DENT_HEADER_FIELD_BOXES.map((b) => b.rect),
    { x: DENT_GRID_TABLE.x, y: DENT_GRID_TABLE.y, width: DENT_GRID_TABLE.width, height: DENT_GRID_TABLE.headerHeight + DENT_GRID_TABLE.rowHeight * DENT_GRID_TABLE.maxRowsPerPage },
    TOTAL_FEE_BOX.rect,
    ...PROVIDER_FIELD_BOXES.map((b) => b.rect),
    // Footer band, from just above the footer baseline to the bottom edge.
    { x: 0, y: DENT_FOOTER_Y - 8, width: DENT_PAGE_WIDTH, height: DENT_PAGE_HEIGHT - (DENT_FOOTER_Y - 8) },
  ];
  return topOrigin.map((r) => dentToPdfRect(r, DENT_PAGE_HEIGHT));
}

export const CMS1500_PAGE = { width: CMS_PAGE_WIDTH, height: CMS_PAGE_HEIGHT };
export const UB04_PAGE = { width: UB_PAGE_WIDTH, height: UB_PAGE_HEIGHT };
export const DENTAL_PAGE = { width: DENT_PAGE_WIDTH, height: DENT_PAGE_HEIGHT };
