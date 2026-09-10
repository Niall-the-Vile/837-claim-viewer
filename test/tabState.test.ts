import { describe, it, expect, afterEach } from 'vitest';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import { loadPdfDocument, setActivePdfDoc, __setGetDocumentForTests, __resetGetDocumentForTests, type GetDocumentFn, type TabState } from '../src/renderer/tabState.js';

/**
 * The §2 mandated pdf.js lifecycle test (docs/TABS_BUILD_PLAN.md §2 watch-out
 * (a), docs/AUDIT_BUILD1.md coverage gap #1: "no injectable getDocument seam
 * today ... no test/ file references setActivePdfDoc/pdfDoc/renderer-tabs at
 * all"). Drives the real loadPdfDocument/setActivePdfDoc pair against a fake,
 * counting pdf.js loader (tabState.ts's __setGetDocumentForTests seam) —
 * never against real pdf.js/worker machinery — and asserts create/destroy
 * pairs balance across both scenarios docs/TABS_BUILD_PLAN.md §2/§2b call
 * out explicitly: a 50-claim step sequence on one tab, and a 10-tab
 * open/switch(background-release)/close sequence.
 *
 * This only proves the PRIMITIVE (setActivePdfDoc's destroy-before-replace)
 * is correct when called as designed — it does not, by itself, prove every
 * renderer call site actually calls it at the right time (that was
 * docs/AUDIT_BUILD1.md MUST FIX #1's bug: tabs.ts's createTab wrote
 * state.activeTabId itself, so main.ts's activateTabById never even
 * DECIDED it needed to release the outgoing tab — the primitive was never
 * reached at all). That orchestration-level regression is covered by
 * e2e/tabs.spec.ts's background-release test instead, since it requires the
 * full tab-activation flow (tabs.ts + main.ts together) to reproduce.
 */

interface FakeDocCounts {
  created: number;
  destroyed: number;
  /** created - destroyed at any instant — the invariant every scenario below asserts never exceeds the expected ceiling. */
  live: number;
}

/** A fake pdf.js loader: each call returns a unique fake "document" (so the real WeakMap-by-identity in tabState.ts behaves exactly as it does against real PDFDocumentProxy instances) backed by a loading task whose destroy() is counted and idempotent (matches pdf.js's own real destroy() being safe to await from setActivePdfDoc's best-effort try/catch). */
function makeFakeGetDocument(): { getDocument: GetDocumentFn; counts: FakeDocCounts } {
  const counts: FakeDocCounts = { created: 0, destroyed: 0, live: 0 };
  const getDocument: GetDocumentFn = () => {
    counts.created += 1;
    counts.live += 1;
    let alreadyDestroyed = false;
    const doc = { __fakeDocId: counts.created } as unknown as PDFDocumentProxy;
    const task: PDFDocumentLoadingTask = {
      promise: Promise.resolve(doc),
      destroy: async () => {
        if (!alreadyDestroyed) {
          alreadyDestroyed = true;
          counts.destroyed += 1;
          counts.live -= 1;
        }
      },
    } as unknown as PDFDocumentLoadingTask;
    return task;
  };
  return { getDocument, counts };
}

function makeFakeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    tabId: 'tab-test',
    sessionId: 'session-test',
    status: 'ready',
    filePath: 'C:\\claims\\fake.json',
    fileName: 'fake.json',
    source: 'json',
    summaries: [],
    currentIndex: 0,
    detail: null,
    pdfDoc: null,
    pageNum: 1,
    pageCount: 1,
    zoom: 1,
    zoomMode: 'fit-page',
    errorMessage: '',
    correctedClaimStatus: 'none',
    ...overrides,
  };
}

afterEach(() => {
  __resetGetDocumentForTests();
});

