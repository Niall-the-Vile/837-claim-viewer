import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { ClaimSummaryDto, ClaimDetailDto } from '../../electron/preload.js';

/**
 * The `Screen`/`ZoomMode`/`TabState` type definitions live here (moved out
 * of tabs.ts) rather than there, even though tabs.ts is otherwise their
 * natural home: tabs.ts imports dom.ts, whose module-level `requireEl(...)`
 * calls need a real `document` — fine for the app itself (always runs
 * inside Electron's renderer), but it means any file that imports so much
 * as a *type* from tabs.ts drags that whole module into the same TypeScript
 * program, and test/tabState.test.ts (this module's own unit test, run
 * under plain Node — see the getDocumentImpl comment below) is typechecked
 * under tsconfig.json, which has no DOM lib at all. tabs.ts re-exports
 * these unchanged, so every other importer (main.ts, preview.ts,
 * inspector.ts) is unaffected.
 */
export type Screen = 'welcome' | 'loading' | 'error' | 'workspace';
export type ZoomMode = 'manual' | 'fit-page' | 'fit-width';

export interface TabState {
  tabId: string;
  sessionId: string | null;
  status: 'unloaded' | 'loading' | 'ready' | 'error';
  filePath: string;
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

  errorMessage: string;
}

/**
 * pdf.js document lifecycle — THE single place a tab's `pdfDoc` is ever
 * created or reassigned. pdf.js documents leaked before tabs existed at all
 * (every claim step / re-open / close abandoned the previous
 * PDFDocumentProxy with no destroy call anywhere) — this fixes the root
 * cause, not just the tabs symptom, by awaiting the outgoing document's
 * real destroy() before adopting the new one. Every assignment site (claim
 * step, file open, tab close, tab deactivate/background-release — see
 * src/renderer/main.ts) routes through setActivePdfDoc below.
 *
 * Split out of tabs.ts (docs/AUDIT_BUILD1.md coverage gap #1: "the §2
 * mandated pdf.js lifecycle verification was never built... no injectable
 * getDocument seam") so this module can be unit-tested with a fake
 * create/destroy-counting document loader, without ever pulling in tabs.ts's
 * DOM-coupled pieces (dom.ts's `requireEl` calls run at module load and need
 * a real `document`, which vitest's plain Node environment doesn't have —
 * this file deliberately imports nothing from dom.ts, only a `TabState`
 * *type* from tabs.ts, which is erased at compile time and creates no
 * runtime circular dependency). See test/tabState.test.ts.
 */

/** Matches `pdfjsLib.getDocument`'s shape for the one call site here — narrowed to exactly what this module needs (bytes in, a loading task out), so a test's fake loader doesn't have to implement pdf.js's much larger real signature. */
export type GetDocumentFn = (params: { data: Uint8Array }) => PDFDocumentLoadingTask;

/**
 * `null` until either a test overrides it (__setGetDocumentForTests) or the
 * real implementation is lazily resolved on first actual use
 * (realGetDocumentImpl below). Deliberately NOT `import`ed/initialized
 * eagerly at module top-level: `pdfjs-dist`'s browser build throws at
 * import time in a plain Node environment with no DOM globals (`DOMMatrix`
 * is not defined — confirmed empirically running `vitest` against this
 * module before this fix) — vitest's default environment has no jsdom, and
 * this project has none configured (see package.json), so an eager
 * top-level `import * as pdfjsLib from 'pdfjs-dist'` here would make this
 * module — and therefore the whole point of extracting it, a unit-testable
 * pdf.js lifecycle seam (docs/AUDIT_BUILD1.md coverage gap #1) — impossible
 * to import from a test at all. Lazy-resolving it only when actually needed
 * means a test that always calls __setGetDocumentForTests before the first
 * loadPdfDocument() never touches real pdf.js, while production code (which
 * always runs inside Electron's renderer, i.e. always has a real DOM) still
 * gets the exact same real implementation it always did, resolved once and
 * cached.
 */
let getDocumentImpl: GetDocumentFn | null = null;
let realImplPromise: Promise<GetDocumentFn> | null = null;

async function realGetDocumentImpl(): Promise<GetDocumentFn> {
  if (!realImplPromise) {
    realImplPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      // `?url` gives Vite's resolved asset URL for the worker file (bundled
      // and copied into dist/renderer at build time) instead of trying to
      // parse it as a JS module — this is what keeps the pdf.js worker
      // fully local/offline; it is never fetched from a CDN. Set here
      // (rather than preview.ts) because this module owns the one place
      // pdf.js documents are ever created (loadPdfDocument below), and
      // workerSrc must be set before the first real getDocument() call.
      const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjsLib.getDocument;
    })();
  }
  return realImplPromise;
}

/**
 * TEST-ONLY SEAM: substitutes a fake counting pdf.js loader so a unit test
 * can assert create/destroy pairs balance (docs/AUDIT_BUILD1.md's mandated
 * lifecycle test) without touching real pdf.js/worker machinery. Never
 * called from any renderer runtime code path — only from test/tabState.test.ts.
 */
export function __setGetDocumentForTests(fn: GetDocumentFn): void {
  getDocumentImpl = fn;
}

/** Restores the lazy-real-implementation default after a test that called __setGetDocumentForTests. */
export function __resetGetDocumentForTests(): void {
  getDocumentImpl = null;
}

/**
 * pdf.js's actual `destroy()` lives on the `PDFDocumentLoadingTask` that
 * `getDocument()` returns, NOT on the `PDFDocumentProxy` its `.promise`
 * resolves to (the proxy has no destroy method at all in this pdf.js
 * version). `TabState.pdfDoc` is typed as the proxy per
 * docs/TABS_BUILD_PLAN.md §2's literal interface — that's the only part the
 * rest of the renderer (preview.ts's getPage/render calls) ever needs. This
 * map is the bridge: loadPdfDocument() below registers each proxy's owning
 * loading task, and setActivePdfDoc() looks it up to call the task's real
 * destroy() when a tab's pdfDoc is replaced or cleared.
 */
const loadingTasksByDoc = new WeakMap<PDFDocumentProxy, PDFDocumentLoadingTask>();

/** Loads a claim's PDF bytes into a fresh pdf.js document. pdf.js may transfer/detach the buffer it's given; hand it a fresh copy so re-rendering (stepping back and forth, zooming) never operates on a stale one. */
export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const getDoc = getDocumentImpl ?? (await realGetDocumentImpl());
  const loadingTask = getDoc({ data: bytes.slice() });
  const doc = await loadingTask.promise;
  loadingTasksByDoc.set(doc, loadingTask);
  return doc;
}

export async function setActivePdfDoc(tab: TabState, doc: PDFDocumentProxy | null): Promise<void> {
  const old = tab.pdfDoc;
  if (old && old !== doc) {
    const loadingTask = loadingTasksByDoc.get(old);
    loadingTasksByDoc.delete(old);
    try {
      if (loadingTask) await loadingTask.destroy();
    } catch {
      // pdf.js destroy() is best-effort cleanup; a failure here must never
      // block adopting the new document (or nulling it out on close).
    }
  }
  tab.pdfDoc = doc;
}
