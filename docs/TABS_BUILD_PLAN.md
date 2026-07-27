# Tabs build — scheduled unattended run (10pm, 2026-07-27)

Execution plan for adding **multi-file tabs** to the Claim Viewer, verifying it
comprehensively, and cutting a new portable `.exe` — run unattended while Niall
is out. This document is the source of truth; the scheduled prompt just says
"execute this plan". It is Build 1 of `docs/BUILD_QUEUE.md`, and per that
document's header, **Build 1 is tonight's deliverable** — finishing it well beats
rushing into Build 2.

Repo: `C:\Users\Niall Yoder\Downloads\codes related docs\837-claim-viewer`

## 0. Ground truth before starting
- Feature spec + implementation sketch: **`docs/ROADMAP.md` §1** (read it first — it
  lists every file that changes and the watch-outs, kept in sync with §2 below).
- Current state: v2 shipped. `npm run verify` = typecheck (3 configs) + 104 vitest
  + build + 4 Playwright E2E, all green. Portable exe at `release/`. The repo is now
  a git repository (`git init` done in Build 0) with baseline tag `build-0-green` at
  commit `c1d4316` — use `docs/BUILD_QUEUE.md` rules 1-2 for checkpointing and
  rollback, not the old "leave the tree at the last green state" language (there was
  no way to do that before git; now there is).
- Delegate coding to **Sonnet** subagents (`model: sonnet`) — the user asked to
  keep usage down. Reviews/synthesis stay on the main model.

## 1. Guardrails — do not regress these
Each was a real bug or a deliberate decision; breaking one silently undoes prior work.
1. `[hidden] { display: none !important; }` in `style.css` — fixes a CSS specificity
   bug that let all state screens stack and menu dropdowns swallow toolbar clicks.
2. Inspector collapses via a `.collapsed` class, **never** the `hidden` attribute —
   it must stay in the accessibility tree (a11y fix).
3. Toast layout: `.toastBody` (message + actions) left, `.toastClose` × pinned
   top-right via `align-items: flex-start`.
4. Export filename stays **PHI-free**: `<billing provider> - <service date>.pdf`
   (Build 4.1 extends this with a claim ordinal — see `BUILD_QUEUE.md` 4.1 — the
   PHI-free property is preserved, not relaxed).
5. Offline kill-switch, sandbox/contextIsolation, and the `!app.isPackaged` gating of
   the E2E seams stay exactly as-is, **except** the one explicit, approved amendment
   in §2's main-process bullet (the `CLAIM_VIEWER_E2E_OPEN` seam grows from a single
   path to a `;`-separated queue — the gate itself is untouched byte-for-byte).
6. Enter-only animations for state screens / banner / menus (exit stays an instant
   `hidden` flip) so the E2E visibility assertions don't go flaky.
7. `prefers-reduced-motion` support stays.
8. Renderers (`src/render/**`) and parsers (`src/sources/**`) must not change at all
   — tabs is a shell/renderer concern only. **This guardrail applies to Build 1
   ONLY.** It is explicitly LIFTED for Builds 3, 4 and 6 in `docs/BUILD_QUEUE.md`,
   which modify those trees by design — see that document's rule 4 for the
   replacement constraint (goldens regenerated only via `UPDATE_GOLDENS=1`, never
   hand-edited, diffs explained in `BUILD_LOG.md`). Within Build 1 itself, this
   guardrail is absolute.
9. **No build may add a `userData` writer** (session/recent-files, notes, audit log)
   until the E2E profile-isolation prerequisite in §2e's first bullet has landed.
   This applies to §2e itself and to `BUILD_QUEUE.md` 5.1/5.2.

## 2. Phase 1 — implement (one Sonnet agent, for coherence)
Per-tab state spans main + preload + renderer, so a single agent owns the whole
vertical slice rather than splitting it.

