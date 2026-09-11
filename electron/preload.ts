import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { FormType, WarningSeverity } from '../src/model/claim.js';

/**
 * Frozen, enumerated contextBridge API. The renderer gets exactly the
 * functions enumerated on `claimApi` below and nothing else — no raw
 * `ipcRenderer`, no Node globals (contextIsolation:true + sandbox:true in
 * electron/main.ts already block those; this file is the other half of
 * that boundary). Every argument that crosses this bridge is re-validated
 * in main (see registerIpcHandlers in electron/main.ts) — the renderer is
 * treated as untrusted input.
 */

export interface ClaimSummaryDto {
  claimId: string;
  formType: FormType;
  patientName: string;
  total: number;
  warningCount: number;
}

/** Editable-fields feature (docs/EDITABLE_FIELDS_DESIGN.md) — mirrors electron/main.ts's CorrectedClaimStatus. `'stale'` means a saved corrected-claim artifact exists for a DIFFERENT version of this file (its hash no longer matches) and was NOT applied — the renderer surfaces this as a dismissible banner offering `discardStaleOverrides`, never applies it silently. */
export type CorrectedClaimStatusDto = 'none' | 'applied' | 'stale';

export interface OpenClaimResultDto {
  sessionId: string;
  /** Resolved absolute path of the opened file — see electron/main.ts's `OpenClaimResult.filePath` doc comment for why the renderer is allowed to see this one path. */
  filePath: string;
  fileName: string;
  source: 'json' | 'x12';
  summaries: ClaimSummaryDto[];
  correctedClaimStatus: CorrectedClaimStatusDto;
}

/** `{ raw, decoded }` for a single coded field — structurally identical to `src/model/decode.ts`'s `CodedValue` (declared again here for the same "no main-process import in the renderer's type surface" reason as the DTOs around it). `decoded` is `null` for a blank or unrecognized raw code (docs/BUILD_QUEUE.md Build 2.2) — never the string "Unknown". */
export interface CodedValueDto {
  raw: string;
  decoded: string | null;
}

/** Institutional (UB-04) claim-level coded fields, decoded — structurally identical to electron/main.ts's `InstitutionalDetailDto`. `null` on every non-institutional claim. */
export interface InstitutionalDetailDto {
  typeOfBill: {
    raw: string;
    facilityType: CodedValueDto;
    billClassification: CodedValueDto;
    frequency: CodedValueDto;
    combined: string | null;
  };
  patientStatus: CodedValueDto;
  conditionCodes: CodedValueDto[];
  occurrenceCodes: Array<CodedValueDto & { date: string }>;
  occurrenceSpans: Array<CodedValueDto & { from: string; through: string }>;
  valueCodes: Array<CodedValueDto & { amount: number }>;
}

/**
 * Field-level DTO for the inspector drawer. Structurally identical to the
 * `ClaimDetailDto` built in electron/main.ts's `buildClaimDetail` (that's
 * the single source of truth for its shape) — declared again here, same as
 * ClaimSummaryDto/OpenClaimResultDto above, purely so the renderer has a
 * type to import that doesn't pull in any main-process (Node/Electron)
 * module.
 */
export interface ClaimDetailDto {
  claimId: string;
  claimFormRaw: string;
  formType: FormType;
  patient: {
    name: string;
    dob: string;
    sex: string;
    address: string;
    phone: string;
    relationshipToInsured: string;
    accountNumber: string;
  };
  insured: {
    name: string;
    memberId: string;
    group: string;
    plan: string;
    dob: string;
    sex: string;
    address: string;
    employer: string;
  };
  payer: {
    name: string;
    id: string;
    address: string;
  };
  providers: {
    billing: { name: string; npi: string; taxId: string; taxIdType: string; address: string; phone: string; taxonomy: string };
    rendering: { name: string; npi: string; taxonomy: string };
    referring: { name: string; npi: string; id: string } | null;
    facility: { name: string; npi: string; address: string } | null;
  };
  diagnoses: Array<{ pointer: string; ordinal: number; code: string }>;
  serviceLines: Array<{
    line: number;
    dates: string;
    /** CMS-1500 Box 24B place-of-service; '' on institutional/dental lines (see electron/main.ts's buildClaimDetail). Added for the copy-service-lines-as-TSV formatter (docs/TABS_BUILD_PLAN.md §2f item 1) — not shown elsewhere in the inspector today. */
    placeOfService: string;
    /** Plain-English decoding of `placeOfService` (docs/BUILD_QUEUE.md Build 2.2) — `null` when blank or unrecognized. `placeOfService` itself stays raw. */
    placeOfServiceDecoded: string | null;
    procCode: string;
    modifiers: string;
    /** One CodedValueDto per entry in `modifiers` (docs/BUILD_QUEUE.md Build 2.2). `modifiers` itself stays the raw joined string. */
    modifierDecodings: CodedValueDto[];
    diagPointers: string;
    charge: number;
    units: string;
    revenueCode: string;
    /** Plain-English decoding of `revenueCode` (docs/BUILD_QUEUE.md Build 2.2) — `null` when blank or unrecognized. `revenueCode` itself stays raw. */
    revenueCodeDecoded: string | null;
    revenueDescription: string;
    toothNumbers: string;
    toothSurfaces: string;
  }>;
  /** Institutional (UB-04) claim-level coded fields, decoded — `null` for every non-institutional claim. */
  institutional: InstitutionalDetailDto | null;
  totals: {
    totalCharge: number;
    amountPaid: number;
    sumOfLineCharges: number;
    delta: number;
  };
  warnings: Array<{ code: string; severity: WarningSeverity; message: string }>;
  rawText: string;

