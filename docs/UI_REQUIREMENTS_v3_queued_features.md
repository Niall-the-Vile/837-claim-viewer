# UI requirements — queued features (Builds 2-6)

Requirements for the new surfaces in `BUILD_QUEUE.md`. Written so an unattended
build has a spec to implement against instead of inventing layout at 2am.

**These are requirements, not a visual design.** Build everything from the existing
design language: the tokens in `src/renderer/style.css`, the chrome established in
`docs/design/ClaimViewer_v2.dc.html`, and the patterns already in the app (inspector
field rows, warnings banner, export dialog, toast). Do not introduce a new visual
idiom, new colours, or new spacing scales.

**Universal rules for every surface below**
- Keyboard-complete, visible focus, `prefers-reduced-motion` honored.
- Severity is never colour-only — glyph + word, per `TABS_BUILD_PLAN.md` §2f item 4.
  There are exactly **two** severities (`info` | `warning` — `warning` = filled
  triangle + "Warning", `info` = outlined circle + "Note"); nothing below may imply
  a third tier.
- Every new panel/dialog participates in the existing focus model (F6 region cycling,
  `Esc` closes the top-most layer, modal dialogs trap and restore focus).
- Nothing may regress `TABS_BUILD_PLAN.md` §1 guardrails.
- Every new surface is implemented in its own file under `src/renderer/features/`
  (`search.ts`, `decode.ts`, `notes.ts`, `palette.ts`, `uiScale.ts`) exporting an
  `init()`/`render()` entry point, with `src/renderer/main.ts` touched only by one
  import and one call line; per-feature CSS in `src/renderer/features/*.css`
  imported from `style.css`. See `TABS_BUILD_PLAN.md` §2 item 0.
- Screenshot each new surface (light + dark) to `docs/screenshots/`, synthetic data
  only, via the single `e2e/screenshots.spec.ts` described in `BUILD_QUEUE.md` rule 6
  (one launched `ElectronApplication` reused for every shot) — do not add a second,
  per-build screenshot spec; append shots to the existing one.
- Every new surface adds its keyboard/focus/ARIA assertions to `e2e/a11y.spec.ts`
  (`TABS_BUILD_PLAN.md` §3a) before it may be called done.

---

## 1. Find / search  (Build 2.1)

**Purpose:** locate a value inside the parsed claim without reading the whole form.

- **Placement:** a search field pinned to the top of the **inspector**, not a floating
  overlay — the inspector is where the results live. `Ctrl+F` focuses it from anywhere;
  `Esc` clears the query and returns focus to where it came from. `Ctrl+F` is a
  no-op with no file open (do not steal focus); if the inspector is collapsed or
  hidden it is expanded/shown first, then the field is focused.
- **Behavior:** filter the inspector to matching field rows, **keeping each match's
  group heading visible** so a hit is never shown without its context (a bare
  "1730258417" is meaningless without "Billing provider · Box 33"). Inspector groups
  are `<details>` built collapsed (insured, providers, diagnoses, service lines, raw)
  — groups containing matches are force-opened while a query is active; each group's
  prior `open` state is captured on the first keystroke and restored verbatim when
  the query is cleared or `Esc` is pressed, and the "Expand all" control is disabled
  while a query is active. (Force-opening without restoring would make `Esc` quietly
  destroy the user's inspector layout — don't.)
- Match on the *value* and the *field label*, case- and punctuation-insensitive
  (`$1,204.00` must be found by `1204`; a date by `06/03` or `2026-06-03`).
- **Match count** beside the field ("7 matches in 3 groups"). `Enter` / `Shift+Enter`
  step through matches, scrolling each into view and giving it a persistent outline
  (not a flash — low-vision reviewers explicitly asked for a locator that stays).
  The match count, position ("match 3 of 7") and empty state live in a single
  `aria-live="polite" aria-atomic="true"` element beside the field, announcing count
  and position only — never matched row contents — debounced to the settled query.
- **837 batch:** when a file holds multiple claims, also report matches in *other*
  claims — "3 more matches in 2 other claims" with click-to-jump. Jumping switches the
  active claim and preserves the query.
- **Empty state:** "No matches for '<query>' in this claim" plus, when applicable,
  "…but 2 other claims in this file match."
