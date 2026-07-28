import { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { dirname, join, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Claim, FormType, WarningSeverity } from '../src/model/claim.js';
import { loadClaims, renderClaim, claimSummary } from '../src/app/claimService.js';
import { ClaimParseError } from '../src/sources/claimSource.js';
import { composeName, composeAddressLine } from '../src/render/text.js';

/**
 * Electron main process: window lifecycle, the offline network kill-switch,
 * and every IPC handler that touches the filesystem or parsed claim data.
 * The renderer (sandboxed, contextIsolation:true) never sees a raw Claim
 * object — only claim summaries (for the stepper UI), field-level DTOs (for
 * the inspector), and rendered PDF bytes (for preview/export). It does
 * handle a few narrow filesystem-path exceptions, all already
 * user-disclosed/user-supplied rather than main-process-secret: the export
 * save path (shown back to the user in the export toast), a drag-and-drop
 * open path (resolved from a `File` the user just dropped via
 * `webUtils.getPathForFile`, never read off disk directly by the renderer),
 * and — since the tabs build (docs/TABS_BUILD_PLAN.md §2) — the resolved
 * path of a file the renderer itself just asked main to open, echoed back on
 * `dialog:openClaim`'s result purely so a tab can remember "reopen this same
 * path" (same-file-twice dedupe, Ctrl+Shift+T) without main tracking any
 * renderer-side state.
 * See electron/preload.ts for the frozen bridge that enforces this boundary.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173';
const BUILT_RENDERER_INDEX = join(__dirname, '..', 'renderer', 'index.html');

/**
 * Whether this run will load the Vite dev server instead of a built
 * dist/renderer/index.html. Deliberately keyed off the same file-existence
 * check `loadRenderer` uses below — NOT `app.isPackaged` — because
 * `npm start` runs the built output through the plain `electron` binary
 * (not the packaged .exe), so `app.isPackaged` is still `false` there even
 * though it should be treated as production. Tying the kill-switch/CSP
 * exception to "will we actually reach the dev server" keeps the exception
 * exactly as narrow as it needs to be.
 */
const IS_DEV = !existsSync(BUILT_RENDERER_INDEX);

interface ClaimSession {
  /** `resolve()`d absolute path — the dedupe key `openClaimAtPath` uses to detect "this file is already open in another tab" (docs/TABS_BUILD_PLAN.md §2b). */
  filePath: string;
  fileName: string;
  source: 'json' | 'x12';
  claims: Claim[];
}

/**
 * Every open tab's parsed claims, kept in main-process memory only, keyed by
 * a per-open sessionId (docs/ROADMAP.md §1 / TABS_BUILD_PLAN.md §2 — the
 * multi-file-tabs build). Each renderer tab owns exactly one entry here;
 * `dialog:openClaim` creates one (or reuses an existing one for the same
 * resolved path — see openClaimAtPath), and `session:close` drops one so its
 * PHI leaves memory the moment its tab closes. Closing the window clears all
 * of them (see the window-all-closed handler below).
 */
const sessions = new Map<string, ClaimSession>();

/**
 * The absolute path of the last claim PDF this session exported, or `null`
 * before any export. Backs the `shell:openExport` handler (see below) so
 * the "Open containing folder" / "Open PDF" toast actions never take a raw
 * path argument from the renderer — they act only on a path main itself
 * just wrote, the same "renderer never hands main a filesystem path"
 * discipline the rest of this file follows.
 */
let lastExportedPath: string | null = null;

// ---------------------------------------------------------------------------
// Offline enforcement — installed before any window/content loads.
// ---------------------------------------------------------------------------

/** localhost:5173 — same host Vite serves both its HTTP dev server and its HMR websocket on. `null` whenever this run isn't loading the dev server at all (see IS_DEV) — including every packaged build, so this exception can never apply there. */
const DEV_SERVER_HOST = IS_DEV ? new URL(DEV_SERVER_URL).host : null;

/**
 * True only for http(s)/ws(s) requests to the dev server's own host. Scoped
 * by host (not a string-prefix match against the http origin) specifically
 * because Vite's HMR client connects over `ws://localhost:5173/?token=...`
 * — a URL that never starts with `http://localhost:5173` — and a
 * string-prefix check on that origin was blocking it, breaking dev-mode
 * live reload. DEV_SERVER_HOST is `null` for a packaged app, so this always
 * returns false there regardless of the requested URL.
 */
function isAllowedDevServerRequest(url: string): boolean {
  if (DEV_SERVER_HOST === null) return false;
  try {
    const parsed = new URL(url);
    if (parsed.host !== DEV_SERVER_HOST) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

function installOfflineKillSwitch(): void {
  const allowedSchemes = /^(file|blob|data|devtools):/;

  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (allowedSchemes.test(details.url) || isAllowedDevServerRequest(details.url)) {
      callback({ cancel: false });
      return;
    }
    console.warn(`[offline-kill-switch] blocked network request: ${details.url}`);
    callback({ cancel: true });
  });

  session.defaultSession.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    // Dev-only: allow script/connect (incl. the HMR websocket) back to the
    // Vite dev server host; a packaged app never sets DEV_SERVER_HOST, so
    // this stays 'none' beyond file/blob/data there.
    const devSources = DEV_SERVER_HOST !== null ? ` http://${DEV_SERVER_HOST} ws://${DEV_SERVER_HOST}` : '';
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; " +
            `script-src 'self'${devSources}; ` +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; " +
            "font-src 'self' data:; " +
            `connect-src 'self'${devSources}`,
        ],
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/** Loads the built renderer if present (production / `npm start`), otherwise connects to the Vite dev server, retrying briefly since Electron and Vite are started concurrently in `npm run dev`. */
async function loadRenderer(win: BrowserWindow): Promise<void> {
  if (!IS_DEV) {
    await win.loadFile(BUILT_RENDERER_INDEX);
    return;
  }

  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await win.loadURL(DEV_SERVER_URL);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/**
 * Window/taskbar icon for DEV runs only. The packaged .exe gets its icon from
 * electron-builder (build.win.icon), which Windows reads straight off the
 * executable — this just stops `npm run dev` from showing the default Electron
 * atom. Guarded by existsSync so a missing build/icon.png is never fatal.
 */
function devWindowIcon(): string | undefined {
  const iconPath = join(__dirname, '..', '..', 'build', 'icon.png');
  return existsSync(iconPath) ? iconPath : undefined;
}

function createWindow(): BrowserWindow {
  const icon = devWindowIcon();
  const win = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    webPreferences: {
      // .cjs, not .js: with sandbox:true, Electron preload scripts MUST be
      // CommonJS — a sandboxed preload can't use ESM `import`, so an ESM
      // preload silently never runs (contextBridge.exposeInMainWorld never
      // fires, and window.claimApi stays undefined). Since this project's
      // package.json is "type":"module", tsc would emit plain .js as ESM;
      // the preload is instead built separately by esbuild straight to CJS
      // (see package.json's "build:preload" script) specifically to dodge
      // that. Keep sandbox:true — don't weaken it to work around this.
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false, // avoids Chromium's dictionary-download network attempt
    },
  });

  // No remote content, ever.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const isOwnFile = url.startsWith('file:');
    const isDevServer = IS_DEV && url.startsWith(DEV_SERVER_URL);
    if (!isOwnFile && !isDevServer) event.preventDefault();
  });

  void loadRenderer(win);
  return win;
}

