# Build queue — run sequentially in the 2026-07-27 22:00 session

All builds run **back-to-back inside the single scheduled run**, not as separate
timed tasks: build durations are unpredictable, and two Claude sessions editing this
repo simultaneously would be destructive. Work the list in order and stop cleanly
per the wall-clock rules below.

Ordering follows the 50-reviewer panel's filing counts (`FEATURE_BACKLOG.md`) and
dependency order.

**Build 1 is TONIGHT'S DELIVERABLE. Builds 2-3 are likely; Builds 4-6 are stretch.**
Finishing Build 1 well beats starting Build 2. An honest morning report that ends
after Build 2 or 3 is the expected outcome — do not rush Build 1 to get further down
this list.

---

**UI requirements for every new surface in Builds 2-6 are in
`docs/UI_REQUIREMENTS_v3_queued_features.md`. Read it before implementing any of
them — search, decoded values, the warnings banner at volume, batch export,
structured-export options, appended PDF pages, per-line notes, the audit log viewer,
UI scaling/high-contrast, deferred-render fast mode and the command palette all have
a written spec. Do not invent layout for these.**

---

## Build 0 — pre-flight (before 22:00, human present)

This is **not** part of the unattended chain — a human (Niall) does this before the
22:00 session starts. Do not begin the run unless every item below is DONE or
explicitly waived.

**Already done:**
- [DONE] `git init`
- [DONE] Baseline commit + tag: commit `c1d4316`, tag `build-0-green`
  ("Pre-queue green baseline: v2 shipped (tabs queue not yet started)" — 104 vitest
  + 4 E2E, all green at the time of the tag).

**Outstanding — do before 22:00:**
- [DONE] Re-confirm `.gitignore` excludes `node_modules/`, `dist/`, `release/`, and
  `/test-results/` — don't assume it's still correct.
