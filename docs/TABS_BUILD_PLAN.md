# Tabs build — scheduled unattended run (10pm, 2026-07-27)

Execution plan for adding **multi-file tabs** to the Claim Viewer, verifying it
comprehensively, and cutting a new portable `.exe` — run unattended while Niall
is out. This document is the source of truth; the scheduled prompt just says
"execute this plan".

Repo: `C:\Users\Niall Yoder\Downloads\codes related docs\837-claim-viewer`

## 0. Ground truth before starting
- Feature spec + implementation sketch: **`docs/ROADMAP.md` §1** (read it first — it
  lists every file that changes and two known watch-outs).
- Current state: v2 shipped. `npm run verify` = typecheck (3 configs) + 104 vitest
  + build + 4 Playwright E2E, all green. Portable exe at `release/`.
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
4. Export filename stays **PHI-free**: `<billing provider> - <service date>.pdf`.
5. Offline kill-switch, sandbox/contextIsolation, and the `!app.isPackaged` gating of
   the E2E seams stay exactly as-is.
6. Enter-only animations for state screens / banner / menus (exit stays an instant
   `hidden` flip) so the E2E visibility assertions don't go flaky.
7. `prefers-reduced-motion` support stays.
8. Renderers (`src/render/**`) and parsers (`src/sources/**`) must not change at all —
   tabs is a shell/renderer concern only.

## 2. Phase 1 — implement (one Sonnet agent, for coherence)
Per-tab state spans main + preload + renderer, so a single agent owns the whole
vertical slice rather than splitting it.

- **`electron/main.ts`**: `currentSession` → `Map<string, ClaimSession>` + active id.
  Every claim IPC (`claim:getPdf`, `claim:getDetail`, `dialog:exportPdf`) takes a
  `sessionId` alongside the index, validated exactly like the index is today
  (`getSessionClaim`). `dialog:openClaim` returns a new `sessionId`. Add
  `session:close(sessionId)` that drops that session's claims so its PHI leaves
  memory immediately. Keep clearing everything on window close.
- **`electron/preload.ts`**: extend the frozen `claimApi` with the session id
  parameter + `closeSession`. **The E2E asserts the exact key list** — update
  `e2e/app.spec.ts`'s array in the same change or it fails.
- **`src/renderer/`**: the single `state` becomes per-tab — each tab owns
  `pdfDoc`, `pageNum`, `pageCount`, `zoom`, `zoomMode`, `currentIndex`,
  `summaries`, `fileName`. One shared toolbar/inspector reads the active tab.
  Add a tab strip built from existing CSS tokens (no new design language), each
  tab showing the file name + close button, with sensible overflow for many tabs.