- **Excluded tonight:** highlighting the matched box on the rendered PDF (needs
  Build 3.4's box geometry, wired by Build 3.6). Do not fake it.

## 2. Decoded code values  (Build 2.2)

- Show the decoding as **secondary text on the same inspector row**, never replacing
  the raw value: `11` → `11 · Office`, `0131` → `0131 · Hospital outpatient, admit
  through discharge`. The raw value stays first and stays copyable verbatim.
- Long decodings truncate with the full text in the row's `title`.
- Where no decoding exists, show the raw value alone — never "Unknown".
- A subtle, consistent affordance distinguishes decoded text from parsed data so
  nobody mistakes our lookup for something the claim actually said.
- Decoding is computed in **main** (`buildClaimDetail`) — see `BUILD_QUEUE.md` 2.2 —
  the renderer only displays `{ raw, decoded }`, it never looks anything up itself.

## 3. Warnings banner at volume  (Build 3.1)

Today's banner assumes ~2 warnings; Build 3 can produce a dozen.
- Show a **count and the highest severity** in the collapsed state ("9 data warnings
  — 3 warnings, 6 notes" — matching the two real severities, not three), expandable
  to the full list. Default collapsed when >3.
- **Group by severity, warnings before notes**; within a group, keep source order.
- The banner must never push the form preview below the fold — cap its expanded height
  and scroll inside it.
- Each row keeps its glyph + severity word, its plain-English explanation line, and
  (Build 3.5) is clickable to focus the offending field.
- **Live-region scoping:** only the collapsed summary line is the `role="status"`
  live region (as today — `#warnBanner`). The expandable list is a sibling container
  outside any live region, `role="group"` with `aria-labelledby` pointing at the
  summary, toggled by a disclosure `<button aria-expanded>` that owns it via
  `aria-controls`; Build 3.5's clickable rows are `<button>`s inside that group,
  **never** inside the live region. (Without this, a dozen interactive rows
  re-rendered on every claim step — and after Build 1, every tab switch — would each
  queue the whole list for screen-reader announcement.)

## 4. Batch export  (Build 4.1)

- **Entry:** an option in the existing export dialog when the open file holds >1 claim
  ("This claim" / "All N claims in this file"), not a separate menu item.
- **Destination:** a folder picker (not a save-file dialog) for the all-claims mode.
- **Progress:** determinate — "Exporting 34 of 312…" with the current claim's id, a
  cancel button, and taskbar progress. Cancelling stops promptly and leaves no partial
  files (the atomic temp-then-rename rule already applies per file).
- **Result:** a summary — "Exported 310 of 312. 2 claims could not be rendered." with
  the failures listed by claim id and reason, and an "Open containing folder" action.
  **A batch must never fail wholesale because one claim failed**; render placeholders
  and report them, consistent with how single-claim errors already behave.
- Filename collisions get a numeric suffix; the PHI-free naming rule still applies —
  see `BUILD_QUEUE.md` 4.1 for the exact pattern
  (`<billing provider> - <service date> - <NNN>.pdf`, NNN = 1-based claim ordinal in
  the source file, zero-padded to the claim count; billing provider and DOS are
  near-constant across a real batch, so the ordinal — not just a collision suffix —
  is what makes 312 files distinguishable).
- **Architecture:** rendering runs in the MAIN process, one claim at a time, yielding
  to the event loop between claims (`await new Promise(r => setImmediate(r))`) so
  progress and cancel are actually serviced; progress arrives over the bridge's first
  push channel (`onBatchProgress`), not by polling. See `BUILD_QUEUE.md` 4.1 for the
  exact preload surface (`exportBatch`, `cancelBatchExport`, `onBatchProgress`).
  Before shipping the progress UI, the 400-claim fixture is benchmarked and the
  measured throughput recorded in `BUILD_LOG.md`; if it's materially slower than the
  UI implies, the UI states the honest number rather than promising responsiveness it
  can't deliver.

## 5. Structured export options  (Build 4.3)

- Extends the existing export dialog with a **Format** choice: **PDF (default) ·
  CSV · JSON.** XLSX is **deferred** (needs a new runtime dependency that can't be
  installed unattended mid-run — see `BUILD_QUEUE.md` 4.3); if it lands in a future
  build, it slots into this same Format list.
- When a data format is chosen, reveal a **column profile** control:
  - **"Claim data only" (default, pre-selected)** — codes, amounts, dates, providers,
    identifiers-that-aren't-the-patient.
  - **"Include patient identifiers"** — explicit opt-in, visually marked as the
    sensitive choice, with a one-line consequence ("adds patient name, DOB and address
    to the file").
- A **third, independent** control, only relevant once Build 5.1 exists: **"Include
  my notes and triage marks"** — unchecked by default, listed separately from the
  column profile (not folded into "include patient identifiers"), with its own
  consequence line: "notes are free text and may contain patient details." Until
  Build 5.1 lands, this control doesn't exist and notes obviously aren't exported;
  once it lands, notes/triage columns are additive to the export (`BUILD_QUEUE.md`
  5.1), never on by default.
- The unencrypted-PHI / BitLocker notice stays visible for **all** formats, and the
  manifest line states what will be written ("312 claims · 1,847 service lines · CSV").
- Never silently change the user's last-used profile; default to the safe one each
  time — this applies independently to the column profile and the notes checkbox.
- Design the column list so appending notes/triage columns later is additive
  (`BUILD_QUEUE.md` 4.3).

## 6. Appended PDF pages  (Build 4.2)

Layout requirements for pages appended *after* the form facsimile — the facsimile
itself is unchanged and stays page 1.
- **Cover / claim-at-a-glance:** claim id, patient account, DOS span, billing provider
  + NPI, form type, line count, total charge, and the reconciliation verdict.
- **Field annex:** the inspector's groups as a plain two-column table, box numbers
  included, in the same order the inspector shows them.
- **Revenue-code rollup** (UB-04 only): revenue code, description, units, charges,
  subtotal per code, then the `0001` total — for long institutional bills.
- **Warnings page:** the full warnings list with severities and explanations.
- Every appended page carries the running footer, the page stamp, and the
  "UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM" disclaimer. Appended pages must be
  visually distinguishable from the form itself so nobody mistakes an annex for the
  claim. All optional and off by default except where the user selects them.
- Each page kind gets its own derived region set in `test/support/regions.ts`, per
  `BUILD_QUEUE.md` 3.2/4.2 — never hand-copied coordinates, never a loosened
  layout-overlap tolerance to make room for it.

## 7. Per-line notes, flags and check-offs  (Build 5.1)

The largest new surface in the queue. Anchored to a **service line**, not free-floating.
- **In the inspector's service-line group:** each line row gains a triage control
  (`OK` / `Verify` / `Dispute` / none) and a note affordance. A line with a note or a
  non-empty mark shows a persistent indicator so it's findable when collapsed.
- **Marks are glyph + word**, never colour alone, and appear in the line's accessible name.
- **Note editing** is inline (expanding textarea), autosaving on blur — no modal, no
  explicit Save button. Show a quiet "Saved" affordance; never a toast per keystroke.
- **Filter control**: "Show: all lines / flagged only / disputed only".
- **Claim-level summary**: "3 of 12 lines flagged · 1 disputed" near the group heading.
- **Persistence is per source-file + claim id.** If a note exists for a claim that is
  re-opened, restore it and say so unobtrusively ("Notes restored from a previous session").
- **Purge path:** the existing "forget open tabs & recent files" action gains a notes
  option, with a confirm step stating what will be deleted and that it cannot be undone.
- **Notes carry into the exported worksheet (Build 4.3) and the warnings/annex page
  (Build 4.2) only when the export dialog's "Include my notes and triage marks"
  checkbox (§5) is checked.** They are never included by default and never bundled
  into the "include patient identifiers" toggle — notes are a separate, independent
  disclosure the user opts into each time (§5's "never silently change the last-used
  profile" rule applies to this checkbox too).

## 8. Audit log viewer  (Build 5.2)

- Reachable from **About**, not the main toolbar — it's an occasional compliance tool.
- A read-only, newest-first table: timestamp, user, action, source file, destination,
  app version. **No claim content, ever** — the hashed claim id displays truncated.
- Actions: "Open log folder" and "Copy visible rows". No delete-from-UI (an audit log
  the app can silently erase is not an audit log); rotation is automatic and documented.
- State the retention policy in the panel itself.

## 9. UI scale and high-contrast  (Build 2.0 for scale, Build 6 for high-contrast)

**Scale ships in Build 2 (moved up from Build 6 — see `BUILD_QUEUE.md`'s
resequencing note); high-contrast render mode stays in Build 6.** The scale
mechanism is the acceptance criterion (survive 175%) for every surface Builds 2-5
add, so it has to exist before those surfaces do, not after.

- **UI text scale** lives in the View menu — 100 / 125 / 150 / 175% — scaling the app
  chrome **independently of PDF zoom**.
- **Mechanism (this is the part that was previously unspecified, and the obvious
  choices are all wrong — read before implementing):**
  - Implement it as a `--ui-scale` custom property applied as CSS `zoom` on the
    **shell wrapper only** (titlebar, menubar, tab strip, toolbar, inspector,
    statusbar, dialogs, toast) and explicitly **NOT** on `#pdfScroll` or the canvas.
  - `webFrame.setZoomFactor` / `webContents.setZoomFactor` are **FORBIDDEN** — they
    scale the pdf.js canvas too and change `devicePixelRatio`, which breaks per-tab
    PDF zoom and the `#pdfCanvas` width/height assertions in `e2e/app.spec.ts`.
  - Scaling `:root` font-size alone is a **near no-op** against a stylesheet with 257
    px-literal widths — it does not satisfy this requirement by itself.
  - Two mandatory sub-tasks:
    1. Convert the fixed container widths (`#inspector` 372px, `.dialog`
       520/600/720px, and every width/min-width on a text-bearing box) to em/ch so
       they grow with the scale.
    2. Every `getBoundingClientRect` reading used by Ctrl+wheel zoom-at-pointer and
       fit-page/fit-width must be divided by the active scale factor, covered by a
       vitest unit test on the fit-math function, not a screenshot (CSS `zoom` on a
       wrapper corrupts `getBoundingClientRect`, and that failure is invisible in a
       screenshot).
  - Persist the setting inside the existing `session.json` from `TABS_BUILD_PLAN.md`
    §2e — do not create a new `userData` file — and add it to
    `ALLOWED_USERDATA_FILES` (`BUILD_QUEUE.md` rule 12).
- **Verification is programmatic, not a screenshot:** at 100/125/150/175%, assert
  `scrollWidth <= clientWidth + 1` for text containers and that no two sibling
  control bounding boxes intersect; also assert `fitWidth` at 175% yields the same
  PDF zoom value as at 100% (proves the zoom-at-pointer/fit math is scale-corrected).
  Keep a screenshot as an additional artifact, not as the verification — "verify with
  a screenshot" is not a verification with no human present.
- **High-contrast form render** (Build 6) is a *view* toggle only. The exported PDF
  stays the faithful facsimile unless the user explicitly exports the high-contrast
  version, and the control must say which they're getting.

## 10. Command palette  (Build 6)

- `Ctrl+K` (and `F1` keeps opening the shortcut sheet). Fuzzy-filter over every action
  already reachable from the menus/toolbar — never a second, divergent list of features.
- Shows each action's shortcut, so the palette teaches the keyboard rather than
  replacing it. `Esc` closes and restores focus. Disabled actions appear but are marked
  unavailable with the reason ("no file open").
- (Advisory, not a blocking requirement tonight: if this build is genuinely wanted,
  it goes much more smoothly if Build 1 introduced a single `ACTIONS` registry
  (`{id,label,keys,group,enabledWhen,run}`) that menus/kbd hints/`KEY_GROUPS`/the
  keydown dispatcher are generated from — otherwise this build has to re-plumb every
  command the previous five builds wrote by hand. Not required, but worth knowing
  before Build 1's shortcut work starts.)

## 11. Deferred-render fast mode  (Build 6)

Opt-in only, a View-menu checkbox **"Fast open (render form on demand)", DEFAULT
OFF** — so all existing E2E paths (which assert `#pdfCanvas` has non-zero dimensions
immediately after open) are unchanged unless the user turns this on.

- When on, `#workspaceScreen` still shows (this is **not** a new state screen) with
  the inspector populated and `#pdfScroll` holding a centered placeholder card
  reusing the existing `.stateScreen` inner styles — form type, line count, and a
  primary "Render form" button.
- The placeholder is replaced in place on click, or on any zoom/page action.
- A background tab activated while in fast mode returns to the placeholder rather
  than auto-rendering — consistent with `TABS_BUILD_PLAN.md` §2's
  `loadClaimDetail`/`ensureClaimRendered` split (this feature is the same code path
  as background-tab pdf release and lazy session restore, not a separate lifecycle).
- Add one E2E that enables it explicitly, asserts the inspector is populated while
  `#pdfCanvas` is still 0×0, then asserts the canvas renders after the user requests
  it.

`BUILD_QUEUE.md` Build 6's "Deferred-render fast mode" bullet points here for the
full spec — this section did not exist before and is the largest change to the
app's primary surface in the queue, so it gets a written spec like everything else.