// ---------------------------------------------------------------------------
// IPC handlers — all fs + claim parsing happens here. The renderer mostly
// sends/receives plain, validated data rather than filesystem paths; the two
// exceptions (a drag-and-drop open path, the export save path echoed back
// for the toast/"open folder" actions) are documented on lastExportedPath
// above and re-validated here rather than trusted as-is.
// ---------------------------------------------------------------------------

interface ClaimSummaryDto {
  claimId: string;
  formType: FormType;
  patientName: string;
  total: number;
  warningCount: number;
}

interface OpenClaimResult {
  sessionId: string;
  /**
   * The resolved absolute path of the opened file. A deliberate, narrow
   * widening of "the renderer never sees a main-resolved filesystem path"
   * (see this file's top comment): tabs need it to detect "reopen the file
   * this tab already has open" purely client-side and to remember a closed
   * tab's path for Ctrl+Shift+T (docs/TABS_BUILD_PLAN.md §2b) — it is never
   * used for anything but re-issuing this same openClaim call.
   */
  filePath: string;
  fileName: string;
  source: 'json' | 'x12';
  summaries: ClaimSummaryDto[];
}

/**
 * Field-level DTO for the renderer's inspector drawer — everything the
 * design's box-tagged field groups (Patient / Insured / Providers /
 * Diagnoses / Service lines), Reconciliation group, and raw view need, and
 * nothing else (no filesystem path, no full Claim object with its `raw`
 * Record<string, unknown> escaping typed shape — that's flattened to
 * `rawText` here instead). Every field is a plain string/number/boolean —
 * no optional properties — so this survives structured-clone across the IPC
 * bridge without ambiguity.
 */