**Item 0 — pure-move split first.** Before any tab-state work: a pure-move split of
`src/renderer/main.ts` into `dom.ts` (all `requireEl` handles), `tabs.ts`,
`preview.ts` (pdf.js load/render/zoom), `inspector.ts`, `overlays.ts` and
`shortcuts.ts`, leaving `main.ts` as init + wiring. **No behaviour change** —
`npm run verify` green on this commit alone, checkpointed (`BUILD_QUEUE.md` rule 2),
before tab work starts. `src/renderer/main.ts` is a single 1,604-line module with
module-level DOM handles, a module-level state singleton, module-level render
serialization and top-level `addEventListener` side effects; without this split
there is no real "file area" to scope subagents by (rule 5's exclusive-lock rule),
and by Build 6 the file would be ~3,500 lines — past the point an agent can safely
edit without re-reading it whole. From here on, every new Build 2-6 surface is
implemented in its own file under `src/renderer/features/` (`search.ts`, `decode.ts`,
`notes.ts`, `palette.ts`, `uiScale.ts`) exporting an `init()`/`render()` entry point,
with `main.ts` touched only by one import and one call line; per-feature CSS in
`src/renderer/features/*.css` imported from `style.css`.

- **`electron/main.ts`**: `currentSession` → `Map<string, ClaimSession>` + active id.
  Every claim IPC (`claim:getPdf`, `claim:getDetail`, `dialog:exportPdf`) takes a
  `sessionId` alongside the index, validated exactly like the index is today
  (`getSessionClaim`). `dialog:openClaim` returns a new `sessionId`. Add
  `session:close(sessionId)` that drops that session's claims so its PHI leaves
  memory immediately. Keep clearing everything on window close.
  **Extend the E2E open seam to a queue:** `CLAIM_VIEWER_E2E_OPEN` accepts a
  `;`-separated list of paths, consumed one per `dialog:openClaim` invocation, with
  the last entry sticky when exhausted; the single-path form keeps working. The
  `!isRealPackagedApp()` gate is unchanged byte-for-byte — this is an APPROVED,
  explicit amendment to guardrail §1.5, only the value's shape changes. Keep the
  existing assertion that the seam is inert when packaged. The two-tab E2E launches
  with `[synthetic-1500.json, 837I-multi-claim.dat].join(';')`. (Batch export's
  folder seam, `CLAIM_VIEWER_E2E_DIR`, is added under the same gate when Build 4.1
  needs it — not part of Build 1.)
- **`electron/preload.ts`**: extend the frozen `claimApi` with the session id
  parameter + `closeSession`. **The E2E asserts the exact key list** — update
  `e2e/app.spec.ts`'s array in the same change or it fails (`BUILD_QUEUE.md` rule 7b:
  preload key + main handler + `global.d.ts` type + the E2E array, all in one
  subagent task, owned by one subagent for the whole build).
- **`src/renderer/`**: the single `state` becomes per-tab. Use this literal
  interface — do not re-derive the field list, it has been checked against every
  read site in the current codebase:
  ```ts
  interface TabState {
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
  ```
  Globals staying on `state`: `inspectorOpen`, `theme`, `activeTabId`. `screen` is
  **DERIVED** from the active tab's status (no tabs → welcome) — never independent
  state. Every claim IPC is guarded on `sessionId !== null`; activating an
  `'unloaded'` tab calls `openClaim(filePath)` first. Restored paths (§2e) are
  re-validated in main (extension allow-list + `existsSync`) exactly like a dropped
  path — the renderer never names a path main hasn't vetted.
  Split `loadCurrentClaim` into `loadClaimDetail(tab, index)` (inspector only) and
  `ensureClaimRendered(tab)`, and route tab activation, lazy restore (§2e), claim
  stepping and Build 6's fast mode (`UI_REQUIREMENTS_v3` §11) through those two only
  — this is the one lifecycle contract all of those features share; do not let each
  build invent its own answer to "when do we render". Amend the §2f loading-floor
  note: the 1000ms floor applies to a user-initiated FILE OPEN only — not to tab
  activation, lazy restore, claim stepping, or deferred render. Scoping the floor
  this way is not a refactor of `withLoadingFloor` and is permitted.
  One shared toolbar/inspector reads the active tab. Add a tab strip built from
  existing CSS tokens (no new design language), each tab showing the file name +
  close button, with sensible overflow for many tabs (see §2b).