- [DONE] Split `package.json` scripts so `verify` stops packing a full exe on every
  build:
  ```
  "build:app": "tsc && npm run build:preload && node scripts/copy-fonts.mjs && vite build"
  "build:dist": "electron-builder"
  "build": "npm run build:app && npm run build:dist"
  "verify": "npm run typecheck && npm test && npm run build:app && npm run test:e2e"
  "verify:release": "npm run verify && npm run build:dist"
  ```
  Build 1 and the final build of the night use `verify:release` (they need a real
  packed exe — TABS §3d's asar check requires unpacking it); every other build uses
  `verify`. Without this split, six builds plus TABS §5's fix loop would mean
  15-20 full electron-builder packs tonight (364 MB win-unpacked, 91 MB exe,
  619 MB of node_modules re-scanned by Defender each time) for one deliverable pack.
- [x] Create `docs/BUILD_LOG.md` from the fixed per-build template — done as part of
  this edit; see that file.
- [DONE] Generate and commit the large fixtures via a new `scripts/make-large-fixture.mjs`
  (deterministic, generated from the existing all-fields fixtures with mutated ids/
  dates only): `test/fixtures/x12/837I-400-claims.dat`,
  `test/fixtures/x12/837I-long-lines.dat` (one UB-04 with 120 service lines),
  `test/fixtures/1500-14-diagnoses.json`, and `test/fixtures/837P-many-warnings.json`
  (one claim tripping >8 warnings). Build 3.2, 4.1 and Build 6 name these explicitly
  as required verification inputs. A feature specified at volume that was only
  exercised at N=2 (the largest fixture in the repo today is a 2-claim 837I) must be
  reported as **UNVERIFIED** in `BUILD_LOG.md` rather than generated ad hoc mid-build.
- [DONE] Drop **Source Serif 4**, **Open Sans**, **IBM Plex Mono** (.ttf/.woff2, SIL OFL)
  into `src/renderer/assets/fonts/` with their license files, before 22:00. This is
  strongly preferred over letting Build 1 fetch them at runtime — see the escape
  hatch at `TABS_BUILD_PLAN.md` §3d. If they genuinely can't be pre-staged, pin the
  exact download URLs and release tags in §3d instead of leaving the agent to search
  for them at 2am on an offline-postured machine.
- [DONE — deferred, CSV/JSON only] XLSX writer: **not** pre-installed, and Build 4.3 ships CSV/JSON only tonight —
  see Build 4.3 below. No action needed unless that decision changes before 22:00, in
  which case install the chosen package here and get `npm run verify` green with it
  BEFORE the session starts. Name the package in this section if you do.
- [DONE — GREEN at 104 vitest + 4 E2E, typecheck clean] Once the above is done, run `npm run verify` one more time. **Abort the whole
  run if it is not green at this point.**

If Build 0 cannot be fully completed before 22:00, the git init + baseline commit +
tag is the one piece that must not be skipped: without it nothing else tonight can be
recovered from, and the morning review has no diffs to read.

---

## Rules for EVERY build in this queue

1. **Start green or stop.** Before starting each build, run `npm run verify`. If the
   repo is not fully green (typecheck + vitest + build + Playwright E2E):
   `git reset --hard build-<N-1>-green` (back to the last known-good tag), record the
   abandoned SHA and what broke in `docs/BUILD_LOG.md`, and stop the whole chain.
   Never compound a failure. The finishing verify of build N IS the start gate for
   build N+1 — do not re-run it; run a fresh verify only at session start and after
   any recovery from red.

2. **Finish green, then checkpoint — with git, which now exists.** Each build ends
   with `npm run verify` (Build 1 and the final build of the night end with
   `npm run verify:release`, producing a freshly rebuilt `.exe`), then:
   ```
   git add -A && git commit -m "Build N: <summary>" && git tag build-N-green
   ```
   The orchestrator commits each subagent's work *before dispatching the next
   subagent*, so one bad agent's changes can be reverted individually without losing
   the rest of the build.
   `docs/BUILD_LOG.md` is the **single** morning report and is written ONLY by the
   main model — never delegate it to a subagent. Its `## Build N` section is
   appended at the START of each build marked IN PROGRESS, and updated to GREEN
   (commit SHA + tag, what shipped, "Not done and why", test/E2E counts before and
   after, exe path/timestamp/SHA-256, screenshots added, anything UNVERIFIED) at the
   end. Any audit performed during the build (see TABS §4/§5 and the equivalent for
   Builds 2-6) is written into that same `## Build N` section as an "Audit findings"
   subsection — there is **no** separate audit file. Subagents doing audit work
   return findings as text to the main model; they never write into `docs/`.

3. **Stop cleanly on wall-clock limits, not vibes.** "If usage/limits are running
   out" isn't observable before it's already happened mid-tool-call — use the clock
   instead (`Get-Date`):
   - No new build may **START** after 03:00.
   - If Build 1 is not green by 01:30, reduce the TABS §4 audit to dimensions 1, 2
     and 5, and end the run after Build 1.
   - At 05:00, stop unconditionally: finish the phase in progress to a green,
     verified state, checkpoint it (rule 2), and do not start another. A
     half-finished build left mid-refactor is far worse than a shorter queue.
   - Commit and append to `BUILD_LOG.md` at the end of every PHASE, not only every
     build, so a hard cutoff mid-build still leaves a committed, described state.
   - State plainly in `BUILD_LOG.md` where the chain stopped and why.

4. **Guardrails in `TABS_BUILD_PLAN.md` §1 apply to every build**, plus whatever the
   preceding builds added — with one scoping exception: **guardrail 8** (no changes
   to `src/render/**` or `src/sources/**`) is **BUILD 1 ONLY**. It is **LIFTED** for
   Builds 3, 4 and 6, which modify those trees by design. When changing them, the
   binding constraint instead is: every existing render/parser/invariant test must
   pass unmodified; goldens are regenerated only with
   `UPDATE_GOLDENS=1 npx vitest run test/golden/render.test.ts`, never hand-edited,
   and the manifest diff (which text runs moved, and why) is summarized in
   `BUILD_LOG.md` as a separate commit titled `goldens: regenerate for <item>`. An
   unexplained golden diff is a failed build; regenerating goldens to make an
   unexplained failure disappear is forbidden — stop instead. Re-read guardrails 1-7
   (and 9, added by this revision) at the start of each build.

5. **Delegate to Sonnet subagents; keep review/synthesis on the main model.**
   - `src/renderer/**`, `src/renderer/style.css` and `index.html` are a **single
     exclusive lock** — at most one subagent in flight against them at any moment.
     Parallel dispatch only when file sets are provably disjoint (`electron/**` vs
     `src/render/**` vs `src/sources/**` vs `test/**`). State the module ownership
     map in every delegation prompt.
   - Only the orchestrating session runs `npm run build`, `npm run verify`,
     `npm run build:dist` or `npx playwright test`. Subagents verify their own work
     with `npm run typecheck` and a targeted `npx vitest run <file>` ONLY — state
     this in every subagent prompt. Never run two subagents that both need to
     execute the app at the same time (shared unkeyed paths: `dist/`, `release/`,
     `test-results/`).
   - Confirmed audit findings are grouped by target file before dispatch. All
     renderer-file findings go to ONE agent in ONE pass with the full list; only
     genuinely disjoint file groups may be dispatched in parallel. Re-run verify
     after each dispatch wave, not only at the end.

6. **Screenshots to `docs/screenshots/`** for anything visual — synthetic fixtures
   only, never a real claim file (a screenshot of real data would put PHI in the
   repo). Put ALL screenshot capture in a single `e2e/screenshots.spec.ts` that
   launches one `ElectronApplication` in `test.beforeAll` and reuses it for every
   shot (toggling theme and tab count in-page rather than relaunching). Add
   `"screenshots": "playwright test e2e/screenshots.spec.ts"` to `package.json` and
   exclude that file from the default run via
   `testIgnore: ['**/screenshots.spec.ts']` in `playwright.config.ts`. Run it once
   per build at checkpoint time, AFTER the gate is green — a screenshot failure is a
   `BUILD_LOG.md` note, never a reason to stop the chain.

7. **Adversarial verification** before each build is called done: fan out, then
   verify every finding CONFIRMED / REFUTED / ALREADY-ACCEPTED, defaulting to
   REFUTED when it can't be reproduced. **Auditors are READ-ONLY** — dispatch with
   read/search tools only, no Edit/Write/mutating Bash. An auditor that reports a fix
   instead of a finding is a protocol failure: discard and re-dispatch. Each build's
   audit synthesis goes into that build's `## Build N` section of `docs/BUILD_LOG.md`
   (rule 2) — never a separate file.
   **7b.** Any new preload/IPC function is added to `electron/preload.ts`, its
   handler in `electron/main.ts`, its type in `src/renderer/global.d.ts`, AND the
   exact sorted key array in `e2e/app.spec.ts:121` — in the SAME subagent task, never
   split across agents. Exactly one subagent per build owns `electron/preload.ts`;
   other agents request keys through it. Each build appends its final key list to
   `BUILD_LOG.md`.

8. **Never distribute** the .exe anywhere. Producing it is the deliverable.

9. **Report honestly, including partial completion.** Never claim a success the
   command output doesn't support. **The single completion policy for the whole
   run:** finish the current item to green and checkpoint it; never leave a
   half-finished refactor; if an item truly cannot be finished, record exactly where
   it stopped in `BUILD_LOG.md` under "Not done and why" and leave the tree at the
   last green checkpoint. (This is the one and only partial-completion policy for
   tonight — see rule 10 for how it applies at sub-item granularity.)

10. **Sub-item failure is not chain failure.** If a numbered sub-item (e.g. "3.1(c)")
    can't be completed, revert that sub-item's partial work, leave the repo green,
    record it under "Not done and why" (rule 9), and continue to the next sub-item —
    unless a later queued item depends on it, in which case stop the *build*
    (checkpoint whatever is green) rather than the whole chain. Only a red repo
    (rule 1) or a wall-clock/usage stop (rule 3) halts the whole chain outright.

11. **Playwright flakes get exactly one retry.** If `npm run verify` fails ONLY in
    the Playwright stage, re-run `npm run test:e2e` once; if it then passes, log both
    outcomes in `BUILD_LOG.md` as a suspected flake and continue. Typecheck and
    vitest failures stop immediately (rule 1).

12. **Persistence (userData writes): one mechanism, stated once.** Any build adding
    a `userData` writer (session/recent-files, notes/triage, audit log) implements it
    as an Electron-free module under `src/app/persistence/` (`sessionStore.ts`,
    `notesStore.ts`, `auditLog.ts`) taking its base directory as an argument;
    `electron/main.ts` is the only caller and passes `app.getPath('userData')`.
    Verification is `test/persisted-artifacts.test.ts`, which holds one exported
    constant `ALLOWED_USERDATA_FILES` (filename → allowed-content predicate). It
    drives a full open → note → export → close cycle against a `mkdtemp` dir with the
    existing `SSN_CANARY_DIGITS` / `SSN_CANARY_DASHED` / `NAME_CANARY` constants,
    asserts no file outside the allowlist appears, asserts no canary appears in any
    of them, and asserts the session file DOES contain the fixture path (so the test
    proves the feature works, not just that nothing was written). A build may only
    APPEND a row to `ALLOWED_USERDATA_FILES`; it may never delete or weaken an
    assertion. **Leave `test/phi-at-rest.test.ts` unchanged** (its header comment may
    note the new file exists) — it imports only `src/app/claimService.js` and spies
    on in-process fs primitives, so it structurally cannot observe a `userData`
    write. It covers a different guarantee and must never be "re-scoped" to try;
    doing so four times across four builds is how a 122-line guard converges on an
    assertion that means nothing. No build may add a `userData` writer until the E2E
    profile-isolation prerequisite in `TABS_BUILD_PLAN.md` §2e lands.

---

## Build 1 — Tabs + polish (already specified)
See `TABS_BUILD_PLAN.md`. Run it first, in full, and treat it as tonight's actual
target. Note: the font swap (TABS §2d in the old numbering, now §3d) has been moved
to the END of Build 1 with a one-attempt-then-skip escape hatch — it must never block
or delay the tabs work itself.

---

## Build 2 — Search & code comprehension
*Panel themes #2 (27 filings) and #7 (11). Renderer/UI + bundled data only.*

**2.0 Independent UI text scaling** (moved up from Build 6 — see the resequencing
note at the end of this doc). Filed *critical* by the low-vision reviewer; CSS-only;
depends on nothing else in Builds 2-5; and is the stated acceptance criterion
(survive 175%) for every surface Builds 2-5 add, so it must land before them, not
after. Full mechanism and DoD are in `UI_REQUIREMENTS_v3_queued_features.md` §9 —
implement the scale mechanism only in this item (the high-contrast render toggle
covered by the same §9 is still Build 6).

**2.1 Find/search across the parsed claim — inspector half.**
`Ctrl+F` filters the inspector to matching fields (CPT, revenue code, member ID,
control number, dollar amount, date, tooth number), with a match count and
step-through. In an 837 batch, report which claims matched and jump to one. Full
behavior spec (group visibility, live region, `Expand all` interaction) is in
`UI_REQUIREMENTS_v3_queued_features.md` §1.
**Excluded tonight:** highlighting the matched box on the rendered PDF — that needs
per-box geometry from the renderers (Build 3.4/3.6).

**2.2 Plain-English decoding of public CMS code sets.**
Decoding is applied in **MAIN**, inside `buildClaimDetail` (`electron/main.ts`), so
the DTO carries `{ raw, decoded }` per coded field and the renderer stays a pure view
layer. Ship each code set as a plain `.ts` module exporting a `Record<string,string>`
under `src/data/` — compiled by `tsc` into `dist/src/**`, which electron-builder's
`files` list already includes. **Do NOT use raw `.json`**: `tsc` emits only `.js`
from `.ts` and never copies non-TypeScript assets (that is exactly why
`scripts/copy-fonts.mjs` exists), electron-builder's `files` list excludes
`!src/**/*`, and `tsconfig.json` does not set `resolveJsonModule` so a `.json` import
fails typecheck across all three configs. Cover place of service, type of bill,
frequency code, discharge status, revenue codes, condition/occurrence/value codes and
common modifiers. **Public CMS sets only** — CPT/ICD descriptors are AMA-licensed and
stay out.

---

## Build 3 — Data integrity
*Panel theme #4 (18 filings). Touches the warning engine and renderers under the
lifted guardrail 8 (rule 4) — the riskiest build in the queue; demands the strongest
fixtures and tests.*

**3.1 Extended structural warnings (non-clinical tier only).**
First task, before any new rule: extract `validateClaim` + `isValidNpi` + `fmtCents`
out of `src/sources/json/jsonClaimSource.ts` into `src/model/validate.ts`, re-export
from `jsonClaimSource` for compatibility, and have `x12ClaimSource` import from the
new module — the existing seven codes must produce byte-identical output, verified by
the existing golden/spec-oracle tests BEFORE any new rule is added.

Then the individual rules:
- **(a)** DELETE "revenue code without required HCPCS on outpatient bill types" — the
  required-HCPCS set is defined by the quarterly I/OCE and OPPS Addendum B, so there
  is no correct offline implementation (the same reason NCCI/MUE stay excluded
  below). Replace with: flag (info) any institutional service line that has neither a
  revenue code nor a procedure code, and any revenue code that is not 4 digits. Add a
  shared `normalizeTob(raw)` helper (strips one leading `'0'`, requires exactly 3
  remaining digits, else `null`) that every TOB-conditioned rule goes through and
  no-ops on `null`.
- **(b)** DOS rule: institutional only, only when `institutional.statementFrom` and
  `statementThrough` are both non-empty; skip lines with a blank date (valid on
  inpatient bills); compare `'YYYY-MM-DD'` strings, do not parse to `Date`; suppress
  future-DOS on dental claims carrying a `predeterminationNumber` or an orthodontics
  block; inject `today` into `validateClaim` as an optional parameter so tests pin it.
- **(c)** Duplicate lines: duplicates only when ALL of fromDate, thruDate, procCode,
  modifiers (sorted set), units, charge, revenueCode, toothNumbers and toothSurfaces
  are equal; suppress when either line carries 76, 77, 91, 59, XE, XS, XP, XU, LT,
  RT, E1-E4, FA, F1-F9, TA, T1-T9, LC, LD, LM, RC or RI; severity info; message names
  the 1-based line numbers.
- **(d)** DELETE "UB-04 0001 total vs detail sum" — `charge-total-mismatch` already
  covers it; instead exclude any service line whose `revenueCode` is `'0001'` from
  `claim.serviceLines` at the source, and if `totals.totalCharge` is 0, use its
  charge as the total.
- **(e)** Dental: valid tooth numbers 1-32, 51-82, A-T, AS-TS (supernumeraries are
  valid); surfaces each char in {M,O,D,F,L,B,I}; never flag an absent tooth number.
- **(f)** Provider: missing billing-provider tax ID → warning; missing taxonomy →
  info, worded "not present (situational — many payers do not require it)".
- **(g)** EDI structural defects (SE01 counts, duplicate CLM01, bad qualifiers) as
  originally scoped.

Every new code adds its one-sentence plain-English explanation to the SAME single
copy file created in TABS §2f.6, with a test asserting every emitted code has an
entry, and all new strings listed verbatim in `BUILD_LOG.md` under "needs wording
review". **Clinical-judgment edits (NCCI/MUE/upcoding) stay out** — they need
quarterly CMS files an offline app can't keep current, and a stale table producing
confident wrong flags is worse than no flag. All new codes are non-blocking flags,
using the **TWO** existing severities only (`'info' | 'warning'` — see TABS §2f.4;
there is no third tier, and none of these rules introduces one).

**3.2 CMS-1500 diagnosis overflow — the one genuine silent-truncation gap.**
Service-line pagination **ALREADY EXISTS** in all three renderers (`renderUb04`'s
`paginateServiceLines` with a hard throw if a line would be dropped, CMS-1500's
`BOX24_TABLE.maxRowsPerPage`, dental likewise) and `test/invariants.test.ts` already
asserts page counts and per-line markers. **Do NOT rewrite it.** The actual gaps are:
- **(a)** CMS-1500 diagnoses beyond pointer L are dropped by `drawDiagnoses`
  (`DIAG_CELLS` has 12 cells) with only an info warning and no on-form indicator —
  add an overflow marker or a diagnosis continuation block, verified against
  `test/fixtures/1500-14-diagnoses.json` by asserting the dropped codes appear
  somewhere in the rendered text.
- **(b)** Audit every remaining `fitText(...minSize)` call site for ellipsis
  truncation with no "+N more" equivalent and list them in `BUILD_LOG.md`.

These change page composition, so `test/support/regions.ts` and
`test/invariants.test.ts` must be extended in the same change: each new page kind
(continuation / cover / annex / rollup / warnings) gets its own exported region
builder derived from that page's own layout constants (never hand-copied
coordinates), and `assertCleanLayout` takes a per-page region selector instead of one
region array for the document. Page-bounds and text-vs-text overlap checks stay
active on every page. Loosening `GEOMETRY_TOLERANCE`, the 0.3pt overlap tolerance, or
narrowing the check to page 1 is forbidden. **Build 4.2 inherits this same
region-builder requirement.**

