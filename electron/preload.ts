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

export interface OpenClaimResultDto {
  sessionId: string;
  /** Resolved absolute path of the opened file — see electron/main.ts's `OpenClaimResult.filePath` doc comment for why the renderer is allowed to see this one path. */
  filePath: string;
  fileName: string;
  source: 'json' | 'x12';
  summaries: ClaimSummaryDto[];
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
    procCode: string;
    modifiers: string;
    diagPointers: string;
    charge: number;
    units: string;
    revenueCode: string;
    revenueDescription: string;
    toothNumbers: string;
    toothSurfaces: string;
  }>;
  totals: {
    totalCharge: number;
    amountPaid: number;
    sumOfLineCharges: number;
    delta: number;
  };
  warnings: Array<{ code: string; severity: WarningSeverity; message: string }>;
  rawText: string;
}

export type OpenExportMode = 'file' | 'folder';

export interface AppInfoDto {
  version: string;
  buildDate: string;
}

/** A stored file reference — `{ filePath, fileName }` only, never claim content. Structurally identical to `src/app/persistence/sessionStore.ts`'s `StoredFileRef` — declared again here for the same reason as the other DTOs above (no main-process import from the renderer's type surface). */
export interface StoredFileRefDto {
  filePath: string;
  fileName: string;
}

export interface SessionRestoreStateDto {
  tabs: StoredFileRefDto[];
  activeIndex: number;
  recentFiles: StoredFileRefDto[];
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
});

export type ClaimApi = typeof claimApi;

contextBridge.exposeInMainWorld('claimApi', claimApi);