- **Shortcuts**: `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle, `Ctrl+W` closes the *tab*
  (today it closes the file), `Ctrl+1..9` jump. Update `KEY_GROUPS` (shortcuts
  sheet) and the File menu to match.
- **Watch-outs** (kept in sync with `ROADMAP.md` §1):
  - **(a) pdf.js documents already leak today — fix the root cause, not just the
    tabs symptom.** There is currently **NO** `.destroy()` call anywhere in
    `src/renderer/main.ts` — `state.pdfDoc = await loadingTask.promise` abandons the
    previous `PDFDocumentProxy`, so every claim step, re-open and `closeFile` leaks a
    worker-side document today, and stepping a 400-claim 837 leaks 400 documents —
    an order of magnitude bigger than the tabs case. Introduce a single
    `setActivePdfDoc(tab, doc)` helper that awaits `oldDoc.destroy()` before
    assigning, and route EVERY assignment through it — claim stepping, file open,
    `closeFile`, tab close and tab deactivate. Destroying on claim step is the larger
    win and is in scope for Build 1. Extract the tab/pdfDoc lifecycle into
    `src/renderer/tabState.ts` with pdf.js `getDocument` injected, and unit-test with
    a fake counting create/destroy: live-document count never exceeds 1 across a
    50-claim step sequence and a 10-tab open/switch/close sequence. §2b's
    background-tab release requirement uses this exact mechanism — do not invent a
    second one.
  - **(b) The canvas is shared and STAYS shared** — there is exactly one
    `<canvas id="pdfCanvas">` and `renderPdfPageNow` hard-references it. Keep
    `renderRunning`/`renderDirty`/`renderDirtyFade` **module-level** (one canvas, one
    loop). **Do NOT move the serialization flags into per-tab state** — that lets
    two tabs' render loops target the same canvas concurrently, reintroducing the
    exact pdf.js "Cannot use the same canvas during multiple render() operations"
    error the serialization was added to fix, and the failure is timing-dependent so
    the existing 4 E2E would likely still pass while it's broken. Instead, stamp each
    render request with the tab id that issued it: `renderPdfPageNow` re-reads the
    active tab at the top of each iteration and returns early if the requesting tab
    is no longer active, and any in-flight `page.render()` from an outgoing tab is
    cancelled via `RenderTask.cancel()` on tab switch (swallow
    `RenderingCancelledException`). Add an E2E: switch tabs mid-render, assert the
    canvas shows the newly-active tab's page and no unhandled rejection is logged.

### 2b. Tab polish (same phase — approved additions)
- **Same file opened twice → focus the existing tab**, don't open a duplicate
  (compare resolved absolute paths in main).
- **Middle-click a tab closes it**; **`Ctrl+Shift+T` reopens the last closed tab**
  (the closed tab's path; it can share the recent-files store added in §2e).
- **Overflow**: decide and implement one behavior explicitly — a horizontally
  scrolling strip with the active tab scrolled into view is preferred over a
  dropdown. Tabs get a sensible min/max width with the filename middle-ellipsized.
- **Background-tab memory release**: destroy a non-active tab's pdf.js document and
  re-render on focus, so N open bills don't hold N rendered PDFs. Use the
  `setActivePdfDoc` / `src/renderer/tabState.ts` mechanism from §2's watch-out (a) as
  the test seam for this — the same fake-counting unit test covers both the
  within-tab leak and the cross-tab release; do not build a second mechanism.

### 2c. Version + build stamp in About
Show the app version and build date in the About/notice screen — the app deploys
by replacing the .exe with no auto-update, so a bug report needs to name a build.
Source the version from `package.json` (`app.getVersion()`), and a build timestamp
injected at build time (a small build-script write or a Vite `define`). If this
needs a new IPC on the frozen `claimApi`, **update the exact-key assertion in
`e2e/app.spec.ts`** in the same change (rule 7b).

### 2e. Session restore + recent files (APPROVED — deliberate policy change)
Niall explicitly asked for this on 2026-07-27 and accepted the trade-off, so
implement it — do NOT treat the existing zero-persistence posture as a reason to
skip it, and do not silently water it down.

**BEFORE implementing `session.json`, give the E2E harness profile isolation** —
this is a hard prerequisite (guardrail 9 above), not a nice-to-have:
`launchApp()` currently passes only `args: [MAIN_ENTRY]`, so every E2E run uses the
developer's real `%APPDATA%` profile. The moment this section persists open tabs, the
second Electron launch of the night restores a tab and the existing test asserting
`visibleStateScreens` equals exactly `['welcomeScreen']` goes red — before Build 2
even starts — and `BUILD_QUEUE.md` rule 1 halts the whole chain. Fix: `launchApp()`
creates `mkdtempSync(join(tmpdir(),'claim-viewer-userdata-'))` per launch and passes
`--user-data-dir=<dir>` in `args`, removing it in the `finally` block; add a
`launchAppWithUserData(dir)` variant so the restore test can launch TWICE against the
same temp dir. No E2E may run against the default userData path, and the two
existing exact-equality state-screen assertions must remain byte-identical — do not
loosen them to accommodate a restored tab; isolate the profile instead.

- **Reopen previously open tabs on launch**: persist the open tabs' file paths +
  their order + which was active, to a small JSON in `app.getPath('userData')`
  (e.g. `session.json`). Restore them on next launch. Implement via the persistence
  module + `ALLOWED_USERDATA_FILES` mechanism in `BUILD_QUEUE.md` rule 12 — do not
  invent a parallel one, and do not touch `test/phi-at-rest.test.ts` (it structurally
  cannot observe this write; see rule 12's full reasoning).
- **Recent files**: keep a capped list (10) of recently opened paths, surfaced in
  the File menu.
- **Restore lazily**: recreate each tab from its stored path but only parse/render
  the ACTIVE tab immediately; others load on first activation, via
  `loadClaimDetail`/`ensureClaimRendered` from §2. Avoids a slow, memory-heavy
  startup with many tabs and dovetails with §2b's memory release.
- **Missing files**: if a stored path no longer exists (moved/deleted), skip it
  quietly (or show it disabled) — never fail startup on it.
- **Give the user an out**: a File-menu action to clear the restored session and
  recent list (e.g. "Forget open tabs & recent files"), so the trail can be wiped
  on demand.

**What this changes about the PHI posture — be precise, don't overreach:**
- Claim CONTENT is still **never** written to disk. That guarantee stays.
- What is now persisted is **file paths only** (plus tab order). Paths can be
  PHI-adjacent (a filename or folder could name a member), which is the accepted
  trade-off.
- Update `README.md` (PHI/data policy) and the About screen wording so the app's
  stated behavior matches what it now does.

### 2f. Feature requests from the 50-reviewer panel (approved subset)
A 50-person panel (17 domain experts, 17 everyday users, 16 power users) filed 215
requests — full results in `docs/FEATURE_BACKLOG.md`. Only the small, contained,
low-risk items are in tonight's scope; everything else is roadmap.

**The dominant finding: people retype data out of this app all day.** 38 of 50
reviewers independently named manual transcription of the service-line grid and
header identifiers into spreadsheets/letters/notes as their biggest source of
error. Items 1-3 address that and are the highest-value work in this build.

1. **Copy service lines as TSV** (`Ctrl+Shift+C`, plus a button on the inspector's
   service-line group). A pure formatter over `claim.serviceLines` → header row +
   tab-delimited rows (line no, DOS, POS/revenue code, CPT/HCPCS, modifiers, units,
   charge, dx pointers, rendering NPI), copied via the renderer's **existing**
   `navigator.clipboard.writeText` path — the same call `src/renderer/main.ts`
   already uses at the error-details copy site (line ~1446). **Do NOT** import
   Electron's `clipboard` module (impossible under `sandbox:true`) and do NOT add a
   preload key for clipboard access. Factor the existing call site into one shared
   `copyToClipboard(text, successMsg)` helper that all four copy features (items 1-3
   plus click-to-copy) use. Columns follow the existing inspector grid — no new
   design decision. Unit-test the formatter as fixture-in / exact-string-out.
2. **Click-to-copy on every inspector field** — a copy affordance on the existing
   field-row component (hover/focus icon + `Ctrl+C` when a row has keyboard focus),
   using the same `copyToClipboard` helper, copying the raw model value. One shared
   component, no new state.
3. **Copy claim summary / copy warnings + reconciliation** as plain text — two more
   formatters over data already on screen (header block: patient account, DOS span,
   billing provider + NPI, form type, line count, total; and the warnings list with
   reconciliation figures), through the same `copyToClipboard` helper. Buttons on the
   summary header and the warnings banner.
4. **Severity glyph + explicit word on warnings** — filed as *critical* by the
   colour-blind reviewer: severity currently reads as amber-vs-red only, so a
   blocking problem is indistinguishable from a note. **Two severities only** —
   `warning` renders as a filled triangle plus the literal word "Warning"; `info`
   renders as an outlined circle plus the literal word "Note". `src/model/claim.ts`
   defines `WarningSeverity = 'info' | 'warning'` — there is no third value, and
   Build 1 must NOT add one. Assert the accessible name contains the severity word.
5. **Reconciliation panel: signed delta + plain-language verdict** — render the
   already-computed figures plus an explicit signed difference and a text verdict
   ("Balanced" / "Lines exceed total by $412.00" / "Lines fall short by $412.00").
   Display only — **do not** change the mismatch threshold or the warning it fires.
6. **Plain-English explanation line under each of the SEVEN existing warnings** — a
   static lookup keyed by the seven existing warning codes: `charge-total-mismatch`,
   `dangling-diag-pointer`, `billing-npi-invalid`, `rendering-npi-invalid`,
   `diag-overflow`, `unsupported-form`, `dental-transaction-type-unknown` (x12-only),
   one sentence each saying what it means and whose problem it is. **Put all seven
   strings in ONE file**: this is user-facing copy in a compliance-adjacent tool, so
   Niall should be able to reword it in a single place after reading it in the
   morning. Flag it in the summary as needing a wording review. If Build 3.1
   introduces new codes, they are added to this same file in the same change (see
   `BUILD_QUEUE.md` 3.1's final bullet) — this file never gets a second copy
   elsewhere.

Explicitly NOT included (the panel's 7th suggestion): making the loading floor
"adaptive". It already is — `withLoadingFloor` computes `floor - elapsed`, and the
floor was just changed to 1000ms with its start moved to after the file picker
closes. Do not refactor it (see §2's loading-floor scoping note above for the one
permitted change: which actions the floor applies to).

Clipboard note: items 1-3 put PHI on the clipboard. That is the same exposure class
as the on-screen data and involves no disk or network, so the offline/PHI posture is
unchanged — but do not extend it to writing files, which is a separate decision.

DoD: `npm run typecheck` clean, `npm test` green, `npm run build && npx playwright test` green.

## 3. Phase 2 — extend tests (same or second Sonnet agent)
- E2E: open two files → both tabs present; switching re-renders the correct
  preview; closing one leaves the other intact and its claims released.
- `test/phi-at-rest.test.ts` stays **unchanged** (header comment only, if anything).
  Verification for the new session store is `test/persisted-artifacts.test.ts` and
  `ALLOWED_USERDATA_FILES`, per `BUILD_QUEUE.md` rule 12 — do not re-scope the
  PHI-at-rest test to try to cover this; it structurally cannot observe a `userData`
  write. Cover a closed tab's claims being dropped from the (in-memory) session map
  as its own assertion, separate from the persisted-artifacts check.
- Cover session restore: tabs reopen on relaunch in order with the right active
  tab, a missing/deleted path is skipped without breaking startup, and the
  "forget" action actually clears both the session file and the recent list.
- Keep all existing tests passing.

### 3a. Accessibility checklist — new `e2e/a11y.spec.ts`
`e2e/app.spec.ts` and `multi-form.spec.ts` contain zero aria/role/focus assertions
today, so add a dedicated, named checklist file that every later build extends (do
**NOT** add axe — a new install plus a flood of pre-existing findings would trip
`BUILD_QUEUE.md` rule 1):
1. `#tablist` has `role="tablist"`, each tab `role="tab"` `aria-selected`, Left/Right/
   Home/End move between tabs with only one tab in the tab order.
