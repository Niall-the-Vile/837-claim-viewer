# Build log — the single morning report

This is the **only** morning report for the 2026-07-27 22:00 unattended run. It is
written **only by the main model** (never delegated to a subagent — see
`BUILD_QUEUE.md` rule 2). There is no separate `AUDIT_TABS.md` or per-build audit
file: each build's adversarial-audit synthesis lives inside that build's section
below, as an "Audit findings" subsection.

A `## Build N` section is appended at the **start** of each build, marked
`STATUS: IN PROGRESS`, and updated to `STATUS: GREEN` (or `STATUS: STOPPED` — see
`BUILD_QUEUE.md` rules 1/3/9) at the end. If the chain stops mid-run for any reason
(red repo, wall-clock cutoff, usage exhaustion), the last section written says so
plainly, including the abandoned commit SHA if `git reset --hard` was used.

Baseline: tag `build-0-green` at commit `c1d4316` (pre-queue green: v2 shipped,
104 vitest + 4 E2E, `npm run verify` green).

---

## Per-build section template

Copy this block for each build.

```
## Build N — <name>
STATUS: IN PROGRESS | GREEN | STOPPED

Start: <timestamp>          End: <timestamp>
Commit: <SHA>                Tag: build-N-green

### What shipped
- <bullet list, one line per sub-item, e.g. "3.1(a-g) — extended structural
  warnings, all seven codes documented in the copy file">

### Not done and why
- <sub-item> — <one-line reason> (per BUILD_QUEUE.md rule 9/10)

### Verification
- typecheck: <pass/fail>
- vitest: <count before> -> <count after>, <pass/fail>
- E2E: <count before> -> <count after>, <pass/fail>
- Playwright flake retried? <yes/no — BUILD_QUEUE.md rule 11>
- exe (if this build packed one): <path> · <timestamp> · SHA-256 <hash>

### Preload/IPC surface changes (rule 7b)
- <key added> — <preload / main / global.d.ts / e2e/app.spec.ts all updated? y/n>

### Screenshots added
- <path> — <what it shows>

### Audit findings (if this build ran Phase 3/4 verification)
- <dimension> — CONFIRMED/REFUTED/ALREADY-ACCEPTED — <finding> — <fix status>

### Unverified
- <anything reported UNVERIFIED per BUILD_QUEUE.md Build 0's fixture note, or
  anything that could not be checked without a human/display>

### Deferred / failed
- <item> — <deferred to which future build, or why it failed>

### Golden/goldens regenerated (only if guardrail 8 was in play — Builds 3/4/6)
- <commit titled "goldens: regenerate for <item>"> — <what moved and why>
```

---

## Build 0 — pre-flight