interface ClaimDetailDto {
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
    /** Σ of serviceLines[].charge, rounded the same way validateClaim's reconciliation check rounds (integer cents) so this never shows a false mismatch from float drift. */
    sumOfLineCharges: number;
    /** totalCharge - sumOfLineCharges, in dollars; 0 when they reconcile. */
    delta: number;
  };
  warnings: Array<{ code: string; severity: WarningSeverity; message: string }>;
  /** Pretty-printed `claim.raw` — the source's original key/values, for the inspector's "Raw JSON fields" / "Raw 837 segments" view. */
  rawText: string;
}

/** Projects a full Claim into the flat, pre-composed ClaimDetailDto the inspector renders. Composing names/addresses here (rather than in the renderer) keeps the renderer a pure view layer over already-formatted strings. */
function buildClaimDetail(claim: Claim): ClaimDetailDto {
  // Same integer-cents rounding validateClaim (src/sources/json/jsonClaimSource.ts)
  // uses for its charge-total-mismatch warning, so this delta and that
  // warning always agree.
  const sumCents = claim.serviceLines.reduce((acc, line) => acc + Math.round(line.charge * 100), 0);
  const totalCents = Math.round(claim.totals.totalCharge * 100);

  return {
    claimId: claim.claimId,
    claimFormRaw: claim.claimFormRaw,
    formType: claim.formType,
    patient: {
      name: composeName(claim.patient.name),
      dob: claim.patient.dob,
      sex: claim.patient.sex,
      address: composeAddressLine(claim.patient.address),
      phone: claim.patient.phone,
      relationshipToInsured: claim.patient.relationshipToInsured,
      accountNumber: claim.patient.accountNumber,
    },
    insured: {
      name: composeName(claim.insured.name),
      memberId: claim.insured.memberId,
      group: claim.insured.group,
      plan: claim.insured.plan,
      dob: claim.insured.dob,
      sex: claim.insured.sex,
      address: composeAddressLine(claim.insured.address),
      employer: claim.insured.employer,
    },
    payer: {
      name: claim.payer.name,
      id: claim.payer.id,
      address: composeAddressLine(claim.payer.address),
    },
    providers: {
      billing: {
        name: claim.billingProvider.name,
        npi: claim.billingProvider.npi,
        taxId: claim.billingProvider.taxId,
        taxIdType: claim.billingProvider.taxIdType,
        address: composeAddressLine(claim.billingProvider.address),
        phone: claim.billingProvider.phone,
        taxonomy: claim.billingProvider.taxonomy,
      },
      rendering: {
        name: composeName(claim.renderingProvider.name),
        npi: claim.renderingProvider.npi,
        taxonomy: claim.renderingProvider.taxonomy,
      },
      referring: claim.referringProvider
        ? { name: composeName(claim.referringProvider.name), npi: claim.referringProvider.npi, id: claim.referringProvider.id }
        : null,
      facility: claim.facility
        ? { name: claim.facility.name, npi: claim.facility.npi, address: composeAddressLine(claim.facility.address) }
        : null,
    },
    diagnoses: claim.diagnoses.map((d) => ({ pointer: d.pointer, ordinal: d.ordinal, code: d.code })),
    serviceLines: claim.serviceLines.map((line, i) => ({
      line: i + 1,
      dates: line.thruDate === '' || line.thruDate === line.fromDate ? line.fromDate : `${line.fromDate} - ${line.thruDate}`,
      procCode: line.procCode,
      modifiers: line.modifiers.join(' '),
      diagPointers: line.diagPointers.join(''),
      charge: line.charge,
      units: line.units,
      revenueCode: line.revenueCode ?? '',
      revenueDescription: line.revenueDescription ?? '',
      toothNumbers: line.toothNumbers ?? '',
      toothSurfaces: line.toothSurfaces ?? '',
    })),
    totals: {
      totalCharge: claim.totals.totalCharge,
      amountPaid: claim.totals.amountPaid,
      sumOfLineCharges: sumCents / 100,
      delta: (totalCents - sumCents) / 100,
    },
    warnings: claim.warnings.map((w) => ({ code: w.code, severity: w.severity, message: w.message })),
    rawText: JSON.stringify(claim.raw, null, 2),
  };
}