  // --- Editable fields (docs/EDITABLE_FIELDS_DESIGN.md) --------------------
  // Structurally identical to electron/main.ts's own additions to
  // ClaimDetailDto — see that file's header comment for the full
  // explanation (short version: every scalar value above already reflects
  // any active override; `warnings` above is always computed from the
  // ORIGINAL parse regardless).
  editableFieldPaths: string[];
  edits: Array<{ fieldPath: string; label: string; originalValue: string; currentValue: string }>;
  editedFieldCount: number;
  correctedClaimStatus: CorrectedClaimStatusDto;
}

export type OpenExportMode = 'file' | 'folder';

// --- Export suite (docs/BUILD_QUEUE.md Build 4) --------------------------

/** Batch export (Build 4.1) options — structurally identical to electron/main.ts's `BatchExportOptionsDto`. */
export interface BatchExportOptionsDto {
  /** 4.2 — also merge every successfully-rendered claim into one combined PDF, alongside (never instead of) the one-file-per-claim output. */
  combinePdf: boolean;
}

export interface BatchExportClaimResultDto {
  index: number;
  claimId: string;
  fileName: string | null;
  status: 'success' | 'failed';
  error?: string;
}

export interface BatchExportResultDto {
  canceled: boolean;
  destinationFolder: string | null;
  total: number;
  succeeded: number;
  failed: number;
  results: BatchExportClaimResultDto[];
  combinedPdfFileName: string | null;
}

/** Pushed over `export:batchProgress` while a batch export is running — the bridge's first push channel (docs/BUILD_QUEUE.md Build 4.1). */
export interface BatchExportProgressDto {
  sessionId: string;
  done: number;
  total: number;
  claimId: string;
}

/** Shared by CSV (Build 4.3) and JSON (Build 4.4) export — `scope: 'all'` includes every claim in the open file in one document; `'claim'` includes only the currently-active one. `includeIdentifiers` is the explicit, visually-marked opt-in to add patient/insured identifying fields (docs/CLAUDE_CODE_NEXT_SESSION.md's PHI-minimal-by-default decision) — always defaults to `false` in the renderer, never inherited from a previous export. */
export interface StructuredExportOptionsDto {
  scope: 'claim' | 'all';
  includeIdentifiers: boolean;
}

export interface AppInfoDto {
  version: string;
  buildDate: string;
}

/** A stored file reference — `{ filePath, fileName }` only, never claim content. Structurally identical to `src/app/persistence/sessionStore.ts`'s `StoredFileRef` — declared again here for the same reason as the other DTOs above (no main-process import from the renderer's type surface). */
export interface StoredFileRefDto {
  filePath: string;
  fileName: string;
}

/** The four values the View menu's UI text scale ever cycles through (docs/UI_REQUIREMENTS_v3_queued_features.md §9) — structurally identical to `src/app/persistence/sessionStore.ts`'s `UI_SCALE_VALUES`/`UiScaleValue`. */
export const UI_SCALE_VALUES = [100, 125, 150, 175] as const;
export type UiScaleValue = (typeof UI_SCALE_VALUES)[number];