**3.3 Provenance footer band on exports.**
Renderers gain an optional final parameter
`provenance?: { sourceFileName: string; sourceSha256: string; appVersion: string; renderedAt: Date }`.
Every varying value is passed IN — never `new Date()` or a hash computed inside the
renderer. When `provenance` is omitted, output must be byte-identical to today, so
the six determinism tests and all four golden manifests pass unchanged.
`renderClaim`'s existing signature is unchanged for its current callers. Only the
export path (`electron/main.ts` → `claimService`) supplies provenance. Add exactly
one new golden case rendered with a frozen provenance object. If a golden diff
appears on a default-path render, provenance is leaking — fix that, do not
regenerate. The "visual facsimile, not a submittable form" disclaimer **stays** —
this footer supplements it, never replaces it.

**3.4 Per-box geometry — LAST item in Build 3, explicitly droppable if time is
short.** Do NOT change the signature of `renderCms1500`/`renderUb04`/`renderDental`
or `renderClaim` — the golden, determinism and invariant tests all call them
directly. Add a separate pure export per form,
`boxGeometry(claim): Array<{ fieldKey: string; page: number; rect: {x,y,width,height} }>`
in that form's `layout.ts`, derived from the same constants the drawing code uses, in
PDF points with bottom-left origin matching `test/support/regions.ts`'s `toPdfRect`
convention; service-line rows keyed `line.<n>.<field>`. Expose it to the renderer as
a separate `claim:getGeometry(sessionId, index)` IPC so `claim:getPdf` is untouched
(apply rule 7b: preload key, handler, type, and the E2E key array in the same
change). Test by asserting each returned rect contains the corresponding drawn text
run read back with `renderedTextBoxesByPage()`.

