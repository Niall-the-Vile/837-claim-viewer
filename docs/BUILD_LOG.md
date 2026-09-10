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

---

## Build 3 — Data integrity
STATUS: IN PROGRESS (3.1 GREEN; 3.2/3.3 in progress; 3.4-3.6 stretch, status TBD)

Start: 2026-09-10 20:26 UTC (session start `npm run verify`: 258 vitest + 53 E2E, green
at commit `5211701`, 2 commits past `build-2-green`)

This session ran as a single agent (not the multi-Sonnet-subagent orchestration the
original TABS/BUILD_QUEUE process describes) — the checkpoint/verify/audit
DISCIPLINE from those docs is followed, but "delegate to Sonnet subagents" (rule 5)
did not apply since there was one agent throughout.

### 3.1 — Extended structural warnings (non-clinical tier)
STATUS: GREEN

**Refactor first (verified byte-identical before any new rule):** moved
`validateClaim` / `isValidNpi` / `fmtCents` out of
`src/sources/json/jsonClaimSource.ts` into new `src/model/validate.ts`;
`jsonClaimSource.ts` re-exports the three names for backward compatibility (all
existing imports of them keep working unchanged); `x12ClaimSource.ts` now imports
`validateClaim` from the new module instead of reaching into the JSON source. Ran
`npm run verify` immediately after this move, before writing a single new rule —
258/258 vitest green, confirming byte-identical output on the original seven codes.

**New rules shipped** (all in `src/model/validate.ts` unless noted):
- **(a)** Replaced the never-implemented "revenue code without required HCPCS"
  rule (correctly not attempted — no offline-correct implementation exists) with:
  info-level `institutional-line-missing-revenue-or-proc` (neither a revenue code
  nor a procedure code) and `institutional-line-revenue-code-not-4-digits`.
  Gated on a new `normalizeTob(raw)` helper (strips one leading `'0'`, requires
  exactly 3 remaining digits, else `null`) applied to `institutional.typeOfBill`.
- **(b)** `line-dos-outside-statement-period` (warning, institutional only, both
  `statementFrom`/`statementThrough` non-blank, blank line-dates skipped, plain
  `'YYYY-MM-DD'` string compare — never `Date`) and `line-dos-in-future` (warning,
  every form type, string-compared against an injected `today` parameter that
  defaults to the real date, suppressed on a dental claim carrying a
  `predeterminationNumber` or an `orthodontics` block).
- **(c)** `duplicate-service-line` (info): exact-match key over
  fromDate/thruDate/procCode/sorted-modifiers/units/charge(cents)/revenueCode/
  toothNumbers/toothSurfaces; suppressed when the (shared) modifier set on the
  duplicate group contains any of 76/77/91/59/XE/XS/XP/XU/LT/RT/E1-E4/FA/F1-F9/
  TA/T1-T9/LC/LD/LM/RC/RI (`DUPLICATE_SUPPRESSING_MODIFIERS`, exact 39-entry set,
  asserted verbatim in `test/validate.test.ts`); message names all 1-based line
  numbers in the group.
- **(d)** Replaced the never-implemented "UB-04 0001 total vs detail sum" rule
  (redundant with `charge-total-mismatch`) with a mapping-time change in
  `x12ClaimSource.ts`: the UB-04 0001 (total) line is stripped out of
  `claim.serviceLines` entirely, and if `totals.totalCharge` is 0 (no CLM02), the
  stripped line's own charge becomes the total.
- **(e)** Dental tooth/surface validity: `isValidToothToken` (1-32, 51-82, A-T,
  AS-TS) and `isValidToothSurfaceToken` (every char in {M,O,D,F,L,B,I}), applied
  per comma-separated token on dental service lines only; never flags an absent
  tooth number. `dental-invalid-tooth-number` / `dental-invalid-tooth-surface`,
  both warning.
- **(f)** `billing-taxid-missing` (warning) / `billing-taxonomy-missing` (info,
  worded "situational — many payers do not require it").
