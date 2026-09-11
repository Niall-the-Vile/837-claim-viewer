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

// Editable fields (docs/EDITABLE_FIELDS_DESIGN.md).
export const editModeToggleBtn = requireEl<HTMLButtonElement>('editModeToggleBtn');
export const editModeToggleLabelEl = requireEl<HTMLSpanElement>('editModeToggleLabel');
export const staleOverridesBannerEl = requireEl<HTMLDivElement>('staleOverridesBanner');
export const staleOverridesMessageEl = requireEl<HTMLSpanElement>('staleOverridesMessage');
export const staleOverridesDiscardBtn = requireEl<HTMLButtonElement>('staleOverridesDiscardBtn');
export const staleOverridesDismissBtn = requireEl<HTMLButtonElement>('staleOverridesDismissBtn');
export const clearOverridesBtn = requireEl<HTMLButtonElement>('clearOverridesBtn');

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

// Find/search (docs/UI_REQUIREMENTS_v3_queued_features.md §1 / docs/BUILD_QUEUE.md Build 2.1).
export const inspectorSearchInputEl = requireEl<HTMLInputElement>('inspectorSearchInput');
export const inspectorSearchClearBtn = requireEl<HTMLButtonElement>('inspectorSearchClearBtn');
export const inspectorSearchOtherClaimsBtn = requireEl<HTMLButtonElement>('inspectorSearchOtherClaims');
export const inspectorSearchSummaryEl = requireEl<HTMLDivElement>('inspectorSearchSummary');

export const statusFileGroupEl = requireEl<HTMLSpanElement>('statusFileGroup');
export const statusFileNameEl = requireEl<HTMLSpanElement>('statusFileName');
export const statusFormTypeEl = requireEl<HTMLSpanElement>('statusFormType');
export const statusWarnBtnEl = requireEl<HTMLButtonElement>('statusWarnBtn');
export const statusTotalsEl = requireEl<HTMLSpanElement>('statusTotals');
export const copySummaryBtn = requireEl<HTMLButtonElement>('copySummaryBtn');
export const statusNoFileEl = requireEl<HTMLSpanElement>('statusNoFile');

export const exportOverlayEl = requireEl<HTMLDivElement>('exportOverlay');
export const exportDialogTitleEl = requireEl<HTMLSpanElement>('exportDialogTitle');
export const exportConfirmViewEl = requireEl<HTMLDivElement>('exportConfirmView');
export const exportIntroEl = requireEl<HTMLParagraphElement>('exportIntro');
export const manifestFormEl = requireEl<HTMLSpanElement>('manifestForm');
export const manifestLinesEl = requireEl<HTMLSpanElement>('manifestLines');
export const manifestTotalEl = requireEl<HTMLSpanElement>('manifestTotal');
export const manifestWarningsEl = requireEl<HTMLSpanElement>('manifestWarnings');
export const exportManifestEl = requireEl<HTMLDivElement>('exportManifest');
export const exportPhiNoticeEl = requireEl<HTMLDivElement>('exportPhiNotice');
export const exportDialogFooterEl = requireEl<HTMLDivElement>('exportDialogFooter');
export const exportGhostBtn = requireEl<HTMLButtonElement>('exportGhostBtn');
export const exportConfirmBtn = requireEl<HTMLButtonElement>('exportConfirmBtn');

// Export suite (docs/BUILD_QUEUE.md Build 4): scope (this claim / all claims
// in the file), format (PDF/CSV/JSON), combined-PDF and identifiers-opt-in
// controls, and the batch progress/summary views that replace the export
// dialog's body while a batch export is running/just finished.
export const exportScopeGroupEl = requireEl<HTMLDivElement>('exportScopeGroup');
export const exportScopeClaimRadio = requireEl<HTMLInputElement>('exportScopeClaim');
export const exportScopeAllRadio = requireEl<HTMLInputElement>('exportScopeAll');
export const exportScopeAllLabelEl = requireEl<HTMLSpanElement>('exportScopeAllLabel');
export const exportFormatPdfRadio = requireEl<HTMLInputElement>('exportFormatPdf');
export const exportFormatCsvRadio = requireEl<HTMLInputElement>('exportFormatCsv');
export const exportFormatJsonRadio = requireEl<HTMLInputElement>('exportFormatJson');
export const exportFormatX12Radio = requireEl<HTMLInputElement>('exportFormatX12');
export const exportCombinePdfRowEl = requireEl<HTMLLabelElement>('exportCombinePdfRow');
export const exportCombinePdfCheckbox = requireEl<HTMLInputElement>('exportCombinePdfCheckbox');
export const exportIdentifiersGroupEl = requireEl<HTMLDivElement>('exportIdentifiersGroup');
export const exportIncludeIdentifiersCheckbox = requireEl<HTMLInputElement>('exportIncludeIdentifiersCheckbox');

export const exportBatchProgressEl = requireEl<HTMLDivElement>('exportBatchProgress');
export const batchProgressLabelEl = requireEl<HTMLDivElement>('batchProgressLabel');
export const batchProgressFillEl = requireEl<HTMLDivElement>('batchProgressFill');
export const batchProgressTrackEl = requireEl<HTMLDivElement>('batchProgressTrack');
export const batchProgressClaimEl = requireEl<HTMLDivElement>('batchProgressClaim');
export const batchCancelBtn = requireEl<HTMLButtonElement>('batchCancelBtn');

export const exportBatchSummaryEl = requireEl<HTMLDivElement>('exportBatchSummary');
export const batchSummaryTextEl = requireEl<HTMLParagraphElement>('batchSummaryText');
export const batchSummaryFailuresEl = requireEl<HTMLUListElement>('batchSummaryFailures');
export const batchSummaryOpenFolderBtn = requireEl<HTMLButtonElement>('batchSummaryOpenFolderBtn');

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

// View menu's "UI text scale" action (docs/UI_REQUIREMENTS_v3_queued_features.md §9).
export const uiScaleValueLabelEl = requireEl<HTMLSpanElement>('uiScaleValueLabel');

export const toastEl = requireEl<HTMLDivElement>('toast');
export const toastMessageEl = requireEl<HTMLSpanElement>('toastMessage');
export const toastActionsEl = requireEl<HTMLDivElement>('toastActions');
export const toastOpenFolderBtn = requireEl<HTMLButtonElement>('toastOpenFolderBtn');
export const toastOpenPdfBtn = requireEl<HTMLButtonElement>('toastOpenPdfBtn');
export const toastCloseBtn = requireEl<HTMLButtonElement>('toastCloseBtn');