export interface SessionRestoreStateDto {
  tabs: StoredFileRefDto[];
  activeIndex: number;
  recentFiles: StoredFileRefDto[];
  /** Always a concrete one of UI_SCALE_VALUES — main resolves "never saved yet" to 100 before this crosses the bridge. */
  uiScale: UiScaleValue;
}

const claimApi = Object.freeze({
  /**
   * With no argument: opens a native file-picker (filtered to
   * .json/.dat/.edi/.txt/.837), reads + parses the chosen file in main, and
   * returns its claim summaries. Resolves `null` if the user cancels the
   * dialog.
   *
   * With `droppedPath`: skips the native dialog entirely and reads + parses
   * that path instead — the drag-and-drop open flow (spec §4), where
   * `droppedPath` came from getPathForFile below, never from a dialog
   * result. Main re-validates the extension either way.
   */
  openClaim: (droppedPath?: string): Promise<OpenClaimResultDto | null> => ipcRenderer.invoke('dialog:openClaim', droppedPath),
  /**
   * Resolves the real filesystem path for a `File` object the renderer got
   * from an OS drag-and-drop `DataTransfer` — this is the supported
   * replacement for the old (removed) `File.prototype.path` augmentation;
   * see electron's `webUtils.getPathForFile` docs. Synchronous, and safe to
   * expose directly: the `File` argument came from the renderer's own DOM
   * event, not a path string, so this can't be used to probe arbitrary
   * filesystem paths.
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Renders the claim at `index` within the given tab's session to PDF bytes, for pdf.js preview. `sessionId` is validated in main exactly like `index` (see electron/main.ts's getSessionClaim). */
  getPdf: (sessionId: string, index: number): Promise<Uint8Array> => ipcRenderer.invoke('claim:getPdf', sessionId, index),
  /** Field-level data for the claim at `index` within the given tab's session, for the inspector drawer (see ClaimDetailDto). */
  getDetail: (sessionId: string, index: number): Promise<ClaimDetailDto> => ipcRenderer.invoke('claim:getDetail', sessionId, index),
  /** Opens a native save-file dialog (PHI-free default name) and writes the rendered PDF for the claim at `index` within the given tab's session. Resolves the saved path, or `null` if the user cancels. */
  exportPdf: (sessionId: string, index: number): Promise<string | null> => ipcRenderer.invoke('dialog:exportPdf', sessionId, index),
  /** "Open containing folder" / "Open PDF" toast actions after a successful export — acts on the last path exportPdf resolved in main, never on a path passed from here. Rejects if nothing has been exported yet this session. */
  openExport: (mode: OpenExportMode): Promise<void> => ipcRenderer.invoke('shell:openExport', mode),
  /** Drops one tab's session in main — its parsed claims (PHI) leave main-process memory immediately (docs/TABS_BUILD_PLAN.md §2). Called when a tab closes. */
  closeSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:close', sessionId),
  /** App version + build-date stamp for the About screen (docs/TABS_BUILD_PLAN.md §2c). */
  getAppInfo: (): Promise<AppInfoDto> => ipcRenderer.invoke('app:getInfo'),
  /** What to restore on launch (docs/TABS_BUILD_PLAN.md §2e): open-tab paths + order + which was active (already re-validated in main — extension allow-list + existsSync, a stored path that's gone is silently dropped), plus the recent-files list. Called once at renderer startup, and again whenever the File menu needs a fresh recent-files list. */
  getSessionRestoreState: (): Promise<SessionRestoreStateDto> => ipcRenderer.invoke('session:getRestoreState'),
  /** Persists the current open-tab list + which one is active (docs/TABS_BUILD_PLAN.md §2e). Every path passed here already came FROM main (openClaim's own result) — never a renderer-invented path. */
  saveSession: (tabs: StoredFileRefDto[], activeIndex: number): Promise<void> => ipcRenderer.invoke('session:save', tabs, activeIndex),
  /** File-menu "Forget open tabs & recent files" (docs/TABS_BUILD_PLAN.md §2e) — clears the stored session + recent list on disk. Does not close any tab currently open in this window. */
  forgetSession: (): Promise<void> => ipcRenderer.invoke('session:forget'),
  /** Persists the View menu's UI text scale (docs/UI_REQUIREMENTS_v3_queued_features.md §9) inside the same session.json — called every time src/renderer/features/uiScale.ts cycles it. Main silently ignores anything outside UI_SCALE_VALUES rather than persisting it. */
  saveUiScale: (scale: UiScaleValue): Promise<void> => ipcRenderer.invoke('settings:saveUiScale', scale),

  // --- Editable fields (docs/EDITABLE_FIELDS_DESIGN.md) -------------------
  /** Sets (creates or updates) one field override on the claim at `index`, validated and persisted in main, and returns the fresh, fully-recomputed ClaimDetailDto so the caller can repaint immediately without a second round-trip. Rejects with a user-facing message if `fieldPath` isn't a recognized editable field or `value` fails that field's own validation. */
  setFieldOverride: (sessionId: string, index: number, fieldPath: string, value: string): Promise<ClaimDetailDto> =>
    ipcRenderer.invoke('claim:setFieldOverride', sessionId, index, fieldPath, value),
  /** Reverts ONE field back to its originally-parsed value. Returns the fresh ClaimDetailDto. */
  revertFieldOverride: (sessionId: string, index: number, fieldPath: string): Promise<ClaimDetailDto> =>
    ipcRenderer.invoke('claim:revertFieldOverride', sessionId, index, fieldPath),
  /** Reverts EVERY field on the claim at `index` back to its originally-parsed value (invariant 8 — "clear all overrides for a claim"). Other claims in the same batch file are untouched. Returns the fresh ClaimDetailDto. */
  clearOverridesForClaim: (sessionId: string, index: number): Promise<ClaimDetailDto> => ipcRenderer.invoke('claim:clearOverridesForClaim', sessionId, index),
  /** The stale-overrides banner's "Discard saved edits" action: deletes every saved override for this tab's file (its `correctedClaimStatus` was `'stale'`). Never applies them — only ever discards. */
  discardStaleOverrides: (sessionId: string): Promise<void> => ipcRenderer.invoke('claim:discardStaleOverrides', sessionId),

  // --- Export suite (docs/BUILD_QUEUE.md Build 4) --------------------------
  /**
   * Batch export (4.1): opens a native folder picker, then renders every
   * claim in this tab's session to its own PDF in that folder (main owns
   * the loop — see electron/main.ts's `export:batch` handler), optionally
   * ALSO merging every successfully-rendered claim into one combined PDF
   * (4.2, `options.combinePdf`). Resolves once the run finishes, is
   * canceled (`cancelBatchExport`), or the folder picker itself is
   * canceled (`result.canceled: true`, no folder ever chosen) — progress
   * arrives separately over `onBatchProgress` while this promise is still
   * pending.
   */
  exportBatch: (sessionId: string, options: BatchExportOptionsDto): Promise<BatchExportResultDto> => ipcRenderer.invoke('export:batch', sessionId, options),
  /** Requests that an in-flight batch export for this session stop after its current claim — a no-op if no batch is running. Already-written files are kept; see BatchExportResultDto.canceled's own doc comment. */
  cancelBatchExport: (sessionId: string): Promise<void> => ipcRenderer.invoke('export:cancelBatch', sessionId),
  /**
   * Subscribes to batch-export progress pushes — the bridge's first push
   * channel (docs/BUILD_QUEUE.md Build 4.1). Wraps `ipcRenderer.on`,
   * stripping the `IpcRendererEvent` sender argument before it reaches the
   * renderer's callback (same "no sender object crosses the bridge"
   * discipline as every invoke-based call here), and returns an
   * unsubscribe function so the caller can stop listening when the batch
   * dialog closes.
   */
  onBatchProgress: (cb: (progress: BatchExportProgressDto) => void): (() => void) => {
    const listener = (_event: unknown, progress: BatchExportProgressDto): void => cb(progress);
    ipcRenderer.on('export:batchProgress', listener);
    return () => ipcRenderer.removeListener('export:batchProgress', listener);
  },
  /** Structured CSV export (4.3) of the claim at `index` (scope: 'claim') or every claim in this tab's session (scope: 'all') — PHI-minimal columns by default; `options.includeIdentifiers` is the explicit opt-in. Opens a native save dialog; resolves the saved path, or `null` if canceled. */
  exportCsv: (sessionId: string, index: number, options: StructuredExportOptionsDto): Promise<string | null> => ipcRenderer.invoke('dialog:exportCsv', sessionId, index, options),
  /** Structured JSON export (4.4) — same scope/identifiers semantics as exportCsv above. */
  exportJson: (sessionId: string, index: number, options: StructuredExportOptionsDto): Promise<string | null> => ipcRenderer.invoke('dialog:exportJson', sessionId, index, options),
});

export type ClaimApi = typeof claimApi;

contextBridge.exposeInMainWorld('claimApi', claimApi);