- **(g)** EDI structural defects, X12-only (`x12ClaimSource.ts`, since neither
  concept exists in the JSON feed): `edi-se-count-mismatch` (SE01 vs actual
  segment count, transaction-wide via a new `applyEdiStructuralChecks`, attached
  to every claim in that transaction), `edi-duplicate-claim-id` (two claims in one
  ST/SE transaction sharing a non-blank CLM01), `edi-bad-date-qualifier` (DTP*472/
  434 must be D8 or RD8; DTP*435 must be D8 or DT — the DT case matters: an
  earlier draft of this rule used a single D8/RD8 set for all three and would have
  produced a **false positive** on `837I-all-fields.dat`'s genuine `DTP*435*DT*...`
  admission-date/time segment; caught before commit by running the new rule
  against every real fixture and confirming zero unexpected warnings, per the
  adversarial-audit discipline in BUILD_QUEUE.md rule 7).

All twelve new codes use only the two existing severities (`info`/`warning`) — no
third tier introduced. **No clinical-judgment / NCCI / MUE / upcoding rule was
added** (docs/FEATURE_BACKLOG.md "Out of scope" #2, restated in BUILD_QUEUE.md's
Build 3 preamble) — every rule above is a structural/date/format check.

**Explanations:** all twelve new codes added to the single copy file
`src/renderer/warningExplanations.ts` (same file as the original seven — no second
copy created), flagged "needs wording review" in that file's own header (unreviewed
first-draft copy, same status as the original seven from Build 2). New test
`test/warningExplanations.test.ts` asserts every one of the 19 known codes has a
non-blank entry AND that the table has no stale/orphaned entries (exact-count
check both directions).

**Data-table assertions:** `DUPLICATE_SUPPRESSING_MODIFIERS`'s full 39-entry set is
asserted verbatim (sorted-array equality against the spec list) in
`test/validate.test.ts`. `isValidToothToken`/`isValidToothSurfaceToken` are
asserted over **every** value in and around each valid range (0-32, 50-83, the
full A-T/AS-TS alphabets, and invalid surface letters), not spot-checked — per
BUILD_QUEUE.md's rule that any new lookup/validity table needs assertions
covering every value, the lesson from `docs/AUDIT_BUILD2.md`'s spot-checked code
tables shipping wrong decodes. These are validity SETS, not code->label decode
tables, so the "no two codes share a decoded string" mechanical check doesn't
apply the same way; the every-value-in-range sweep is the equivalent rigor for a
membership test.

**Adversarial self-audit performed before calling 3.1 done** (rule 7, "confirmed
CONFIRMED/REFUTED/ALREADY-ACCEPTED, default REFUTED"):
- Programmatically checked SE01 vs actual segment count on every committed X12
  fixture. **CONFIRMED finding, not caused by this build**:
  `test/fixtures/x12/837I-multi-claim.dat` has a genuinely mismatched SE01 (declared
  44, actual 58) — pre-existing in the fixture, not something 3.1 introduced. The
  new `edi-se-count-mismatch` rule now correctly flags it; no e2e/spec-oracle test
  asserts an exact warning count for that fixture, so nothing broke, but it's worth
  a fixture fix on a future pass (not attempted here — out of this session's scope,
  logged rather than silently patched).
- Checked every DTP date-format qualifier across every fixture against the accepted
  sets before finalizing rule (g) — see the DT/435 finding above (fixed pre-commit).
- Checked CLM01 uniqueness, revenue-code shapes, and billing tax ID/taxonomy
  presence across every fixture manually; no other unexpected warnings found on
  real fixture data.

### Verification (3.1 checkpoint)
- typecheck: **pass** (3 configs)
- vitest: 258 → **320** (62 new: `test/validate.test.ts` 48, `test/x12ClaimSource.test.ts`
  +14, `test/warningExplanations.test.ts` 4 — net +62 after removing 0 old tests), pass
- Playwright E2E: 53 → **53** (unchanged — 3.1 touches no renderer/UI surface), pass
- Playwright flake retried? no
- `npm run verify` (typecheck + vitest + build:app + e2e): **green**, full run

### Preload/IPC surface changes (rule 7b)
- None — 3.1 touches only `src/model/`, `src/sources/`, `src/renderer/warningExplanations.ts`
  (data/copy, not UI), and tests.

### 3.2 — CMS-1500 diagnosis overflow
STATUS: GREEN

**(a) The confirmed silent-truncation gap, fixed.** `drawDiagnoses`'s `DIAG_CELLS`
grid still has exactly 12 cells (pointers A-L) — that didn't change — but a claim
with more than 12 diagnoses now gets:
- An **on-form indicator** inside box 21 itself: the label line grows
  `· +N MORE — SEE LAST PAGE` (still routed through the same `fitText`, so it
  shrinks rather than overflowing the box).
- A **diagnosis continuation page**, appended once after the last service-line
  page, listing every diagnosis beyond ordinal 12 (`ordinal. code (POA: x)`) as
  plain text, with its own title/subtitle band and the same footer every other
  page draws (so "PAGE X OF Y" numbering counts it, and the disclaimer still
  appears on it too).
- New layout constants in `src/render/cms1500/layout.ts`
  (`DIAG_CONT_TITLE_RECT`, `DIAG_CONT_LIST_RECT`, `DIAG_CONT_LINE_H`), derived
  from the page's own margins/footer band — never hand-copied coordinates.
- `renderCms1500`'s internal page-drawing split `isLastServiceLinePage` (money
  totals on boxes 28-30) from `pageNumber`/`totalPages` (footer numbering,
  which now includes the continuation page) — previously the same
  `pageIndex === totalPages - 1` expression did both jobs, which broke the
  moment a continuation page could exist. Verified directly: a 13-service-line
  + 14-diagnosis combined case renders exactly 4 pages, with the total-charge
  string appearing exactly once (on page 3, the actual last service-line page)
  and never on the continuation page.

