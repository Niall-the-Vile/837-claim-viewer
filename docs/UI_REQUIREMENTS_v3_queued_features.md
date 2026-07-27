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
- Severity is never colour-only — glyph + word, per Build 1's §2f item 4.
- Every new panel/dialog participates in the existing focus model (F6 region cycling,
  `Esc` closes the top-most layer, modal dialogs trap and restore focus).
- Nothing may regress `TABS_BUILD_PLAN.md` §1 guardrails.
- Screenshot each new surface (light + dark) to `docs/screenshots/`, synthetic data only.

---

## 1. Find / search  (Build 2.1)

**Purpose:** locate a value inside the parsed claim without reading the whole form.

- **Placement:** a search field pinned to the top of the **inspector**, not a floating
  overlay — the inspector is where the results live. `Ctrl+F` focuses it from anywhere;
  `Esc` clears the query and returns focus to where it came from.
- **Behavior:** filter the inspector to matching field rows, **keeping each match's
  group heading visible** so a hit is never shown without its context (a bare
  "1730258417" is meaningless without "Billing provider · Box 33").
- Match on the *value* and the *field label*, case- and punctuation-insensitive
  (`$1,204.00` must be found by `1204`; a date by `06/03` or `2026-06-03`).
- **Match count** beside the field ("7 matches in 3 groups"). `Enter` / `Shift+Enter`
  step through matches, scrolling each into view and giving it a persistent outline
  (not a flash — low-vision reviewers explicitly asked for a locator that stays).
- **837 batch:** when a file holds multiple claims, also report matches in *other*
  claims — "3 more matches in 2 other claims" with click-to-jump. Jumping switches the
  active claim and preserves the query.
- **Empty state:** "No matches for '<query>' in this claim" plus, when applicable,
  "…but 2 other claims in this file match."
- **Excluded tonight:** highlighting the matched box on the rendered PDF (needs
  Build 3.4's box geometry). Do not fake it.

## 2. Decoded code values  (Build 2.2)

- Show the decoding as **secondary text on the same inspector row**, never replacing
  the raw value: `11` → `11 · Office`, `0131` → `0131 · Hospital outpatient, admit
  through discharge`. The raw value stays first and stays copyable verbatim.
- Long decodings truncate with the full text in the row's `title`.
- Where no decoding exists, show the raw value alone — never "Unknown".
- A subtle, consistent affordance distinguishes decoded text from parsed data so
  nobody mistakes our lookup for something the claim actually said.

## 3. Warnings banner at volume  (Build 3.1)

Today's banner assumes ~2 warnings; Build 3 can produce a dozen.
- Show a **count and the highest severity** in the collapsed state ("9 data warnings —
  2 errors"), expandable to the full list. Default collapsed when >3.
- Group by severity, errors first; within a group, keep source order.
- The banner must never push the form preview below the fold — cap its expanded height
  and scroll inside it.
- Each row keeps its glyph + severity word, its plain-English explanation line, and
  (Build 3.5) is clickable to focus the offending field.

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
- Filename collisions get a numeric suffix; the PHI-free naming rule still applies.

## 5. Structured export options  (Build 4.3)

- Extends the existing export dialog with a **Format** choice: PDF (default) ·
  CSV · XLSX · JSON.
- When a data format is chosen, reveal a **column profile** control:
  - **"Claim data only" (default, pre-selected)** — codes, amounts, dates, providers,
    identifiers-that-aren't-the-patient.
  - **"Include patient identifiers"** — explicit opt-in, visually marked as the
    sensitive choice, with a one-line consequence ("adds patient name, DOB and address
    to the file").
- The unencrypted-PHI / BitLocker notice stays visible for **all** formats, and the
  manifest line states what will be written ("312 claims · 1,847 service lines · CSV").
- Never silently change the user's last-used profile; default to the safe one each time.

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
- Notes carry into the exported worksheet (Build 4.3) and the warnings/annex page.

## 8. Audit log viewer  (Build 5.2)

- Reachable from **About**, not the main toolbar — it's an occasional compliance tool.
- A read-only, newest-first table: timestamp, user, action, source file, destination,
  app version. **No claim content, ever** — the hashed claim id displays truncated.
- Actions: "Open log folder" and "Copy visible rows". No delete-from-UI (an audit log
  the app can silently erase is not an audit log); rotation is automatic and documented.
- State the retention policy in the panel itself.

## 9. UI scale and high-contrast  (Build 6)

- **UI text scale** lives in the View menu — 100 / 125 / 150 / 175% — scaling the app
  chrome **independently of PDF zoom**. Persist it. Every layout must survive 175%
  without clipping or overlap; this is the fix for the low-vision reviewer whose
  Windows scaling currently breaks the app, so verify at 175% with a screenshot.
- **High-contrast form render** is a *view* toggle only. The exported PDF stays the
  faithful facsimile unless the user explicitly exports the high-contrast version, and
  the control must say which they're getting.

## 10. Command palette  (Build 6)

- `Ctrl+K` (and `F1` keeps opening the shortcut sheet). Fuzzy-filter over every action
  already reachable from the menus/toolbar — never a second, divergent list of features.
- Shows each action's shortcut, so the palette teaches the keyboard rather than
  replacing it. `Esc` closes and restores focus. Disabled actions appear but are marked
  unavailable with the reason ("no file open").