**3.5 Clickable warnings that focus the offending field** — requires warnings to
carry a stable field/line anchor, which fits naturally with 3.1's rule-engine work.

**3.6 Wire Build 2.1's search step-through to 3.4's geometry** — a positioned outline
div overlaid on the canvas, not a canvas repaint; the renderer converts PDF points to
viewport pixels by the active zoom. If 3.4 was dropped, or 3.6 doesn't get built
tonight either way, state plainly in `BUILD_LOG.md` that search-highlight is deferred
to Build 7 — it must not be left implicitly unowned.

---

## Build 4 — Export suite  *(newly unblocked)*
*Panel themes #6 (12) and #10 (9). Niall approved structured export on 2026-07-27.*

**4.1 Batch export** every claim in an 837 to individual PDFs.
Rendering happens in the **MAIN** process. Main owns the loop and for each claim:
renders one claim, writes it with the existing `writeFileAtomic`, drops the byte
reference before the next (never accumulate rendered PDFs in an array), calls
`win.setProgressBar(done/total)`, pushes
`webContents.send('export:batchProgress', {done,total,claimId})`, then
`await new Promise(r => setImmediate(r))` so the cancel invoke and progress sends are
actually serviced. Preload gains exactly three keys — `exportBatch`,
`cancelBatchExport`, and `onBatchProgress(cb): () => void` (wrapping
`ipcRenderer.on`, stripping the `IpcRendererEvent` argument so no sender object
reaches the renderer, returning an unsubscribe). This is the **first push channel**
in the bridge. Update `e2e/app.spec.ts`'s key array in the same change (rule 7b).
Before building the UI, bench the 400-claim fixture
(`test/fixtures/x12/837I-400-claims.dat` from Build 0) and record ms/claim and peak
RSS in `BUILD_LOG.md`; if throughput is worse than ~10 claims/sec, state the measured
number in `BUILD_LOG.md` as a known limit rather than shipping a progress UI that
pretends otherwise.
Filename: `<billing provider> - <service date> - <NNN>.pdf` where NNN is the claim's
1-based ordinal within the source file, zero-padded to the claim count (the ordinal
is a position in the interchange, not patient data, so guardrail 4 is satisfied);
keep the numeric collision suffix as a second-line fallback only.
Progress/cancel, per-claim failure reporting, memory-safe repeated renderer
invocation — see `UI_REQUIREMENTS_v3_queued_features.md` §4 for the full UX spec.