/** dialog.showOpenDialog/showSaveDialog have distinct (window, options) vs (options)-only overloads — BrowserWindow.fromWebContents can return null, so this picks the right one instead of passing `undefined` where a BaseWindow is required. */
function showOpenDialog(win: BrowserWindow | null, options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

function showSaveDialog(win: BrowserWindow | null, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
}

/**
 * Whether this run could possibly be the real, distributed, electron-builder
 * asar-packed app — i.e. the thing an end user actually installs and runs
 * with a real claim file, as opposed to any of the several ways a
 * developer/CI runs this code (`npm run dev` against the Vite dev server,
 * `npm start` against the built `dist/`, or the Playwright E2E harness in
 * e2e/app.spec.ts, which also launches the plain `electron` binary against
 * `dist/electron/main.js`).
 *
 * Deliberately NOT `IS_DEV`: `IS_DEV` is `false` for `npm start` (see its own
 * doc comment above) precisely because `dist/renderer/index.html` already
 * exists then — and `npm run verify` runs `npm run build` (which produces
 * that same `dist/renderer/index.html`) immediately before `npm run
 * test:e2e`, so `IS_DEV` is `false` for the E2E run too. Gating the seams
 * below on `IS_DEV` would therefore make CLAIM_VIEWER_E2E_OPEN/SAVE inert
 * during the E2E suite itself, breaking it. `app.isPackaged`, by contrast,
 * is `false` for every one of those unpacked-electron-binary cases and only
 * ever `true` for the asar-packed output a user installs — exactly the one
 * case these test-only seams must never be reachable in.
 */
function isRealPackagedApp(): boolean {
  return app.isPackaged;
}

/**
 * Cursor into the `;`-separated CLAIM_VIEWER_E2E_OPEN queue (see
 * nextE2EOpenPath below) — module-level so it advances across multiple
 * dialog:openClaim invocations within one launched app, which is exactly
 * the "open file A, then open file B" multi-tab scenario the queue exists
 * for (docs/TABS_BUILD_PLAN.md §2).
 */
let e2eOpenQueueIndex = 0;

/**
 * TEST-ONLY SEAM (extended for tabs — approved amendment to guardrail §1.5,
 * see docs/TABS_BUILD_PLAN.md §2): CLAIM_VIEWER_E2E_OPEN may be a single
 * path (unchanged, still works) or a `;`-separated list, consumed one entry
 * per dialog:openClaim call so a test can open several files in sequence
 * without a native picker. Once the queue is exhausted, the last entry is
 * sticky (re-opening it lands on openClaimAtPath's existing-session dedupe,
 * so a test that calls open() more times than it supplied paths just
 * re-focuses the last one). The `!isRealPackagedApp()` gate below is
 * byte-for-byte the same guard as before this change — only the value's
 * shape (single path -> queue) is new.
 */
function nextE2EOpenPath(): string | undefined {
  const raw = !isRealPackagedApp() ? process.env['CLAIM_VIEWER_E2E_OPEN'] : undefined;
  if (!raw) return undefined;
  const parts = raw.split(';').filter((p) => p !== '');
  if (parts.length === 0) return undefined;
  const idx = Math.min(e2eOpenQueueIndex, parts.length - 1);
  e2eOpenQueueIndex += 1;
  return parts[idx];
}

const OPEN_FILE_EXTENSIONS = new Set(['.json', '.dat', '.edi', '.txt', '.837']);

/** Same extension allow-list as the native open dialog's file filter (below), enforced again here because this is also the entry point for the drag-and-drop IPC, where the renderer hands over a path a user dropped rather than one a filtered OS dialog already constrained. */
function hasAllowedOpenExtension(filePath: string): boolean {
  return OPEN_FILE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * Opens for a not-yet-open path that are still in flight (read + parse not
 * finished, no `sessions` entry committed yet), keyed by resolved path —
 * see openClaimAtPath's doc comment for why this exists.
 */
const inFlightOpensByPath = new Map<string, Promise<OpenClaimResult>>();

/**
 * Shared by every dialog:openClaim path — the native picker, the E2E seam,
 * and a drag-and-drop path: read, parse, and adopt `filePath` as a new
 * session — UNLESS a session for this same resolved path is already open
 * (or already being opened), in which case that session is returned as-is
 * (no re-read, re-parse, or duplicate entry). This is the "open the same
 * file twice focuses the existing tab, not a duplicate" behavior
 * (docs/TABS_BUILD_PLAN.md §2b) — the renderer decides "is this already one
 * of my tabs?" purely by comparing the returned `sessionId` to its own tab
 * list, so the dedupe only has to happen here, once, by path.
 *
 * The `inFlightOpensByPath` map closes a real race the committed-`sessions`
 * check alone can't: two concurrent `dialog:openClaim` calls for the SAME
 * brand-new path (e.g. a script/E2E firing Open twice back-to-back, faster
 * than one read+parse completes) would otherwise both miss the `sessions`
 * loop below — neither has committed yet — and each independently create
 * its own session for the same file. Routing every not-yet-committed open
 * through the SAME in-flight promise means the second caller gets back
 * the first caller's sessionId instead.
 */
async function openClaimAtPath(filePath: string): Promise<OpenClaimResult> {
  const resolvedPath = resolve(filePath);
  for (const [sessionId, existing] of sessions) {
    if (existing.filePath === resolvedPath) {
      return {
        sessionId,
        filePath: resolvedPath,
        fileName: existing.fileName,
        source: existing.source,
        summaries: existing.claims.map(claimSummary),
      };
    }
  }

  const inFlight = inFlightOpensByPath.get(resolvedPath);
  if (inFlight) return inFlight;

  const task = (async (): Promise<OpenClaimResult> => {
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Could not read "${basename(filePath)}": ${(err as Error).message}`);
    }

    let loaded: { source: 'json' | 'x12'; claims: Claim[] };
    try {
      loaded = loadClaims(text);
    } catch (err) {
      // Re-throw as a plain Error: ipcMain.handle only reliably serializes
      // Error.message across the bridge, and ClaimParseError's friendly
      // message is exactly what the renderer should show.
      throw new Error(err instanceof ClaimParseError ? err.message : (err as Error).message);
    }

    const sessionId = randomUUID();
    const fileName = basename(filePath);
    sessions.set(sessionId, { filePath: resolvedPath, fileName, source: loaded.source, claims: loaded.claims });
    return {
      sessionId,
      filePath: resolvedPath,
      fileName,
      source: loaded.source,
      summaries: loaded.claims.map(claimSummary),
    };
  })();

  inFlightOpensByPath.set(resolvedPath, task);
  try {
    return await task;
  } finally {
    inFlightOpensByPath.delete(resolvedPath);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('dialog:openClaim', async (event: IpcMainInvokeEvent, droppedPath: unknown): Promise<OpenClaimResult | null> => {
    // Drag-and-drop open (welcome/preview pane, spec §4): the renderer
    // resolves a real filesystem path for a dropped File via
    // claimApi.getPathForFile (electron's webUtils.getPathForFile) and
    // passes it straight through as this optional argument, skipping the
    // native dialog entirely — main re-validates the extension itself
    // rather than trusting the renderer's own drop filter, since the
    // renderer is treated as untrusted input throughout this file.
    if (typeof droppedPath === 'string' && droppedPath !== '') {
      if (!hasAllowedOpenExtension(droppedPath)) {
        throw new Error('Unsupported file type. Drop a .json, .dat, .edi, .txt, or .837 claim file.');
      }
      return openClaimAtPath(droppedPath);
    }

    const win = BrowserWindow.fromWebContents(event.sender);

    // --- TEST-ONLY SEAM ----------------------------------------------------
    // Playwright/Electron E2E tests (e2e/app.spec.ts) can't drive the native
    // OS file-picker. When CLAIM_VIEWER_E2E_OPEN is set to a file path, skip
    // dialog.showOpenDialog and use that path directly — everything below
    // this point (readFile -> loadClaims -> sessions.set) is the exact
    // same code the real dialog handler runs. Gated on !isRealPackagedApp()
    // in addition to the env var (see that function's doc comment): the env
    // var alone was reachable, in principle, by any environment variable an
    // attacker could set ahead of launching the packaged .exe, so presence
    // of the var was never sufficient on its own to prove this is a test
    // run. With the added guard the seam is provably unreachable in the
    // asar-packed app regardless of what's in the environment.
    const e2eOpenPath = nextE2EOpenPath();
    let filePath: string;
    if (e2eOpenPath) {
      filePath = e2eOpenPath;
    } else {
      const result = await showOpenDialog(win, {
        title: 'Open a claim file',
        properties: ['openFile'],
        filters: [
          { name: 'Claim files', extensions: ['json', 'dat', 'edi', 'txt', '837'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      filePath = result.filePaths[0]!;
    }
    // --- end TEST-ONLY SEAM --------------------------------------------------

    return openClaimAtPath(filePath);
  });

  ipcMain.handle('claim:getPdf', async (_event: IpcMainInvokeEvent, sessionId: unknown, index: unknown): Promise<Uint8Array> => {
    const claim = getSessionClaim(sessionId, index);
    return renderClaim(claim);
  });

  // Read-only inspector data for the renderer's inspector drawer (see
  // ClaimDetailDto above). Same validated-index pattern as claim:getPdf —
  // getSessionClaim throws a plain, renderer-safe Error for "no such session"
  // or an out-of-range index.
  ipcMain.handle('claim:getDetail', async (_event: IpcMainInvokeEvent, sessionId: unknown, index: unknown): Promise<ClaimDetailDto> => {
    const claim = getSessionClaim(sessionId, index);
    return buildClaimDetail(claim);
  });

  ipcMain.handle('dialog:exportPdf', async (event: IpcMainInvokeEvent, sessionId: unknown, index: unknown): Promise<string | null> => {
    const claim = getSessionClaim(sessionId, index);
    const win = BrowserWindow.fromWebContents(event.sender);

    // --- TEST-ONLY SEAM ----------------------------------------------------
    // Mirrors the dialog:openClaim seam above: when CLAIM_VIEWER_E2E_SAVE is
    // set to a file path, skip dialog.showSaveDialog and export straight to
    // that path — the render + writeFileAtomic below is identical to the
    // real save-dialog path. Gated on !isRealPackagedApp() too, so it's
    // unreachable in the asar-packed app regardless of the environment.
    const e2eSavePath = !isRealPackagedApp() ? process.env['CLAIM_VIEWER_E2E_SAVE'] : undefined;
    let filePath: string;
    if (e2eSavePath) {
      filePath = e2eSavePath;
    } else {
      const result = await showSaveDialog(win, {
        title: `Export this claim (${claim.claimId || 'claim'}) as PDF`,
        defaultPath: defaultExportFileName(claim),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return null;
      filePath = result.filePath;
    }
    // --- end TEST-ONLY SEAM --------------------------------------------------

    const bytes = await renderClaim(claim);
    await writeFileAtomic(filePath, Buffer.from(bytes));
    lastExportedPath = filePath;
    return filePath;
  });

  // "Open containing folder" / "Open PDF" toast actions after a successful
  // export (design ClaimViewer_v2.dc.html:776-777 / spec §7). Takes no path
  // from the renderer — see lastExportedPath's doc comment — only a mode.
  ipcMain.handle('shell:openExport', async (_event: IpcMainInvokeEvent, mode: unknown): Promise<void> => {
    if (!lastExportedPath) throw new Error('No exported file to open yet.');
    if (mode === 'folder') {
      shell.showItemInFolder(lastExportedPath);
      return;
    }
    if (mode === 'file') {
      const err = await shell.openPath(lastExportedPath);
      if (err) throw new Error(err);
      return;
    }
    throw new Error(`Invalid open mode: ${String(mode)}.`);
  });

  // Drops one tab's session — its parsed claims (PHI) leave main-process
  // memory immediately, same "cleared on close" guarantee the old
  // single-session model gave on window close, now scoped per tab
  // (docs/TABS_BUILD_PLAN.md §2). Closing a sessionId that doesn't exist
  // (e.g. a placeholder tab whose open was cancelled before it ever got one)
  // is a harmless no-op.
  ipcMain.handle('session:close', async (_event: IpcMainInvokeEvent, sessionId: unknown): Promise<void> => {
    if (typeof sessionId === 'string') sessions.delete(sessionId);
  });
}

function getSessionClaim(sessionId: unknown, index: unknown): Claim {
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('No claim file is open.');
  const session = sessions.get(sessionId);
  if (!session) throw new Error('No claim file is open.');
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= session.claims.length) {
    throw new Error(`Invalid claim index: ${String(index)}.`);
  }
  return session.claims[index]!;
}

/**
 * Default export filename: "<billing provider> - <service date>.pdf",
 * e.g. "NATIONWIDE CHILDRENS HOSPITAL - 2026-06-03.pdf".
 *
 * Stays PHI-free by design — the patient name is deliberately NOT used, so an
 * export sitting in a folder listing, a recent-files list or a backup doesn't
 * identify a member. Provider + date of service is what negotiators file by.
 *
 * Any part the claim doesn't carry is skipped, and if none are available it
 * falls back to the claim id so the file is never named just ".pdf".
 */
function defaultExportFileName(claim: Claim): string {
  const parts = [
    sanitizeNamePart(claim.billingProvider.name),
    sanitizeNamePart(earliestServiceDate(claim)),
  ].filter((p) => p !== '');
  const base = parts.length > 0 ? parts.join(' - ') : `claim_${sanitizeFileNamePart(claim.claimId) || 'claim'}`;
  return `${base}.pdf`;
}

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

/**
 * Filename-safe version of a name/provider that KEEPS spaces so the result
 * still reads naturally ("MILLER THEODORE Z"). Strips the characters Windows
 * forbids in a filename, the comma composeName inserts, and any control
 * characters, then collapses whitespace.
 */
function sanitizeNamePart(value: string): string {
  return value
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|,'.includes(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

/** Earliest service-line date on the claim (YYYY-MM-DD, already normalized by the sources), or '' when no line carries one. */
function earliestServiceDate(claim: Claim): string {
  const dates = claim.serviceLines.map((l) => l.fromDate).filter((d) => d !== '');
  if (dates.length === 0) return '';
  return dates.reduce((a, b) => (a < b ? a : b));
}

/**
 * Removes any `.<name>.*.tmp` sibling already sitting in `dir` before this
 * export writes its own — the temp-file naming writeFileAtomic uses below.
 * A process kill between that write and its rename (see writeFileAtomic)
 * leaves exactly such a file behind, visibly, in the user-chosen PHI export
 * directory; without this sweep it sits there forever, since nothing else
 * ever revisits that directory. Best-effort: a directory-read failure here
 * (e.g. the target dir was removed) must never block the export itself.
 */
async function sweepOrphanTempFiles(dir: string, targetBaseName: string): Promise<void> {
  const prefix = `.${targetBaseName}.`;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix) && name.endsWith('.tmp'))
      .map((name) => unlink(join(dir, name)).catch(() => {})),
  );
}

/** Write-then-rename so a killed/interrupted export never leaves a half-written PDF at the target path. Sweeps any orphaned temp file a previous interrupted export to this same target left behind first (see sweepOrphanTempFiles). */
async function writeFileAtomic(targetPath: string, data: Buffer): Promise<void> {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  await sweepOrphanTempFiles(dir, base);
  const tempPath = join(dir, `.${base}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, data);
    await rename(tempPath, targetPath);
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

void app.whenReady().then(() => {
  installOfflineKillSwitch();
  // The File/View/Help menu bar is rendered in-page (src/renderer/index.html
  // #menubar + main.ts's setupMenus/runAction) rather than as a native
  // Electron Menu, so there's no OS-level accelerator table to keep in sync
  // with the renderer's own keydown handler — null keeps Electron from
  // installing its own default menu (which would add unwanted native
  // File/Edit/View items above this window).
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  sessions.clear();
  if (process.platform !== 'darwin') app.quit();
});
