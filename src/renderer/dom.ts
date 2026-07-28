/**
 * All `#id` DOM element lookups for the renderer chrome, in one place so
 * every other renderer module imports the elements it needs from here
 * instead of re-querying the document. Pure-moved out of main.ts — see
 * docs/TABS_BUILD_PLAN.md §2 Item 0.
 */

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

export const titlebarFileNameEl = requireEl<HTMLSpanElement>('titlebarFileName');

export const tabStripEl = requireEl<HTMLDivElement>('tabStrip');

export const openBtn = requireEl<HTMLButtonElement>('openBtn');
export const exportBtn = requireEl<HTMLButtonElement>('exportBtn');

export const zoomSepEl = requireEl<HTMLSpanElement>('zoomSep');
export const zoomGroupEl = requireEl<HTMLDivElement>('zoomGroup');
export const zoomOutBtn = requireEl<HTMLButtonElement>('zoomOutBtn');
export const zoomLabelEl = requireEl<HTMLSpanElement>('zoomLabel');
export const zoomInBtn = requireEl<HTMLButtonElement>('zoomInBtn');
export const fitPageBtn = requireEl<HTMLButtonElement>('fitPageBtn');
export const fitWidthBtn = requireEl<HTMLButtonElement>('fitWidthBtn');

export const pageGroupEl = requireEl<HTMLDivElement>('pageGroup');
export const prevPageBtn = requireEl<HTMLButtonElement>('prevPageBtn');
export const pageLabelEl = requireEl<HTMLSpanElement>('pageLabel');
export const nextPageBtn = requireEl<HTMLButtonElement>('nextPageBtn');

export const claimGroupEl = requireEl<HTMLDivElement>('claimGroup');
export const prevClaimBtn = requireEl<HTMLButtonElement>('prevClaimBtn');
export const claimStepLabelEl = requireEl<HTMLSpanElement>('claimStepLabel');
export const nextClaimBtn = requireEl<HTMLButtonElement>('nextClaimBtn');

export const inspectorToggleBtn = requireEl<HTMLButtonElement>('inspectorToggleBtn');
export const inspectorToggleLabelEl = requireEl<HTMLSpanElement>('inspectorToggleLabel');
export const themeToggleBtn = requireEl<HTMLButtonElement>('themeToggleBtn');
export const themeToggleLabelEl = requireEl<HTMLSpanElement>('themeToggleLabel');

export const warnBannerEl = requireEl<HTMLDivElement>('warnBanner');
export const warnCountEl = requireEl<HTMLSpanElement>('warnCount');
export const warnMessagesEl = requireEl<HTMLSpanElement>('warnMessages');
export const warnReviewBtn = requireEl<HTMLButtonElement>('warnReviewBtn');
export const warnCopyBtn = requireEl<HTMLButtonElement>('warnCopyBtn');

export const welcomeScreenEl = requireEl<HTMLDivElement>('welcomeScreen');
export const welcomeOpenBtn = requireEl<HTMLButtonElement>('welcomeOpenBtn');

export const loadingScreenEl = requireEl<HTMLDivElement>('loadingScreen');
export const loadingLabelEl = requireEl<HTMLDivElement>('loadingLabel');

export const errorScreenEl = requireEl<HTMLDivElement>('errorScreen');
export const errorDetailEl = requireEl<HTMLDivElement>('errorDetail');
export const errorOpenBtn = requireEl<HTMLButtonElement>('errorOpenBtn');
export const errorCopyBtn = requireEl<HTMLButtonElement>('errorCopyBtn');

export const previewPaneEl = requireEl<HTMLDivElement>('previewPane');
export const workspaceScreenEl = requireEl<HTMLDivElement>('workspaceScreen');
export const provenanceChipTextEl = requireEl<HTMLSpanElement>('provenanceChipText');
export const sampleChipEl = requireEl<HTMLSpanElement>('sampleChip');
export const unsupportedNoteEl = requireEl<HTMLDivElement>('unsupportedNote');
export const pdfScrollEl = requireEl<HTMLDivElement>('pdfScroll');
export const pdfCanvasEl = requireEl<HTMLCanvasElement>('pdfCanvas');

export const inspectorEl = requireEl<HTMLElement>('inspector');
export const expandAllBtn = requireEl<HTMLButtonElement>('expandAllBtn');
export const inspectorBodyEl = requireEl<HTMLDivElement>('inspectorBody');

export const statusFileGroupEl = requireEl<HTMLSpanElement>('statusFileGroup');
export const statusFileNameEl = requireEl<HTMLSpanElement>('statusFileName');
export const statusFormTypeEl = requireEl<HTMLSpanElement>('statusFormType');
export const statusWarnBtnEl = requireEl<HTMLButtonElement>('statusWarnBtn');
export const statusTotalsEl = requireEl<HTMLSpanElement>('statusTotals');
export const copySummaryBtn = requireEl<HTMLButtonElement>('copySummaryBtn');
export const statusNoFileEl = requireEl<HTMLSpanElement>('statusNoFile');

export const exportOverlayEl = requireEl<HTMLDivElement>('exportOverlay');
export const exportIntroEl = requireEl<HTMLParagraphElement>('exportIntro');
export const manifestFormEl = requireEl<HTMLSpanElement>('manifestForm');
export const manifestLinesEl = requireEl<HTMLSpanElement>('manifestLines');
export const manifestTotalEl = requireEl<HTMLSpanElement>('manifestTotal');
export const manifestWarningsEl = requireEl<HTMLSpanElement>('manifestWarnings');
export const exportConfirmBtn = requireEl<HTMLButtonElement>('exportConfirmBtn');

export const shortcutsOverlayEl = requireEl<HTMLDivElement>('shortcutsOverlay');
export const shortcutsGridEl = requireEl<HTMLDivElement>('shortcutsGrid');

// About screen (docs/TABS_BUILD_PLAN.md §2c version/build stamp, §2e data-policy wording).
export const aboutOverlayEl = requireEl<HTMLDivElement>('aboutOverlay');
export const aboutVersionEl = requireEl<HTMLSpanElement>('aboutVersion');
export const aboutBuildDateEl = requireEl<HTMLSpanElement>('aboutBuildDate');

// "Forget open tabs & recent files" confirm dialog (docs/TABS_BUILD_PLAN.md §2e).
export const forgetOverlayEl = requireEl<HTMLDivElement>('forgetOverlay');
export const forgetConfirmBtn = requireEl<HTMLButtonElement>('forgetConfirmBtn');

// File menu's dynamically-populated recent-files list (docs/TABS_BUILD_PLAN.md §2e).
export const recentFilesListEl = requireEl<HTMLDivElement>('recentFilesList');
export const recentFilesEmptyEl = requireEl<HTMLDivElement>('recentFilesEmpty');

export const toastEl = requireEl<HTMLDivElement>('toast');
export const toastMessageEl = requireEl<HTMLSpanElement>('toastMessage');
export const toastActionsEl = requireEl<HTMLDivElement>('toastActions');
export const toastOpenFolderBtn = requireEl<HTMLButtonElement>('toastOpenFolderBtn');
export const toastOpenPdfBtn = requireEl<HTMLButtonElement>('toastOpenPdfBtn');
export const toastCloseBtn = requireEl<HTMLButtonElement>('toastCloseBtn');