**4.2 Appended summary pages**: claim-at-a-glance cover, inspector field annex,
revenue-code rollup for long UB-04s, warnings + reconciliation carried into the PDF.
Inherits 3.2's region-builder requirement for `test/support/regions.ts` /
`test/invariants.test.ts` — each new page kind gets its own derived region set; do
not loosen the layout checker to accommodate it.

**4.3 Structured export — CSV / JSON of the normalized model. APPROVED.**
CSV and JSON only tonight — both are zero-dependency string formatters written in
main and persisted with the existing `writeFileAtomic`. **XLSX is DEFERRED**: it
requires a new runtime dependency, an npm install, lockfile churn and an asar
re-pack, none of which should happen unattended. If XLSX is wanted, the writer must
be installed and `npm run verify` green with it BEFORE the 22:00 session starts, and
the chosen package named in Build 0.
One row per service line plus claim header fields. **This writes claim CONTENT to
disk** — a deliberate policy step beyond the file paths already persisted:
- Default to a **PHI-minimal column profile** (identifiers, codes, amounts, dates,
  provider info — no patient name/DOB/address), with a clearly-labelled opt-in
  "include patient identifiers" toggle for when the destination genuinely needs it.
- The export dialog's unencrypted-PHI / BitLocker notice must appear here too.
- Update `README.md`'s data policy and the About screen so the app's stated behavior
  matches what it now does.