2. Closing the active tab moves focus to an adjacent tab; closing the last moves
   focus to the empty state's primary button.
3. F6 cycles exactly the declared regions and the tab strip is one of them —
   `f6Regions()` currently lists toolbar/preview/inspector only and must be updated.
4. Every new `.iconBtn` has a non-empty accessible name.
5. Opening and closing each dialog restores focus to its invoker.

Also, in §2f item 2's click-to-copy work: the inspector body becomes a
roving-tabindex composite — `.inspGroupBody` gets `role="list"`, each `.inspRow`
`role="listitem"` `tabindex="-1"` with one row per group at `tabindex="0"`; Up/Down/
Home/End move the roving index and `Ctrl+C` copies from the focused row; search
step-through (Build 2.1) sets the roving index rather than adding tab stops. Assert
that Tab from a focused inspector row lands outside the inspector in one press —
the obvious 2am implementation (`tabindex="0"` everywhere) would create 80-150
sequential tab stops that Build 6 would then have to undo.

`docs/BUILD_QUEUE.md` rule: a build that adds a new surface adds its assertions to
`e2e/a11y.spec.ts` before it may be called done.

### 3b. Screenshots — close the visual blind spot (IMPORTANT)
Nobody can see the GUI during this run, and a CSS bug once survived precisely
because it was never looked at. Capture per `BUILD_QUEUE.md` rule 6: one
`e2e/screenshots.spec.ts`, one `ElectronApplication` launched in `beforeAll`, reused
for every shot (toggle theme/tab count in-page), excluded from the default test run,
run once per build at checkpoint time — a screenshot failure is a `BUILD_LOG.md`
note, not a chain-stopper. For Build 1, capture and commit to `docs/screenshots/`:
- The tab strip with **1 tab, 3 tabs, and enough tabs to trigger overflow** (~12
  distinct tabs — write 12 copies of `synthetic-1500.json` into a temp dir at test
  time rather than committing 12 fixtures, to avoid fixture noise in the repo).