describe('tabState: pdf.js document lifecycle (fake-counting seam)', () => {
  it('stepping through 50 claims on one tab never holds more than 1 live document, and destroys every prior one', async () => {
    const { getDocument, counts } = makeFakeGetDocument();
    __setGetDocumentForTests(getDocument);

    const tab = makeFakeTab();
    for (let i = 0; i < 50; i++) {
      const doc = await loadPdfDocument(new Uint8Array([i]));
      await setActivePdfDoc(tab, doc);
      expect(counts.live).toBe(1); // the just-replaced previous document must already be destroyed by this point
    }

    expect(counts.created).toBe(50);
    expect(counts.destroyed).toBe(49); // the 50th (still tab.pdfDoc) is legitimately still live
    expect(counts.live).toBe(1);

    // Closing the tab (setActivePdfDoc(tab, null), as tabs.ts's closeTab does) releases the last one too.
    await setActivePdfDoc(tab, null);
    expect(counts.destroyed).toBe(50);
    expect(counts.live).toBe(0);
    expect(tab.pdfDoc).toBeNull();
  });

  it('a 10-tab open -> background-release-on-switch -> close sequence never holds more than 1 live document at a time', async () => {
    const { getDocument, counts } = makeFakeGetDocument();
    __setGetDocumentForTests(getDocument);

    const tabs = Array.from({ length: 10 }, (_, i) => makeFakeTab({ tabId: `tab-${i}` }));

    // "Open" each tab in turn, releasing the previously-active one first —
    // mirrors main.ts's activateTabById: cancel/release the outgoing tab's
    // document (background-tab memory release, §2b) before the newly
    // active tab gets its own.
    for (let i = 0; i < tabs.length; i++) {
      if (i > 0) {
        await setActivePdfDoc(tabs[i - 1]!, null); // background release of the tab being switched away from
        expect(counts.live).toBe(0);
      }
      const doc = await loadPdfDocument(new Uint8Array([i]));
      await setActivePdfDoc(tabs[i]!, doc);
      expect(counts.live).toBe(1); // exactly the newly-active tab's document — §2b's "N open bills don't hold N rendered PDFs"
    }

    expect(counts.created).toBe(10);
    expect(counts.destroyed).toBe(9);

    // Close the one remaining active tab (the 10th).
    await setActivePdfDoc(tabs[9]!, null);
    expect(counts.created).toBe(10);
    expect(counts.destroyed).toBe(10);
    expect(counts.live).toBe(0);
  });

  it('reassigning the SAME document instance is a no-op (never destroys the document that is still in use)', async () => {
    const { getDocument, counts } = makeFakeGetDocument();
    __setGetDocumentForTests(getDocument);

    const tab = makeFakeTab();
    const doc = await loadPdfDocument(new Uint8Array([1]));
    await setActivePdfDoc(tab, doc);
    expect(counts.live).toBe(1);

    await setActivePdfDoc(tab, doc); // same reference — e.g. a redundant call site
    expect(counts.destroyed).toBe(0);
    expect(counts.live).toBe(1);
    expect(tab.pdfDoc).toBe(doc);
  });

  it('a destroy() rejection is swallowed (best-effort cleanup) and never blocks adopting the next document', async () => {
    let calls = 0;
    const flakyGetDocument: GetDocumentFn = () => {
      calls += 1;
      const doc = { __fakeDocId: calls } as unknown as PDFDocumentProxy;
      const task: PDFDocumentLoadingTask = {
        promise: Promise.resolve(doc),
        destroy: async () => {
          throw new Error('simulated pdf.js destroy() failure');
        },
      } as unknown as PDFDocumentLoadingTask;
      return task;
    };
    __setGetDocumentForTests(flakyGetDocument);

    const tab = makeFakeTab();
    const docA = await loadPdfDocument(new Uint8Array([1]));
    await setActivePdfDoc(tab, docA);
    const docB = await loadPdfDocument(new Uint8Array([2]));
    await expect(setActivePdfDoc(tab, docB)).resolves.toBeUndefined(); // must not throw even though docA's destroy() rejected
    expect(tab.pdfDoc).toBe(docB);
  });
});