- This is a user-chosen save location, not `userData` — rule 12's persistence
  mechanism doesn't apply here. `test/phi-at-rest.test.ts` stays untouched regardless.
- Design the column list so appending notes/triage (Build 5.1) later is additive.

**Deferred from this build:** true 1:1 print (Ctrl+P). It needs a human at a physical
printer to confirm CMS-1500 box registration — cannot be validated unattended.

---

## Build 5 — Notes & audit  *(newly unblocked)*
*Panel theme #8 (11 filings). Niall approved persistence and the audit log on
2026-07-27.*

**5.1 Per-line notes, flags and check-offs — now PERSISTENT. APPROVED.**
Per-line notes, Dispute/Verify/OK triage marks, filterable, carried into an exported
worksheet under the conditions below. Persist keyed to the source file + claim id
under `userData` — see rule 12 for the persistence module + `ALLOWED_USERDATA_FILES`
mechanism; do not touch `test/phi-at-rest.test.ts`.
- **This puts free-text that will quote patient details on disk.** Store it in one
  clearly-named file so it can be found and purged; extend the existing "forget open
  tabs & recent files" action to offer clearing notes too.
- Update `README.md` and the About screen.
- **Build 4's exporters ship WITHOUT notes.** Extending them is 5.1's job: add
  `note` and `triage` columns to the 4.3 structured export and a notes section to the
  4.2 annex page, and update Build 4's exact-string exporter tests in the same
  commit — an intentional golden change, stated as such in `BUILD_LOG.md`.