**Verified against `test/fixtures/1500-14-diagnoses.json`** (already existed from
Build 0's pre-flight fixture generation) — a claim with 14 diagnoses, 2 service
lines: renders exactly 2 pages, and both overflow diagnosis codes (ordinal
13 = `M25561`, ordinal 14 = `H269`) are present in the rendered text.
**Caveat found and documented, not silently worked around:** ordinal 14's code
(`H269`) happens to also be ordinal 1's code in this fixture, so its mere
presence in rendered text doesn't independently prove the continuation page
rendered it — `M25561` (ordinal 13, unique to the fixture) is the actual
load-bearing proof; the test comments this explicitly rather than presenting a
weaker check as if it were conclusive.

**(b) fitText(...minSize) truncation-gap audit** (every remaining call site,
`src/render/{cms1500,ub04,dental}/render*.ts`):
- Every UB-04/dental multi-value list (condition codes, occurrence codes/spans,
  value codes, diagnoses, missing teeth) already goes through `wrapWithOverflow`
  BEFORE reaching `fitText` — that helper already appends its own `+N more`
  marker when a list doesn't fit its allotted lines. `fitText` on those lines is
  a last-resort safety net for an already-bounded, already-token-limited string,
  not the primary overflow mechanism.
- Every other call site (all three renderers) operates on a single logical field
  value — a name, an address line, a code, a dollar amount, a label — where
  `fitText`'s shrink-then-ellipsis behavior is a visible degradation (a reader
  sees "…" and knows text was cut) rather than a silent drop of an entire list
  entry. Ellipsis on a single value was judged acceptable and out of this
  item's scope, which is specifically about **list truncation with no
  count-of-what's-hidden**.
- **Conclusion: no second truncation gap found beyond the CMS-1500 diagnosis
  one fixed in (a).** Full call-site list (25 sites) reviewed; none flagged.

