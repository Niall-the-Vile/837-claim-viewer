# Roadmap — deferred features

Features that are agreed-on but deliberately **not** implemented yet, so a
later session (or a fresh maintainer) can pick them up without re-deriving the
design. Current shipped scope is the single-claim viewer described in
`PLAN_REVISION_v2_JSON.md` + `UI_REQUIREMENTS_v2_single_claim.md`.

---

## 1. Tabs — multiple bills open at once

**Requested 2026-07-27.** Today the app holds exactly one open file; opening
another replaces it. The ask is a tab strip so several bills can be open
simultaneously and switched between (distinct from the existing "Claim in this
837 file" stepper, which pages through claims *inside one* file).

**Assessed difficulty: moderate.** The architecture favours it — claims are
immutable, source-agnostic and index-addressed — so it is mostly plumbing plus
one renderer state refactor. No parser or renderer changes at all.

### What it touches

**Main process (`electron/main.ts`)**
- `currentSession: ClaimSession | null` → a keyed collection
  (`Map<string, ClaimSession>`) plus an active-session id.
- Every claim IPC (`claim:getPdf`, `claim:getDetail`, `dialog:exportPdf`) takes
  a `sessionId` alongside the claim index; validate it exactly like the index
  is validated today (`getSessionClaim`).
- `dialog:openClaim` returns a new `sessionId` instead of replacing state.
- New `session:close(sessionId)` handler; drop the session's claims so its PHI
  leaves memory immediately (keep the "cleared on window close" guarantee, but
  per-tab).

**Preload (`electron/preload.ts`)** — extend the frozen `claimApi` surface with
the session id parameter + `closeSession`. Note the e2e asserts the exact key
list (`e2e/app.spec.ts`), so update that array in the same change.

**Renderer (`src/renderer/`)** — the real work. The single `state` object
becomes per-tab: each tab owns its `pdfDoc`, `pageNum`, `pageCount`, `zoom`,
`zoomMode`, `currentIndex`, `summaries`, `fileName`. Keep one shared inspector
/ toolbar reading from the active tab. Add a tab strip (reuse existing CSS
tokens — no new design language), each tab showing the file name + a close
button, with overflow handling for many tabs.

**Shortcuts** — `Ctrl+Tab` / `Ctrl+Shift+Tab` to cycle, `Ctrl+W` closes the
*tab* (today it closes the file), `Ctrl+1..9` jump to a tab. Update the
shortcuts sheet (`KEY_GROUPS` in `src/renderer/main.ts`) and the File menu.

**Tests** — extend the e2e to open two files, assert both tabs exist,
switching re-renders the right preview, and closing one leaves the other
intact. The PHI-at-rest test should also cover a closed tab's claims being
released.

### Design note
The approved v2 design (`docs/design/ClaimViewer_v2.dc.html`) is explicitly a
single-claim viewer, so the tab strip is genuinely new chrome. Either build it
from the existing tokens or run a Claude Design pass for the strip before
implementing.

### Risk / watch-outs
- Memory: pdf.js documents already leak today — there is no `.destroy()` call
  anywhere in `src/renderer/main.ts`, so every claim step, re-open and
  `closeFile` abandons the previous `PDFDocumentProxy`. Fix the root cause with
  a single `setActivePdfDoc(tab, doc)` helper that awaits `oldDoc.destroy()`
  before assigning, routed through on every assignment (claim step, file open,
  close, tab switch) — the tabs case (releasing a background tab's `pdfDoc`) is
  the same mechanism, not a separate problem.
- **The canvas is shared and stays shared** — there is exactly one
  `<canvas id="pdfCanvas">` and `renderPdfPageNow` hard-references it. The
  render serialization (`renderRunning`/`renderDirty`/`renderDirtyFade`) stays
  **module-level**, not per-tab — moving it per-tab would let two tabs' render
  loops target the same canvas concurrently and reintroduce the pdf.js
  "Cannot use the same canvas during multiple render() operations" error the
  serialization was added to fix. Instead, stamp each render request with the
  requesting tab id, have `renderPdfPageNow` re-check the active tab before
  each step and bail if it's no longer active, and cancel any in-flight
  `page.render()` from an outgoing tab via `RenderTask.cancel()` on tab switch.
  (See `TABS_BUILD_PLAN.md` §2 watch-out (b) for the full mechanism and the
  required E2E.)