- Notes carry into the exported worksheet **only** when the export dialog's
  separate "Include my notes and triage marks" checkbox (unchecked by default — see
  `UI_REQUIREMENTS_v3_queued_features.md` §5) is checked. This checkbox is
  independent of the 4.3 PHI-minimal column-profile toggle, whose consequence copy
  keeps naming only name/DOB/address — notes are a second, separate disclosure the
  user opts into.

**5.2 Local audit log — metadata only. APPROVED.**
For HIPAA accounting of disclosures (filed *critical* by both the compliance
attorney and the privacy officer). Record: timestamp, Windows user, action (open /
export / print), source path, **hashed** claim identifier, export destination, app
version.
- **Claim content must never be logged** — no patient names, no codes, no amounts.
- Append-only, one file under `userData` (rule 12), with a documented
  retention/rotation story (cap size, roll over) and a way to view it from the About
  screen.
- Add a test asserting the log contains no PHI canary after a full open/export cycle
  (folds into `test/persisted-artifacts.test.ts` per rule 12).

---

## Build 6 — Accessibility & performance
*Panel theme #9 (10 filings). Visual — screenshot everything; expect a human pass.*

- **High-contrast / greyscale form render mode**, keeping the faithful facsimile as
  the export default. See `UI_REQUIREMENTS_v3_queued_features.md` §9 (the UI-scale
  mechanism itself already shipped as Build 2.0 — this bullet is the render-mode
  half only).