### Region-builder work (required by this item, inherited by Build 4.2)
- `test/support/geometry.ts`'s `LayoutSpec.regions` now accepts `Rect[] |
  ((pageIndex, pageCount) => Rect[])` — a plain array still applies uniformly
  (every existing caller unchanged), and a function selects per-page regions for
  a form that can append a different page kind.
- `test/support/regions.ts` gained `cms1500ContinuationRegions()` (derived from
  the new layout constants + the existing footer band) and
  `cms1500RegionsPerPage(serviceLinePageCount, hasContinuation)`, the selector
  used by the new geometry case. Page-bounds and text-vs-text checks stayed
  active on every page; `GEOMETRY_TOLERANCE` and the 0.3pt overlap tolerance
  were not touched.

### Verification (3.2 checkpoint)
- typecheck: **pass** (3 configs)
- vitest: 320 → **325** (+5: 4 new tests in `test/invariants.test.ts`'s diagnosis-
  overflow describe block — including a combined multi-service-line-page +
  overflow case proving `isLastServiceLinePage`/`pageNumber` stay correctly
  decoupled — plus 1 new geometry case in the existing layout-invariants loop), pass
- Playwright E2E: 53 → **53** (unchanged), pass
- Golden manifests: **unchanged, no regeneration needed** — none of the 4 existing
  golden fixtures carries more than 12 diagnoses (checked: 837P-all-fields.dat has
  2, synthetic-1500.json has 2), confirmed by running the golden suite unchanged.

### 3.3 — Provenance footer on exports
STATUS: GREEN

New `src/render/provenance.ts` exports `RenderProvenance` (`sourceFileName`,
`sourceSha256`, `appVersion`, `renderedAt: Date`) and `provenanceFooterLines()`
(the two shared footer lines, worded identically across all three forms).
`renderCms1500` / `renderUb04` / `renderDental` each gained an **optional final
parameter** and draw the two extra lines only when it's supplied, inside the
already-declared footer region every renderer's `test/support/regions.ts` band
already spans (that band was already the full bottom margin, not just one
line's height, in all three forms — confirmed by inspection before writing any
code, so no region-builder change was needed for this item). The existing
"UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM" / "UNVERIFIED — NOT AN OFFICIAL ADA
FORM" disclaimer is **untouched** — provenance supplements it on the lines below,
never replaces it (docs/FEATURE_BACKLOG.md "Out of scope" #7).

`claimService.renderClaim(claim, provenance?)` forwards the optional param
verbatim to whichever form renderer handles the claim; its own signature is
otherwise unchanged, so `claim:getPdf` (preview) keeps calling it with no second
argument and renders exactly as before. `electron/main.ts`'s `dialog:exportPdf`
handler is the **only** caller that builds and passes a `RenderProvenance` —
`ClaimSession` gained a `sourceSha256` field (hashed once at file-open time over
the same UTF-8 text the app already parses, not re-read from disk at export
time), and the handler reads `session.fileName` + that hash + the build-info
version stamp + `new Date()` — all computed in `electron/main.ts`, never inside a
renderer. `getSessionClaim` was split into a `getSession` + index-check pair (pure
refactor, same validation) so the export handler can read the session's
fileName/hash alongside the claim.

**No preload/IPC surface change** — `dialog:exportPdf`'s signature (sessionId,
index) is unchanged; only its internal implementation changed. Rule 7b does not
apply.

**Verification that omitting provenance is byte-identical:** the six existing
determinism tests (2 per renderer) and all four pre-existing golden manifests
pass **unchanged** — confirmed by running `UPDATE_GOLDENS=1` and diffing: zero
byte changes in the four existing `test/golden/*.json` files, only the one new
frozen-provenance case's manifest was newly created (`docs/BUILD_QUEUE.md`'s "if
a golden diff appears on a default-path render, provenance is leaking" check —
it didn't).

**New tests:** `test/golden/render.test.ts` gained exactly one new case
(`cms1500-synthetic-json-with-provenance`, a frozen `RenderProvenance` object —
fixed date literal, fixed fake hash, fixed version string, never `new Date()`).
New `test/provenance.test.ts` (11 tests) covers all three renderers: omitting
provenance is byte-identical to a bare call, the two extra lines actually appear
with the right content, the disclaimer text is still present alongside them, page
count is unaffected, and geometry stays clean (`assertCleanLayout`).

### Verification (3.3 checkpoint)
- typecheck: **pass** (3 configs)
- vitest: 325 → **337** (+12: `test/provenance.test.ts` 11, `test/golden/render.test.ts`
  +1), pass
- Playwright E2E: 53 → **53** (unchanged; `e2e/app.spec.ts`'s open→preview→export test
  exercises the real `dialog:exportPdf` path end-to-end and still passes), pass
- `npm run verify` (typecheck + vitest + build:app + full Playwright suite): **green**

### Preload/IPC surface changes (rule 7b)
- None for 3.2 or 3.3.

### Golden/goldens regenerated (guardrail 8 in play — Build 3 lifts it)
- Commit will be titled `goldens: regenerate for 3.3 provenance footer` — the
  diff is additive only (one new file, `test/golden/cms1500-synthetic-json-with-provenance.json`);
  the four pre-existing golden files have zero byte changes, confirmed above.