- **Shortcuts**: `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle, `Ctrl+W` closes the *tab*
  (today it closes the file), `Ctrl+1..9` jump. Update `KEY_GROUPS` (shortcuts
  sheet) and the File menu to match.
- **Watch-outs from the roadmap**: (a) release/re-render a background tab's
  `pdfDoc` rather than holding every PDF in memory; (b) the render serialization
  added for Ctrl+wheel zoom is module-level — it **must** become per-tab or keyed
  to the active canvas, or a background tab's render can clobber the foreground.

### 2b. Tab polish (same phase — approved additions)
- **Same file opened twice → focus the existing tab**, don't open a duplicate
  (compare resolved absolute paths in main).
- **Middle-click a tab closes it**; **`Ctrl+Shift+T` reopens the last closed tab**
  (the closed tab's path; it can share the recent-files store added in §2e).
- **Overflow**: decide and implement one behavior explicitly — a horizontally
  scrolling strip with the active tab scrolled into view is preferred over a
  dropdown. Tabs get a sensible min/max width with the filename middle-ellipsized.
- **Background-tab memory release**: destroy a non-active tab's pdf.js document and
  re-render on focus, so N open bills don't hold N rendered PDFs. This must be
  covered by an explicit test, not just asserted.

### 2c. Version + build stamp in About
Show the app version and build date in the About/notice screen — the app deploys
by replacing the .exe with no auto-update, so a bug report needs to name a build.
Source the version from `package.json` (`app.getVersion()`), and a build timestamp
injected at build time (a small build-script write or a Vite `define`). If this
needs a new IPC on the frozen `claimApi`, **update the exact-key assertion in
`e2e/app.spec.ts`** in the same change.

### 2d. Bundle the real design fonts
Replace the system-font stand-ins with the fonts the approved design specifies:
**Source Serif 4**, **Open Sans**, **IBM Plex Mono** — all SIL OFL, embeddable and
redistributable. Fetch the .ttf/.woff2 from their official OFL repos, commit the
license files alongside, place under `src/renderer/assets/fonts/`, and declare them
with `@font-face` so they load from the bundle (the CSP already allows
`font-src 'self' data:`; nothing may be fetched from Google Fonts at runtime — the
offline kill-switch would block it anyway). Swap the three `--font-*` variables in
`style.css` to the new families; the rest of the CSS already reads through them.
Verify the packaged app actually ships the font files (they must not be excluded by
electron-builder's `files` list — the same gap that silently broke the PDF fonts once).

### 2e. Session restore + recent files (APPROVED — deliberate policy change)
Niall explicitly asked for this on 2026-07-27 and accepted the trade-off, so
implement it — do NOT treat the existing zero-persistence posture as a reason to
skip it, and do not silently water it down.

- **Reopen previously open tabs on launch**: persist the open tabs' file paths +
  their order + which was active, to a small JSON in `app.getPath('userData')`
  (e.g. `session.json`). Restore them on next launch.
- **Recent files**: keep a capped list (10) of recently opened paths, surfaced in
  the File menu.
- **Restore lazily**: recreate each tab from its stored path but only parse/render
  the ACTIVE tab immediately; others load on first activation. Avoids a slow,
  memory-heavy startup with many tabs and dovetails with §2b's memory release.
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
- The existing `test/phi-at-rest.test.ts` asserts essentially "nothing is written".
  **Re-scope it, don't delete it**: it must still assert that claim content and the
  synthetic PHI canary never reach disk, while allowing the new session file. Make
  the new file's contents part of that assertion — a path may be stored, patient
  names/claim data may not.
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
   charge, dx pointers, rendering NPI) pasted via Electron's `clipboard`. Columns
   follow the existing inspector grid — no new design decision. Unit-test it as
   fixture-in / exact-string-out.
2. **Click-to-copy on every inspector field** — a copy affordance on the existing
   field-row component (hover/focus icon + `Ctrl+C` when a row has keyboard focus),
   copying the raw model value. One shared component, no new state.
3. **Copy claim summary / copy warnings + reconciliation** as plain text — two more
   formatters over data already on screen (header block: patient account, DOS span,
   billing provider + NPI, form type, line count, total; and the warnings list with
   reconciliation figures). Buttons on the summary header and the warnings banner.
4. **Severity glyph + explicit word on warnings** — filed as *critical* by the
   colour-blind reviewer: severity currently reads as amber-vs-red only, so a
   blocking problem is indistinguishable from a note. Add a distinct shape per
   severity (triangle/octagon/circle) **and** the literal word "Error"/"Warning"/
   "Note", using the severity each warning object already carries. Assert the
   accessible name contains the severity word.
5. **Reconciliation panel: signed delta + plain-language verdict** — render the
   already-computed figures plus an explicit signed difference and a text verdict
   ("Balanced" / "Lines exceed total by $412.00" / "Lines fall short by $412.00").
   Display only — **do not** change the mismatch threshold or the warning it fires.
6. **Plain-English explanation line under each of the five existing warnings** — a
   static lookup keyed by the five existing warning codes, one sentence each saying
   what it means and whose problem it is. **Put all five strings in ONE file**: this
   is user-facing copy in a compliance-adjacent tool, so Niall should be able to
   reword it in a single place after reading it in the morning. Flag it in the
   summary as needing a wording review.

Explicitly NOT included (the panel's 7th suggestion): making the loading floor
"adaptive". It already is — `withLoadingFloor` computes `floor - elapsed`, and the
floor was just changed to 1000ms with its start moved to after the file picker
closes. Do not refactor it.

Clipboard note: items 1-3 put PHI on the clipboard. That is the same exposure class
as the on-screen data and involves no disk or network, so the offline/PHI posture is
unchanged — but do not extend it to writing files, which is a separate decision.

DoD: `npm run typecheck` clean, `npm test` green, `npm run build && npx playwright test` green.

## 3. Phase 2 — extend tests (same or second Sonnet agent)
- E2E: open two files → both tabs present; switching re-renders the correct
  preview; closing one leaves the other intact and its claims released.
- Extend the PHI-at-rest test to cover a closed tab's claims being dropped, and
  re-scope it per §2e (claim content/canary still never on disk; the new
  session/recent-files store may contain paths only).
- Cover session restore: tabs reopen on relaunch in order with the right active
  tab, a missing/deleted path is skipped without breaking startup, and the
  "forget" action actually clears both the session file and the recent list.
- Keep all existing tests passing.

### 3b. Screenshots — close the visual blind spot (IMPORTANT)
Nobody can see the GUI during this run, and a CSS bug once survived precisely
because it was never looked at. Playwright already drives the real Electron app,
so capture and commit real screenshots to **`docs/screenshots/`**:
- The tab strip with **1 tab, 3 tabs, and enough tabs to trigger overflow**.
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
artifact. Determine which, definitively:
1. In the E2E, assert the toast's `textContent` contains `\` after an export
   (proves the string is intact end-to-end).
2. Screenshot the toast (`docs/screenshots/toast-export.png`) so the rendered
   glyphs can be inspected.
3. If the glyphs really are missing, fix it (likely the font stack — note §2d
   swaps in new fonts, which may resolve or change it) and say what the cause was.
If it turns out to be a non-issue, say so plainly and close it out.

## 4. Phase 3 — comprehensive verification workflow
Run a multi-dimension adversarial audit (same shape as `docs/AUDIT_REPORT.md`):
fan out independent auditors, then **adversarially verify every finding**
(CONFIRMED / REFUTED / ALREADY-ACCEPTED — default to REFUTED if not reproducible),
then synthesize a report + prioritized fix list. Dimensions:
1. **Tab state correctness** — per-tab isolation of zoom/page/claim index; no
   cross-tab leakage; the render-serialization fix actually per-tab.
2. **Main-process session lifecycle** — session map keying, `sessionId` validation
   on every IPC, close/cleanup, no orphaned sessions, PHI released on tab close.
3. **Security & offline** — kill-switch intact, frozen preload surface still
   minimal and validated, seams still `!app.isPackaged`-gated.
4. **UI/UX & accessibility** — tab strip keyboard reachable, focus handling on
   open/close/switch, ARIA for the tab list, guardrails §1 all intact, animations
   not flaky, reduced-motion honored.
5. **Regression sweep** — every prior fix in guardrails §1 still holds; export,
   inspector, warnings banner, zoom, filename all behave.
6. **Completeness critic** — what did the others miss? untested paths, memory
   growth with many tabs, edge cases (same file opened twice, 30+ tabs, closing
   the last tab, closing the active tab).

Write the result to `docs/AUDIT_TABS.md`.

## 5. Phase 4 — fix confirmed findings
Fix all CONFIRMED blocking/major findings (Sonnet agents, scoped by file area to
avoid collisions). Minor/nit items: fix if cheap, otherwise list them in the report
as deferred. Re-run the full verification after fixes.

## 6. Phase 5 — build + report
- `npm run verify` (typecheck + tests + build + E2E) must be fully green.
- Confirm `release/837 Claim Viewer 0.0.1.exe` is freshly rebuilt (check timestamp)
  and still unsigned/portable with the app icon.
- **Do NOT distribute** — do not copy to any network share or send anywhere.
  Producing the artifact is the deliverable; distribution is Niall's call.
- Leave a short summary at the top of `docs/AUDIT_TABS.md`: what shipped, test/E2E
  counts, exe path + timestamp, anything unverifiable without a display, and any
  deferred findings. **Link the screenshots** from §3b and state the verdict on the
  backslash question from §3c.
- Confirm the packaged app really contains the new font files (unpack/inspect the
  asar) — a bundling gap like this silently disabled the PDF fonts once before.

## 7. Honest reporting
Nobody is watching this run. Report what actually happened, including failures,
skipped steps, or anything left half-done — do not claim success that the commands
don't show. If a phase can't complete (e.g. an agent fails repeatedly, or the build
breaks), stop, leave the repo in a working state (last known-green), and say so
plainly in the summary.