- Each of those in **light and dark theme** (toggle via the app's own control).
- The workspace with a claim rendered, the inspector open, and the About screen
  showing the new version/build stamp.
- Name them descriptively (`tabs-3-dark.png`, `overflow-light.png`, …).

**Use ONLY the synthetic fixtures in `test/fixtures/` — never a real claim file.**
A screenshot of real data would put PHI in the repo.

These are the artifacts Niall and I review in the morning, so favour clarity:
full-window shots, default window size.

### 3c. Pin the toast backslash bug
Open export shows the saved path in a toast; a screenshot showed it rendering as
`C:UsersNiall Yoder...` — backslashes apparently missing — while the earlier build
showed them correctly. The message is set with `textContent`, which cannot strip
characters, so this is either a font/glyph rendering issue or an observation
artifact. Determine which, definitively, **before any font swap (§3d)** — capture
the toast screenshot and answer the backslash question against the font stack
actually shipping at that moment, and state which stack that was:
1. In the E2E, assert the toast's `textContent` contains `\` after an export
   (proves the string is intact end-to-end).
2. Screenshot the toast (`docs/screenshots/toast-export.png`) so the rendered
   glyphs can be inspected.
3. If the glyphs really are missing, fix it (note §3d swaps in new fonts next,
   which may resolve or change it — capture this verdict first, then re-verify
   after §3d if the font stack changed) and say what the cause was.
If it turns out to be a non-issue, say so plainly and close it out.

### 3d. Bundle the real design fonts (moved to the END of Build 1)
This item was originally §2d, ahead of the tabs work and the highest-value copy
features. It's been moved here — after §3c's backslash screenshot is captured — for
two reasons: it's the lowest-value item in Build 1, and it's a runtime network
fetch with no pinned URLs on a machine whose defining posture is offline
operation, the step most likely to hard-stall with nobody there to answer a
permission prompt. It also confounds §3c's backslash verdict if done first, since
it changes every text metric in the same build.

Replace the system-font stand-ins with the fonts the approved design specifies:
**Source Serif 4**, **Open Sans**, **IBM Plex Mono** — all SIL OFL, embeddable and
redistributable. If `BUILD_QUEUE.md` Build 0 already staged the .ttf/.woff2 files
under `src/renderer/assets/fonts/` with their OFL licenses, this reduces to "wire up
the already-present font files." If not, fetch them from their official OFL repos,
commit the license files alongside, and declare them with `@font-face` so they load
from the bundle (the CSP already allows `font-src 'self' data:`; nothing may be
fetched from Google Fonts at runtime — the offline kill-switch would block it
anyway). Swap the three `--font-*` variables in `style.css` to the new families; the
rest of the CSS already reads through them. Verify the packaged app actually ships
the font files (they must not be excluded by electron-builder's `files` list — the
same gap that silently broke the PDF fonts once) — see §6.

**Escape hatch — one attempt, then skip:** if the fonts cannot be obtained, or the
§6 asar check shows they did not ship, revert the `--font-*` changes in `style.css`
so the app stays on the system-font stand-ins, record `"§3d SKIPPED — reason"` in
`BUILD_LOG.md`, and continue. **Never partially swap the font stack. Never weaken
the CSP or the offline kill-switch to obtain them. This item must never block or
delay the tabs work or stop the chain** — it runs last in Build 1 specifically so a
stall here can't cost anything upstream of it.

## 4. Phase 3 — comprehensive verification workflow
Run a multi-dimension adversarial audit (same shape as `docs/AUDIT_REPORT.md`):
fan out independent auditors — **read-only, no Edit/Write/mutating Bash**
(`BUILD_QUEUE.md` rule 7) — then **adversarially verify every finding**
(CONFIRMED / REFUTED / ALREADY-ACCEPTED, default to REFUTED if not reproducible),
then synthesize a report + prioritized fix list. Dimensions:
1. **Tab state correctness** — per-tab isolation of zoom/page/claim index; no
   cross-tab leakage; the render-serialization fix actually per-tab-aware (per §2
   watch-out (b): tab-stamped requests and cancellation, NOT per-tab flags).
2. **Main-process session lifecycle** — session map keying, `sessionId` validation
   on every IPC, close/cleanup, no orphaned sessions, PHI released on tab close.
3. **Security & offline** — kill-switch intact, frozen preload surface still
   minimal and validated, seams still `!app.isPackaged`-gated (including the new
   `;`-separated open-seam queue).
4. **UI/UX & accessibility** — tab strip keyboard reachable, focus handling on
   open/close/switch, ARIA for the tab list (per §3a), guardrails §1 all intact,
   animations not flaky, reduced-motion honored.
5. **Regression sweep** — every prior fix in guardrails §1 still holds; export,
   inspector, warnings banner, zoom, filename all behave.
6. **Completeness critic** — what did the others miss? untested paths, memory
   growth with many tabs, edge cases (same file opened twice, 30+ tabs, closing
   the last tab, closing the active tab).

The synthesized report goes into the `## Build 1` section of `docs/BUILD_LOG.md` as
an "Audit findings" subsection, per `BUILD_QUEUE.md` rule 2 — there is no separate
`AUDIT_TABS.md` file.

## 5. Phase 4 — fix confirmed findings
Fix all CONFIRMED blocking/major findings (Sonnet agents). Apply `BUILD_QUEUE.md`
rule 5: `src/renderer/**`, `style.css` and `index.html` are a single exclusive lock
— confirmed findings are grouped by target file before dispatch, all renderer-file
findings go to ONE agent in ONE pass, and only genuinely disjoint file groups
(`electron/**` vs `src/render/**` vs `src/sources/**` vs `test/**`) may run in
parallel. State the module ownership map in every delegation prompt. Minor/nit
items: fix if cheap, otherwise list them in the report as deferred. Re-run the full
verification after each dispatch wave, not only at the end (rule 5).

## 6. Phase 5 — build + report
- `npm run verify:release` (typecheck + tests + `build:app` + E2E + `build:dist`)
  must be fully green — Build 1 is one of the two builds tonight that packs a real
  exe (see `BUILD_QUEUE.md` Build 0's script split).
- Confirm `release/837 Claim Viewer 0.0.1.exe` is freshly rebuilt (check timestamp)
  and still unsigned/portable with the app icon.
- **Do NOT distribute** — do not copy to any network share or send anywhere.
  Producing the artifact is the deliverable; distribution is Niall's call.
- Write the `## Build 1` section of `docs/BUILD_LOG.md` (the single morning report —
  see `BUILD_QUEUE.md` rules 1-2): what shipped, test/E2E counts, exe path +
  timestamp, anything unverifiable without a display, and any deferred findings.
  Link the screenshots from §3b and state the verdict on the backslash question from
  §3c. This replaces the old "leave a summary at the top of `docs/AUDIT_TABS.md`"
  instruction — that file is not created; everything goes in `BUILD_LOG.md`.
- Confirm the packaged app really contains the new font files **and every bundled
  code-set module** (Build 2.2, if it runs) — unpack/inspect the asar. A bundling gap
  like this silently disabled the PDF fonts once before; the same class of gap would
  silently ship empty code decoding.
- `git add -A && git commit -m "Build 1: <summary>" && git tag build-1-green` per
  `BUILD_QUEUE.md` rule 2.

## 7. Honest reporting
Nobody is watching this run. Report what actually happened, including failures,
skipped steps, or anything left half-done — do not claim success that the commands
don't show. **The completion policy is `BUILD_QUEUE.md` rule 9, stated once there
and not repeated with different wording here:** finish the current item to green and
checkpoint it; never leave a half-finished refactor; if an item truly can't be
finished, record exactly where it stopped in `BUILD_LOG.md` under "Not done and why"
and leave the tree at the last green checkpoint (`git reset --hard` to the prior
build's tag if the current one never went green — rule 1).