- **Deferred-render fast mode** — see `UI_REQUIREMENTS_v3_queued_features.md` §11 for
  the full spec (opt-in, default OFF, placeholder card inside `#workspaceScreen`,
  routed through Build 1's `loadClaimDetail`/`ensureClaimRendered` split). Filed
  *critical* by the old-PC reviewer; ~80% of reads only need the fields.
- **Keyboard command palette**, go-to-box, preview panning, warning stepping.

---

## Design status — UPDATED 2026-07-27 evening

`docs/design/ClaimViewer_v2.dc.html` was re-imported from Claude Design and now
contains screens for **Batch export progress** (4.1), **Appended pages** (4.2),
**Audit log** (5.2) and **Command palette** (Build 6), plus in-design treatments for
search (2.1), per-line notes (5.1), UI scale (2.0) and high contrast (Build 6).

**For those surfaces the design file is AUTHORITATIVE for layout**;
`UI_REQUIREMENTS_v3_queued_features.md` remains authoritative for behaviour, states,
keyboard and accessibility. Read the matching design screen before implementing —
do not invent a layout that already exists, and do not "improve" on it.

This does NOT change tonight's priorities: Build 1 is still the deliverable and
Builds 4-6 are still stretch. A designed screen you never reach is not a reason to
rush Build 1.

## DESIGN-GATED — do NOT build tonight

These two are still **not** in the design file (verified: no triage-pane screen, and
no side-by-side diff screen). They remain gated. Building them from my own layout
judgment would waste the work.

- **Side-by-side compare with field-level diff** (22 filings — the most-cited payoff
  of tabs). Needs a model-diff algorithm, a service-line matching key
  (CPT + modifiers + DOS), split layout, and a decision on how changes are marked.
- **837 batch triage pane** (16 filings) — sortable/filterable roster of every claim
  in the file with warning roll-up and click-to-jump.

Once the design lands, these become Build 7.

---

## Still blocked — need a decision

| Item | Decision needed |
|---|---|
| Redaction profiles in exports | Sign-off on which identifiers each profile masks; must be burned into the content stream, not overlaid. |
| Idle auto-lock + PHI purge | Policy vs preference, and the timeout value. |
| Export destination guardrails | *Not selected on 2026-07-27.* Hard-block or warn-and-acknowledge for removable/consumer-sync volumes. |
| True 1:1 print | Needs a human at a printer to verify box registration. |
| Headless CLI mode | Only worth building if the repricing tooling will actually consume it. |
| Tear-off claim windows | Multi-window + mixed-DPI; only worth it if dual-monitor use is common. |

---

## Review edits not applied

None. All 31 plan edits from `docs/PLAN_REVIEW.md` "Plan edits to apply" were applied
across `BUILD_QUEUE.md`, `TABS_BUILD_PLAN.md`, `UI_REQUIREMENTS_v3_queued_features.md`
and `ROADMAP.md`. No edit was judged wrong or inapplicable.