STATUS: PARTIAL (human task, not part of the unattended chain — see
`BUILD_QUEUE.md`'s Build 0 section for the live checklist)

- [DONE] `git init`
- [DONE] Baseline commit `c1d4316`, tag `build-0-green`
- [DONE] `docs/BUILD_LOG.md` created (this file)
- [ ] Remaining Build 0 items (script split, large fixtures, font pre-staging,
  final `npm run verify` gate) — see `docs/BUILD_QUEUE.md` for the live checklist;
  this section gets updated when they're done, before the 22:00 run starts.

---

<!-- Build 1's "## Build 1 — Tabs + polish" section starts here when the run begins. -->

---

## Build 1 — Tabs + polish + fonts + version stamp + clipboard/copy suite
STATUS: GREEN

Start: 2026-07-28 07:30 EDT        End: 2026-07-28 11:15 EDT
Commit: 7a38745                    Tag: build-1-green

**Note on scheduling:** the 2026-07-27 22:00 unattended run **never executed**. The
task fired on time (`lastRunAt` 22:00:47) but the Claude Code process exited straight
after, so nothing landed — no commits past `build-0-preflight-green`, no tags, no
screenshots. The repo was verified clean and green before restarting, and Build 1 was
run in the foreground with Niall present instead, with screenshots reviewed as they
appeared rather than in a morning report.

### What shipped
- **E2E profile isolation** (`4760d65`) — per-launch `--user-data-dir`; the hard
  prerequisite for any userData writer.
- **Module split** (`a97fe15`) — `src/renderer/main.ts` 1,604 → 577 lines across
  dom/tabs/preview/inspector/overlays/shortcuts. Pure move; two circular imports
  resolved by dependency injection rather than mutual imports.
- **Multi-file tabs** (`735834e`) — main-process session Map keyed by sessionId,
  sessionId on every claim IPC, per-tab `TabState`, tab strip, Ctrl+Tab / Ctrl+W /
  Ctrl+1-7, same-file dedupe, background-tab release, shared-canvas render
  serialization with tab-stamped requests.
- **Clipboard/copy suite** (`73ac6d1`) — TSV service-line copy (Ctrl+Shift+C),
  click-to-copy inspector fields via a roving-tabindex composite, copy summary /
  warnings, severity glyph + word, reconciliation verdict, and seven plain-English
  warning explanations. *This is the item 38 of 50 reviewers asked for.*
- **Session restore + recent files + version stamp** (`4c1ec92`) — `session.json` in
  userData, lazy restore via `TabState.status`, About screen, and honest README/About
  data-policy wording.
- **Screenshot suite** (`dad6886`) — 15 images, excluded from the verify gate so a
  screenshot failure can never break the build.
- **About version fix** (`4a2ac7f`) — was displaying Electron's 43.2.0.
- **Bundled design fonts** (`e798776`) — Source Serif 4 / Open Sans / IBM Plex Mono,
  all confirmed inside the packaged asar.
- **Audit fixes** (`7a38745`) — all 10 MUST FIX items from `docs/AUDIT_BUILD1.md`.

### Audit findings
Six-dimension adversarial audit → `docs/AUDIT_BUILD1.md`: **33 CONFIRMED of 38**
verified. All eight §1 guardrails held. The verdict was **do not ship**, correctly:

- **BLOCKING** — background-tab pdf.js release was bypassed on every
  open-into-a-background-tab (`createTab` set `activeTabId` itself, so the release
  path saw no previous tab). The leak this build set out to fix was still leaking.
- **MAJOR** — a failed `claim:getPdf` left the tab describing one claim while the
  canvas showed another, and **export followed the wrong one**.
- **MAJOR** — restored-but-unloaded tabs escaped the same-file dedupe, producing two
  tabs sharing one sessionId; closing either broke the other.
- **MAJOR** — `role="tablist"` shipped with no keyboard handler at all.
- Plus focus loss on tab re-render, a Ctrl+Shift+C double-fire, modal stacking, and
  two test-integrity findings (a spec header claiming coverage that did not exist).

All fixed in `7a38745`, each with a test **confirmed to fail against the pre-fix
code**. The two verifications the plan mandated but that had never been built — a
pdf.js lifecycle test (via a new injectable `getDocument` seam in
`src/renderer/tabState.ts`) and `e2e/a11y.spec.ts` — landed with the fixes. Their
absence is precisely why the top two defects shipped.

### Not done and why
- The 13 SHOULD FIX items and remaining coverage gaps (F6 region cycling, dialog
  invoker focus restore, warning-explanation unit tests) — deferred to a later pass,
  all recorded in `docs/AUDIT_BUILD1.md`.
- Builds 2-6 not started; Build 1 was the stated deliverable.

### Verification
- typecheck: **pass** (3 configs)
- vitest: 104 → **134**, pass
- Playwright E2E: 4 → **28**, pass
- screenshots: 7 specs / 15 images, regenerated after the font swap
- exe: `release/837 Claim Viewer 0.0.1.exe` · 88.5 MB · unsigned (intended) ·
  2026-07-28 11:12 · SHA-256 `52F981CA80A178B05AEC0EB240B577A0`
- fonts verified inside the asar: 8 `.ttf` (5 UI + 3 DejaVu PDF)

### Preload/IPC surface changes (rule 7b)
- `closeSession`, `getInfo`, `getRestoreState`, `saveSession`, `forgetSession` —
  preload + main handler + types + `e2e/app.spec.ts`'s exact key-list assertion all
  updated together; the assertion was extended, never loosened.

### Needs Niall's eye
- The seven **warning explanations** (`src/renderer/warningExplanations.ts`) are
  first-draft copy, never reviewed — kept in one file so they can be reworded in one
  place. This is compliance-adjacent text the team will read.
- The **status-bar copy icon** is subtle; easy to make more prominent.
- **"Forget open tabs & recent files"** is a *clear now*, not a *stop remembering*
  toggle — normal tab activity re-persists afterwards. Matches the spec as written;
  confirm that is what was wanted.

---

## Build 2 — UI text scale, CMS code decoding, Ctrl+F search
STATUS: GREEN (adversarial audit pending — see "Not done")

Start: 2026-07-28 12:55 EDT        End: 2026-07-28 16:05 EDT
Commit: 284887f                    Tag: build-2-green

**Scheduling note:** this build was scheduled for 12:35 but the task never fired
(`enabled: true`, no `lastRunAt`, repo untouched) — the second scheduler no-show in
two attempts. Run in the foreground instead, and the scheduled task was disabled so
it could not fire mid-build and start a competing session on the same repo.

### What shipped
- **2.0 — Independent UI text scale** (`61dd5e1`). View-menu control cycling
  100/125/150/175%, persisted in `session.json`. Applies `zoom` per chrome region
  (`#titlebar`, `#menubar`, `#tabStrip`, `#toolbar`, `.warnBanner`, `#inspector`,
  `#statusBar`, `.dialog`, `#toast`) so `#pdfScroll`/`#pdfCanvas` never inherit it —
  `setZoomFactor` was forbidden precisely because it would have scaled the PDF canvas
  and corrupted per-tab zoom. Fixed px widths (`#inspector` 372, `.dialog` 600,
  `.dialogWide` 720, `.menuPanel` 230) converted to `em`. Fit-math extracted to a
  pure `src/renderer/fitMath.ts`.
  *Filed **critical** by the low-vision reviewer, who runs Windows at 175%.*
- **2.2 — Plain-English CMS code decoding** (folded into `61dd5e1`). Eight public
  code sets as `.ts` modules under `src/data/`: place of service, type of bill,
  discharge status, revenue codes, condition/occurrence/value codes, modifiers.
  Decoding applied in MAIN inside `buildClaimDetail`, so the DTO carries
  `{ raw, decoded }` and the renderer stays a view layer. Raw value always shown
  first and stays copyable verbatim; unknown codes render raw, never "Unknown".
  CPT/ICD descriptors deliberately excluded (AMA-licensed).
- **2.1 — `Ctrl+F` find/search** (`284887f`). Search field pinned to the inspector,
  filters rows while keeping group headings, live match count + `Enter`/`Shift+Enter`
  stepping with a persistent outline, cross-claim "matches in other claims" jump,
  `Esc` clears. Pure matching logic in `src/renderer/features/searchMatch.ts`.
  *Second-most requested feature on the 50-reviewer panel (27 filings).*

### Two bugs caught by insisting on empirical proof
- **`vw` max-width vs. element zoom.** A `vw`-based cap resolves against the true
  window regardless of an element's own `zoom`, so at 175% a dialog would have
  overflowed the window. Found by probing the real renderer, not by reading CSS.
- **Fit-math must NOT take a scale parameter.** The intuitive "divide by scale" fix
  would have been the bug: `#pdfScroll`'s `getBoundingClientRect()` stays exact at
  every scale, so dividing would break "fitWidth yields the same zoom at 175% as at
  100%" — now asserted directly.

### The `<details>` trap (from the Build 1 audit, avoided here)
Inspector groups render **collapsed**. A naive search would report "7 matches in 3
groups" while showing none. Search force-opens matching groups, and captures each
group's prior `open` state on the first keystroke to restore it **verbatim** on
`Esc` — otherwise clearing a search would silently destroy the user's layout.

### Not done and why
- 13 SHOULD FIX items + coverage gaps from `docs/AUDIT_BUILD1.md` still open.
- Builds 3-6 not started.

### Audit → `build-2-audited` (commits `82acc68`, `edcbb3c`)
The adversarial audit ran after the initial tag and returned **23 CONFIRMED of 30
verified**, verdict *"NOT trustworthy as tagged"*. It was right. Full write-up in
`docs/AUDIT_BUILD2.md`; the short version:

- **Two BLOCKING data defects.** `occurrenceCodes.ts` had a clean three-code leftward
  transcription shift through the therapy series (39/44/45 carrying 44/45/46's labels,
  46 missing entirely). `valueCodes.ts` decoded two different codes to the **identical
  string**, and put peritoneal dialysis on `68` with no `67` key — the same off-by-one
  pattern. Both re-derived wholesale from source rather than patched.
- **Two more wrong tables.** Condition code 81 decoded as a cost outlier (it is the
  <39-weeks-gestation attestation) and collided with CC 61; type-of-bill frequency
  letters K/M/P carried an **invented "QIM" acronym on two different letters**, landing
  on the headline "Type of bill" row.
- **A ninth defect the audit missed**, caught by the new duplicate-label check on its
  first run: three revenue codes decoding to one bare string.
- **Four MAJOR non-data findings**: 64-char decode truncation that merged discharge
  status 05/85 and dropped trailing modifiers; a search snapshot that replayed one
  claim's layout onto another; the shortcuts dialog rendering its only close button
  off-screen at 175%; and the whole preview-pane state layer sitting outside every
  zoomed region, so UI scale did nothing to the first screen or any parse-error message.

**The lesson worth keeping.** This build's defect class was new: not a crash or a layout
glitch, but the app *confidently displaying false information* beside real dollar
figures, with a fully green suite. The cause was structural — eight code tables shipped
with four spot-check assertions between them. `test/decodeTables.test.ts` now pins the
corrected values and, more importantly, adds mechanical checks needing no code-set
knowledge: no placeholder labels, and **no two codes in one table sharing a decoded
string**. That check catches a transcription shift on its own.

Two existing tests **actively resisted** their own fixes (a "POS 27 is unrecognized"
fixture that was really a table gap, and an E2E anchored on standard NUBC codes being
undecodable). Both repointed at invariants that cannot go stale as the tables grow.

Sourcing discipline: the audit ran offline and flagged that its own suggested labels
were unverified. Every replacement came from Noridian JE/JF Part A reference tables
instead. Where a source could not settle a flagged code it was **omitted rather than
relabelled** — one guess is not an improvement on another. One conflict on value code 66
is recorded as open rather than silently resolved.

### Post-audit: packaging switched from portable .exe to a one-click installer
Niall reported "a delay between double clicking on the portable and seeing anything" and asked for
a visible loading state. Measuring it changed the answer:

| | Time to window |
|---|---|
| Portable `.exe` | 7.5 – 9.9 s, **every launch** |
| Electron itself, unpacked | 0.84 s |
| Installed (per-user NSIS) | **0.99 s**, zero `%TEMP%` churn |

The portable target is a self-extracting archive that decompressed **366 MB** into `%TEMP%` on
every launch. `portable.nsi` does `RMDir /r $INSTDIR` both before extracting AND after exit, so it
can never be cached — which is why a cold start (7.66 s) and a "warm" one (7.50 s) measured
identically. ~6.7 s of every launch was repeated, discardable work.

A splash was tried first and rejected, correctly. Two findings, both verified rather than assumed:
- `portable.splashImage` **silently does not work**. `-DSPLASH_IMAGE=...` *was* passed to
  `makensis` (confirmed in the build log), but the `BgImage` plugin never drew — confirmed by
  sampling the screen every 450 ms across a full cold start; the splash's accent green never
  appeared until the app's own window did.
- A real progress bar is **unreachable by configuration**. `NsisTarget.js` reads `portable.nsi`
  unconditionally from electron-builder's template dir; unlike the installer target, the portable
  target ignores `script`/`include`. Without a splash the template runs `SetSilent silent`; with
  one it runs `HideWindow`. Neither path has a progress bar. Only patching `node_modules` would
  change that.

So the fix was to stop doing the extraction at all. `win.target` is now `nsis`, one-click,
`perMachine: false` — installs to `%LOCALAPPDATA%\Programs\claim-viewer` with **no admin and no
UAC prompt**, Start Menu + Desktop shortcuts, and `deleteAppDataOnUninstall: false` so
`session.json` and recents survive an upgrade. `differentialPackage: false` keeps `.blockmap`
updater artifacts out; `build.publish` stays absent, so `test/no-updater.test.ts` still passes.

**The visible loading is now the app's own animated loading screen** — at ~1 s it is the only
wait left, rather than being preceded by 7 blank seconds. Also fixed alongside: the window is
created with `backgroundColor` from `nativeTheme`, so the ~160 ms before first paint no longer
flashes white on a dark-theme machine.

Deployment note: updating is now "run the newer installer" rather than "replace one file". Still
unsigned, so SmartScreen still needs *More info → Run anyway* the first time.

### Also: the "File menu opens in the current window" report
Not a bug, but not visible either. Reopening a file that is already open focuses the existing tab
(the §2b dedupe, which exists because two TabStates sharing one main-process session made closing
either one break the other in Build 1). It did this **silently**, so it read as the menu behaving
differently from the toolbar. Both paths call the same `openClaimFlow()`; four E2E cases in
`e2e/menu-open.spec.ts` confirm the menu creates a new tab for a *different* file with 1, 2, or 3
tabs open. It now shows a toast: *"<file> is already open — switched to that tab."*

### Verification after the audit fixes
- typecheck: **pass** (3 configs)
- vitest: 202 → **258**, pass
- Playwright E2E: 47 → **49**, pass
- screenshots: 8 specs, regenerated
- exe rebuilt; asar verified to carry the **corrected values**, not just the filenames
  (occurrence 44/45/46, `OCCURRENCE_SPAN_CODES`, value 67/68/69, condition 81, TOB
  K/M/P — and "QIM" appearing exactly once, in the comment explaining why it must never
  appear again)
- **Every new assertion confirmed to fail against pre-fix code**: 26 of 44 new
  code-table assertions fail at `build-2-green`; with `style.css` reverted and the app
  rebuilt, exactly the two new 175% tests fail and the other four pass.

### Verification
- typecheck: **pass** (3 configs)
- vitest: 134 → **202**, pass
- Playwright E2E: 28 → **47**, pass
- screenshots: 7 → **8** specs (search light/dark added)
- exe: `release/837 Claim Viewer 0.0.1.exe` rebuilt, unsigned (intended)
- asar: 17 matches for fonts + `dist/src/data` — the eight decode tables ship as
  compiled `.js`; as `.json` they would have shipped EMPTY while every test passed
  (the same gap that silently disabled the PDF fonts once)

### Incident
`node_modules` was wiped by a subagent's `git worktree` cleanup (it used a worktree at
the pre-feature commit to prove its E2E tests fail without the feature — good
practice, bad cleanup). Detected immediately: `tsc` stopped resolving. Fixed with
`npm ci`; nothing committed was affected, since dependencies are gitignored.

### Needs Niall's eye
- Everything from Build 1 still stands (warning-explanation copy unreviewed, subtle
  status-bar copy icon, "Forget" is clear-now not stop-remembering).
- UI scale at 175% is verified **programmatically** (real `scrollWidth`/overlap/
  viewport-containment checks in the Electron renderer) but never seen by a human on
  a real 175%-DPI Windows display.
