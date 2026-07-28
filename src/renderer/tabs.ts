import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ClaimSummaryDto, ClaimDetailDto } from '../../electron/preload.js';

/**
 * The single app-wide state singleton. Pure-moved out of main.ts — see
 * docs/TABS_BUILD_PLAN.md §2 Item 0. This is the precursor of the future
 * per-tab `TabState` (ROADMAP.md §1 / TABS_BUILD_PLAN.md §2): today there is
 * exactly one implicit "tab", so this file holds exactly what legitimately
 * belongs to that today — the state shape and its one instance — and
 * nothing else. Screen-transition orchestration (showScreen and friends)
 * stays in main.ts for now, since it isn't tab state itself.
 */

export type Screen = 'welcome' | 'loading' | 'error' | 'workspace';
export type ZoomMode = 'manual' | 'fit-page' | 'fit-width';

export interface AppState {
  screen: Screen;
  fileName: string;
  source: 'json' | 'x12' | null;
  summaries: ClaimSummaryDto[];
  currentIndex: number;
  detail: ClaimDetailDto | null;

  pdfDoc: PDFDocumentProxy | null;
  pageNum: number;
  pageCount: number;
  zoom: number;
  zoomMode: ZoomMode;

  inspectorOpen: boolean;
  theme: 'light' | 'dark';

  errorMessage: string;
}

export const state: AppState = {
  screen: 'welcome',
  fileName: '',
  source: null,
  summaries: [],
  currentIndex: 0,
  detail: null,
  pdfDoc: null,
  pageNum: 1,
  pageCount: 1,
  zoom: 1,
  zoomMode: 'fit-page',
  inspectorOpen: true,
  theme: 'light',
  errorMessage: '',
};
