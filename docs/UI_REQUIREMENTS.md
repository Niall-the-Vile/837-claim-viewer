# UI Requirements (Hardened) — Offline 837 EDI Claim‑Form Viewer

*Windows / Electron · view‑only · fully offline · no pricing math*

This document is design‑ready: every blocking and major review finding is resolved with a concrete decision, and minor findings are folded in. Where a value genuinely depends on a Brotherhood brand asset the team must supply, a defensible **recommended placeholder** is given so visual design can proceed without blocking, and the item is listed in Open Questions.

---

## 0. Canonical Vocabulary (use these exact terms everywhere)

| Concept | Canonical UI term | Never show |
|---|---|---|
| 837P claim | **Professional (CMS‑1500)** | "P", "837P", "ST 222" |
| 837I claim | **Institutional / Hospital (UB‑04)** | "I", "837I" |
| 837D claim | **Dental claim** | "D", "ADA", "837D", "Dental summary" |
| Version the viewer can't draw | **Can't show as form** | "Unsupported X12 version", raw code in primary path |
| Envelope count mismatch | **Claim count could not be confirmed** | "unverified", "envelope reconciliation" (primary path) |
| The one claim driving the preview | **Active claim** | "selected" (ambiguous) |
| The export set | **Checked for export** | "selected" (ambiguous) |
| Close the open file | **Close file** | "Close/Clear" |
| Extra data band under a form | **additional details band** | "addendum band" (primary path) |

Status‑bar type summary reads **"287 Professional · 40 Hospital · 13 Dental"**, never "287 P · 40 I · 13 D". Single‑letter P/I/D may appear only inside a tooltip.

---

## 1. Product Goals

A view‑only Windows desktop app that opens a raw X12 837 EDI file (a batch of many claims), renders each claim onto the correct form (CMS‑1500, UB‑04, or the **ADA Dental claim** form), and exports the whole batch — or a chosen subset — to PDF. No pricing, no Medicare math, no editing, no network.

1. **Make an opaque EDI file legible** for a non‑technical negotiator.
2. **Never lose or silently drop a claim, service line, diagnosis, or field.** Every claim is listed; every failure is a *visible* placeholder or marker, never an omission. Truncation and dropped values are marked **on the form itself**, not only in a panel the reader may never open.
3. **Faithful, print‑accurate output.** True physical size is guaranteed **on the printed PDF** (print at 100%, no fit‑to‑page). On‑screen "Actual Size" is a best‑effort approximation (see §14.4).
4. **Trustworthy about data quality.** Parse warnings, count mismatches, reconciliation gaps, and form‑type provenance are surfaced honestly and non‑blockingly.
5. **Safe with PHI, provably offline.** No persistence, no recent‑files, no cloud, PHI‑free filenames by default, folder‑reveal (not auto‑open) as the default done action.
6. **Zero‑friction for a small non‑technical team.** Open → browse → export in a few obvious, always‑visible clicks.

**Explicit non‑goals (must not appear anywhere):** field editing, repricing, claim submission, network features, accounts/login, cloud sync, auto‑update touching claim data, telemetry, recent‑file history.

---

## 2. Target Users

Small internal Brotherhood negotiator team. Non‑technical; fluent in Windows, Excel, PDFs, File→Open. **Not** fluent in EDI/X12. Windows 11, often dual‑monitor, mouse‑first with keyboard accelerators. Mental model: *"I have a file of claims. Show me each as the paper form I recognize, let me flip through them, and give me a PDF."*

EDI‑native detail (segment IDs, loop names, raw segments, version codes) is **available on demand** in the inspector, never in the default reading path.

---

## 3. Screen / View Inventory

1. **App shell / chrome** — native OS title bar (native frame, see §16.1), always‑visible menu bar, always‑visible workspace action bar (Open + **Export**, non‑optional), status bar.
2. **Welcome / no‑file view** — empty state; Open button, whole‑window drop target, **"Open sample claims (synthetic test data)"** link, one‑line offline reassurance. No recent files.
3. **Loading / parsing view** — two‑phase progress (§10), Cancel, rows stream in progressively.
4. **Main workspace (three‑region master–detail)** —
   - **4a. Claim list (master)** — virtualized column table, search, filter chips, dual selection.
   - **4b. Form preview (detail)** — pdf.js canvas, one page at a time, zoom, page nav, claim nav.
   - **4c. Inspector drawer** — structured field readout (always present in DOM for accessibility), warnings, raw segments. Visually collapsible; **its content is never removed from the accessibility tree**.
5. **Export dialog** — scope, mode, destination, warnings, manifest summary.
6. **Export progress + result** — determinate progress, Cancel, success/partial/failure/cancelled.
7. **File‑level error view** — non‑X12, unreadable ISA, or wrong transaction/version whole‑file mismatch.
8. **Valid‑file‑no‑claims view** — parsed fine, zero renderable claims.
9. **Partial / aborted‑parse view + banner** — parser died mid‑file; keep what parsed.
10. **Count‑mismatch (unverified) banner** — non‑dismissable strip across the workspace.
11. **Resource‑limit / too‑large view** — soft warning + graceful hard‑fail.
12. **About / Offline & PHI notice** — versions, hashes, offline assurance, PHI guidance, PDF‑accessibility limitation.
13. **Keyboard shortcuts reference** overlay.
14. **Standard OS dialogs** — native Open (single‑selection), native Save‑file, native folder‑picker.

---

## 4. Component Inventory

### 4.1 App shell
- **Menu bar** — always visible (`autoHideMenuBar:false`), Alt mnemonics `&File / &View / &Help`.
  - **File:** Open… (Ctrl+O), Open sample claims, Export… (Ctrl+E), Export this claim (Ctrl+Shift+E), Close file (Ctrl+Shift+W), Exit (Alt+F4).
  - **View:** Zoom In/Out/Actual Size/Fit Page/Fit Width, Show inspector (Ctrl+D), Next/Previous claim, Next/Previous page, Go to claim… (Ctrl+G).
  - **Help:** About, Offline & PHI notice, Keyboard Shortcuts (F1).
- **Workspace action bar (non‑optional)** — a persistent, text‑labeled band in the workspace containing at minimum **Open**, **Export** (primary, brand‑green filled button), a **Search** field, the **zoom cluster**, and the **claim** and **page** navigators as two visually distinct, labeled groups (see §8). Line‑art icons, each with a visible label or tooltip. This bar is *layout‑flexible* but its presence and the visibility of Open/Export are **required**; they must never live only behind a menu.
- **Status bar (bottom)** — file name (middle‑ellipsized); **"Claim x of N"** (always full‑batch, source order); per‑type counts (**"287 Professional · 40 Hospital · 13 Dental"**); unsupported/failed counts; verified vs **"Claim count unconfirmed"** state; **offline indicator** ("Offline — no network access", quiet, with icon + text); a subtle busy indicator during parse/render/export. Overflow priority defined in §17.6.

### 4.2 Welcome / empty state
- Primary **"Open EDI file"** button.
- Whole‑view **drop zone** with coarse dragover affordance (see §11): single dragged item → "Ready to open" styling; folder/multi‑item → reject styling (icon + "Open one file at a time"). Real validation happens post‑drop.
- Accepted‑types hint: **"Opens any EDI / text claim file."** (extension is a hint, not a gate — see §11).
- **"Open sample claims (synthetic test data)"** link — loads a bundled ISA15=T fixture, clearly labeled non‑PHI demo, visually distinct from a real batch (a persistent "Sample data" chip in the status bar). Uses no recent‑files mechanism.
- One‑line reassurance: "Runs fully offline. Claim data stays on this machine."
- **No recent‑files list. No `addRecentDocument`. Empty Jump List.**
- Inline reject/error affordance lives here for coarse drop rejections; true parse failures route to the full‑view file‑level error (§5).

### 4.3 Claim list (master) — column table
The list is a **true column grid**, not stacked cards. Single‑line rows for density.

**Columns, in order** (left→right), with alignment and behavior:

| # | Column | Align | Font | Width | Truncation |
|---|---|---|---|---|---|
| 1 | Checkbox (export) | center | — | fixed 32px | — |
| 2 | Seq # (source index) | right | mono | fixed 56px | never (stable ID) |
| 3 | Patient name | left | sans | flex, min 140px | tail‑ellipsis + tooltip |
| 4 | Claim # (CLM01) | left | mono | ideal 120px | middle‑ellipsis + tooltip |
| 5 | Billing provider | left | sans | flex, min 120px | tail‑ellipsis + tooltip |
| 6 | Total charge (CLM02) | **right, decimal‑aligned** | mono | fixed 110px | never (numeric — see §13) |
| 7 | Form type badge | center | — | fixed 132px | letter+shape, not hue |
| 8 | Pages | center | mono | fixed 44px | — |
| 9 | Status cell | center | — | fixed 72px | precedence + "+N" (below) |

- **Sticky header row.** Row height target 32–36px. **Truncation priority when width is tight:** billing provider truncates first, then patient name; Seq #, Claim #, charge, badge, pages, status never truncate.
- **Missing / degenerate cells:** an absent value renders as a muted em‑dash "—" with tooltip "not present in source" (never a blank that reads as data loss). Patient name falls back to the **subscriber** name when the patient loop is absent (patient *is* the subscriber), tagged in the tooltip. A CLM02 that mismatches the summed line charges shows a small reconciliation marker on the charge cell (see §18).
- **Status cell precedence** (show highest‑priority glyph + "+N" for the rest, each glyph = icon + tooltip + text, never color alone): **Couldn't display (render‑failed) > Can't show as form (unsupported) > Form‑type uncertain > Replacement or voided > Has warnings.** Form‑type badge and Pages have their own columns and never compete with status glyphs for space.
- **Rows are attacker‑influenced text** → rendered as plain text only, never interpreted as markup.

**Search field** — `Ctrl+L` / `Ctrl+F` focuses it. Placeholder: **"Search patient, claim #, or provider — or type #12 for a claim number in the list."** Semantics: case‑, diacritic‑, and whitespace‑insensitive **substring** match against **normalized underlying values** (not the display string): patient name **and** subscriber name, CLM01 (matched both padded and unpadded), billing‑provider name. Typing `#<n>` jumps to source index *n*. Out‑of‑scope fields (rendering provider, service dates) are intentionally not searched. Debounced 150–200 ms, async, never blocks input; the prior result set stays visible until the new one resolves (no flash‑to‑empty). Matched substrings are highlighted in the row; when the match is on a non‑primary field, that field is shown/labeled so the user sees *why* the row matched. Live "Showing X of N" readout.

**Filter chips** — two facets: **Form type** (Professional / Hospital / Dental / Can't show as form) and **Status** (Has warnings / Couldn't display / Form‑type uncertain / Replacement or voided). Chips are **multi‑select toggles**. Combination rule: **within a facet, chips OR; across facets and against the search text, everything ANDs.** Each chip shows a live count. Failed/unsupported claims are always reachable via these chips and via the Seq # jump, even when name/claim‑# extraction failed.

**Dual selection model (the single most load‑bearing behavior — specified exactly):**
There are **two independent concepts with distinct visual treatments**:
1. **Active claim** — exactly one row. Drives the preview. Set by single‑click and by arrow‑key movement. Visual: a **left brand‑green rule + bold text + subtle fill**, exposed as `aria-selected` / roving `tabindex`. Non‑color cue (the left rule + bold) is required so it is distinguishable without color.
2. **Checked‑for‑export set** — zero or more rows. Built **only** by the checkbox column, `Space`, `Ctrl+Click`, `Shift+Click`, and the select controls. Visual: the checkbox state (filled check glyph) + a faint row tint, exposed as the checkbox's `checked` state. Non‑color cue (the check glyph) required.

Rules (never violated):
- Single‑click / arrow keys move the **active claim** and update the preview but **never** change any checkbox.
- Checkbox / `Space` / `Ctrl`/`Shift`‑click toggle **checks** and **never** change the active claim or the preview.
- **Roving‑focus keyboard grid:** `↑/↓` (or `Ctrl+↑/↓`) move focus + active claim without altering checks; `Space` toggles the focused row's check; `Shift+↑/↓` extends a contiguous checked range from an anchor; `Ctrl+↑/↓` may be used to move focus while the app treats bare arrows as the primary mover — bare arrows are the documented default and both are equivalent for moving the active claim.
- **Selection persists across filter/search changes.** A checked claim hidden by a later filter stays checked and stays in export scope. When any checked claims are hidden, the list header shows **"12 selected (7 hidden by current filter)"** with one‑click **"Show selected"** and **"Deselect hidden"** affordances.
- **Select controls:** distinct **"Select all in file (N)"**, **"Select filtered (M shown)"**, and **"Clear selection (K)"**. "Select filtered" adds only currently‑visible rows; "Select all in file" checks the entire batch regardless of filter.
- **Close file** and **opening a new file** wipe the checked set and the active claim.

**Deterministic order** — always source/segment order. **User sorting is NOT offered in v1** (removes the ambiguity entirely). Seq # is the permanent source‑order position and the stable reference used by the export footer, the failure list, and `Ctrl+Home/End`.

**List header / summary** — total claims, per‑type counts, count with warnings, count failed, plus the filtered subtotal ("Showing 18 of 340") and the hidden‑selected indicator when relevant.

### 4.4 Form preview (detail)
- **pdf.js canvas** rendering the exact form page that will be exported (same coordinate‑mapped content; see fidelity note §19).
- **Single‑page paged mode** (locked): the canvas shows exactly **one** form page at a time. Prev/Next Page and the page readout swap pages. Scroll/pan operate only within the current page and never cross into the next page. **Export page order == preview page order.**
- **Zoom cluster** — In, Out, Actual Size, Fit Width, Fit Page, plus a % readout. Ladder: **25 / 50 / 75 / 100 / 125 / 150 / 200 / 300 / 400%**, min 25%, max 400%. Buttons/shortcuts step the ladder; `Ctrl+wheel` zooms continuously within the same bounds, **anchored at the cursor**; button/keyboard zoom anchors on viewport center. **Zoom level persists across claim and page navigation** (only the page index resets to 1 on claim change). Default on claim selection: **Fit Page** (whole form incl. totals visible).
- **Page navigation (within claim)** — Previous/Next page + **"Page x of y"** (a jump control) + optional page dropdown/thumbnail rail. Visually and positionally distinct from claim navigation (see §8).
- **Claim navigation** — Previous/Next **claim**, kept in sync with the active row.
- **Additional details band** — when a claim renders one (ambulance CR1, HCP repriced, origin/destination, or overflow relocations per §13), it appears on the page; the inspector notes "Extra service details are shown in a band below the form." Whether the band is its own page or an appended region: **it is an appended region of the last service‑line page it belongs to, and is counted within that page** — it is *not* a separate entry in "Page x of y" unless it overflows to its own continuation page, in which case that continuation page is counted normally.
- **Panning** — drag (grab/grabbing cursor, shown **only** when content exceeds the viewport) or wheel: **plain wheel = pan vertically; `Shift+wheel` = pan horizontally; `Ctrl+wheel` = zoom.** Wheel never changes page or claim. **Keyboard panning:** when the canvas has focus, arrow keys pan; `Home/End` jump to page edges. `Esc` (or `Tab`) returns focus to the list (documented focus‑escape — no keyboard trap).
- **Sub‑states:** *Can't show as form* → a generated placeholder page ("This claim can't be shown as a paper form" + generic summary); *render‑failed* → an error placeholder page referencing segment position only; *preview loading* → skeleton (thresholded, §12).
- **Form‑basis provenance chip** (top of preview and inspector header): e.g. **"Professional (CMS‑1500) — detected from ST 005010X222"**. When the transaction‑set version and claim content disagree, or the version was inferred rather than read cleanly, downgrade to a **"Form type uncertain"** badge (icon + text) and add the claim to the "Form‑type uncertain" status filter.

### 4.5 Inspector drawer (progressive disclosure + accessibility spine)
- **Structured field readout** — human‑readable, grouped: Patient, Subscriber, Providers (billing/rendering/referring/facility), Payers (P/S/T order with prior‑paid), Diagnoses (A–L, indicator/POA), Service lines (dates, charge, units, NDC/drug qty, modifiers). Read‑only.
- **Every field is tagged with its source box/FL/loop number** (e.g. "Box 24A Date(s) of service", "FL50 Payer A", "Box 21.A Diagnosis") so the text readout is spatially reconcilable with the visual form and with a colleague's verbal reference. **Every mapped box present on the canvas has a corresponding labeled entry here, including empty/placeholder pages.**
- **Single source of truth:** the readout and the form overlay are rendered from **one field‑extraction/mapping layer** — they are the same values, not a re‑parse. A render‑time assertion flags any field where overlay text and readout value differ, surfaced as a data warning ("Box 28: form/readout mismatch").
- **Accessibility guarantee:** the structured readout is **always present in the DOM and the accessibility tree**, regardless of whether the drawer is visually open. `Ctrl+D` toggles only visual presentation. The canvas carries `aria-label` + `aria-describedby` pointing at the readout for the current page. AT reading order: claim row → form summary → field groups.
- **Bidirectional form↔field linking:** clicking or focusing an inspector field scrolls the preview to and briefly outlines the corresponding box (auto‑switching to the page that box is on); hovering/clicking a form region surfaces the matching inspector row. Highlight is icon + outline (never color alone) and **never mutates export bytes**.
- **Warnings expander** — "N data warnings on this claim," expandable. Warning classes: reconciliation (Σ line charges vs CLM02), NPI length/checksum, date/format, overflow/truncation, slot‑count overflow, **reference integrity** (dangling diagnosis pointer, missing referenced provider/payer loop, payer‑sequence gap), delimiter‑in‑data suspicion, form/readout mismatch. Non‑blocking, attention (not alarm) treatment.
- **Raw‑segment viewer** — collapsed by default; the claim's raw X12 segments for troubleshooting. Never shows raw element *values* inside error strings.
- **Per‑claim export shortcut** — "Export this claim only" (Ctrl+Shift+E).

### 4.6 Export dialog
- **Scope selector** (radio), with the resolved scope + count always shown as text at the top ("This will export **312 claims**"):
  - **Whole batch (N)**
  - **Checked claims (K)** — the checkbox set, *including checked‑but‑hidden claims*; shows "(K checked, J hidden by current filter)" when relevant.
  - **Current filter (M shown)** — exports exactly the currently visible filtered rows.
  - **This claim only** — the **active** previewed claim, echoed by identity ("This claim only — Claim #A1234").
  - **Default preselection:** Checked claims when K ≥ 1; otherwise Current filter when a filter is active; otherwise Whole batch. When the resolved scope is 0, **Export is disabled** with inline text ("No claims in scope — check rows, adjust the filter, or choose Whole batch").
- **Mode toggle:** **One PDF** vs **One file per claim** (per‑claim limits PHI blast radius).
- **Destination (mode‑dependent):**
  - *One PDF* → native **Save‑file** dialog (main process owns the path). Default name `‹sourceBasename›_claims_YYYY‑MM‑DD.pdf`.
  - *One file per claim* → native **folder‑picker** + a shown filename‑pattern preview. Default per‑file name `‹sourceBasename›_claim-‹NNN›_‹formtype›.pdf` where `NNN` is the zero‑padded source index and `formtype` ∈ {professional, hospital, dental, placeholder}. **No patient name or CLM01 in filenames by default** (PHI‑free). Illegal characters stripped, length‑capped; collisions auto‑suffix ` (2)`, never silent overwrite. If a patient‑identifying token is ever offered it is strictly opt‑in with an inline "PHI will appear in filenames" warning.
  - Default destination resolves to a **non‑synced** location.
- **Sync‑location warning** — inline, if the chosen path resolves under OneDrive/Dropbox/Google Drive.
- **Manifest / pre‑export summary** — broken down by type and status, e.g. *"312 claims: 300 Professional, 12 Hospital; includes 2 render failures (exported as error placeholders) and 5 that can't be shown as forms (placeholder pages)."* This doubles as the PHI confirmation surface and makes placeholder inclusion explicit.
- **PHI notice** — "This PDF is unencrypted PHI. Store on a BitLocker volume only." (Decision 2026‑07‑24: BitLocker guidance only — **no in‑app password‑encryption checkbox in v1.** The export dialog does not offer encryption; the designer should not include that control.)
- **Unverified note** — when the batch's claim count is unconfirmed, remind that every exported page is footer‑stamped (verbatim text in §20).
- **Primary Export button + Cancel.**

### 4.7 Export progress / result
- **Determinate progress** with textual step ("Writing claim 128 of 340"), **Cancel** (aborts cleanly; no partial/half‑written file left). If total work isn't yet known, an **estimated / indeterminate** fallback is shown until it is. Progress is mirrored on the **Windows taskbar button** (`setProgressBar`, cleared on completion/cancel).
- **Per‑claim render timeout:** a claim that hangs is converted to an **error placeholder** and export continues.
- **Counting model (locked):** every claim in scope — including render‑failures and can't‑show‑as‑form claims — **is written** (as a placeholder page). So the done state reads **"Exported 340 of 340"** with a secondary line **"including 2 error placeholders and 5 placeholder pages."** "Not exported" is reserved **only** for a hard write/render abort of the whole job.
- **Result states:** *Success* ("Exported 340 claims to ‹folder›"); *With placeholders* (as above); *Failure* — disk‑full or write‑denied name the failing **step** (not any data value) and offer "Retry to a different location"; *Cancelled* — leaves no partial file.
- **Done actions:** **"Open containing folder"** is the **primary** action (opens Explorer, inert). **"Open PDF"** is offered only in One‑PDF mode and carries a one‑line caveat "opens in your system PDF app"; it is **omitted entirely in per‑claim mode**.

### 4.8 Banners & notices
- **Count‑mismatch banner** (non‑dismissable): plain numbers — **"This file says it contains 340 claims, but only 338 were found. It may be incomplete or damaged."** Persists across the workspace; affected claims flagged. `role="alert"` (announced assertively, does not steal focus).
- **Partial/aborted‑parse banner** (non‑dismissable, visually distinct from the count‑mismatch banner): "Reading stopped at segment 5,120. The 4,999 claims read so far are shown; the rest of the file could not be read." Offers "Export what was read" and "Open a different file."
- **Offline indicator** — always visible, quiet, status bar (icon + text).
- **Toasts** — transient confirmations only (export done), announced politely. Errors are shown inline/in‑dialog, never as disappearing toasts.

### 4.9 Global
- **Close file** — clears in‑memory claim state and checked set; confirms if an export is mid‑flight, otherwise immediate; returns to Welcome.
- **Keyboard shortcuts reference** overlay (F1) with a per‑focus‑context column.

---

## 5. States (all explicit)

- **App start / empty** — Welcome; offline indicator on; menus limited to Open/sample/About/Help.
- **Loading (two‑phase)** — see §10. Rows stream in; the list becomes interactive for already‑parsed claims immediately; the progress indicator lives in the status bar rather than freezing the workspace.
- **Success (batch open)** — three‑region workspace; **first claim auto‑selected at Fit Page**; status bar summarizes; focus moves to the first claim row and the batch summary is announced via a status region.
- **Empty result after filter/search** — "No claims match" inside the list with a **"Clear search / filters"** affordance; distinct from the app‑level empty state. Appears only after the debounced filter settles with zero matches.
- **Valid file, no renderable claims** — workspace‑level state (not a parse error, not a filtered‑empty list): "This file opened correctly but contains no claims to show." Shows envelope facts (interchange found, N transactions, 0 claims), claim count 0 in the status bar, and "Open a different file."
- **File‑level parse error** — full‑view friendly error naming the detected type in plain language ("This isn't an EDI claim file — it looks like a PDF," "The file header couldn't be read"). No stack trace. "Open a different file." Focus moves to the error heading.
- **Wrong transaction / version (whole file)** — full‑view file‑level error, plain language: "This is a payment / remittance file (835), not a claim file," or "This claim file uses an older format this viewer doesn't support yet." (The per‑claim "Can't show as form" placeholder is reserved for individual STs of an unsupported release *inside* an otherwise‑supported 837 batch — the routing rule: whole‑file mismatch → full‑view error; mixed‑batch single ST → per‑claim placeholder.)
- **Count‑mismatch (unverified)** — success layout **plus** the non‑dismissable banner (§4.8); footer stamp on export.
- **Partial / aborted parse** — the claims read so far are shown, plus the distinct aborted‑parse banner; "Export what was read" available.
- **Per‑claim render failure (isolated)** — batch otherwise fine; the claim shows an error glyph and, when active, an error placeholder page referencing segment position only. A batch closing‑summary lists all failed claims, each linking to its row.
- **Can't‑show‑as‑form claim** — listed normally (patient / claim # / total from the generic model) with the "Can't show as form" badge; preview shows the placeholder page, never a guessed form.
- **Export dialog, invalid scope (0 in scope)** — Export disabled with inline guidance (§4.6).
- **Export in progress / success / partial / failure / cancelled** — per §4.7. Workspace interaction limited but cancellable, never fully frozen.
- **Preview loading (per claim)** — thresholded skeleton (§12).
- **Resource limit** — during/after the scan phase, a soft warning for very large files ("This file is very large — N claims; loading may take a while"); a graceful hard‑fail message on out‑of‑memory / file‑too‑large that names the limit and suggests splitting the file, with Cancel available mid‑load. Never a crash or blank screen.
- **Theme change while loaded** — chrome re‑skins instantly; the form canvas keeps its rendered bytes, zoom, scroll, and page (it's paper — it doesn't change); banners, focus ring, and status glyphs re‑resolve to the new theme's tokens; reduced‑motion honored (no cross‑fade).
- **Idle‑with‑warnings** — active claim has warnings; inspector shows the "N warnings" expander in an attention (not alarm) treatment.

---

## 6. Interactions

- **Open a file** — File→Open (native, single‑selection, default filter `*.dat;*.edi;*.txt` **plus an "All files (*.*)" option**), Welcome button, drag‑and‑drop anywhere on the window, or launching a file as an argument. **Validity is decided by ISA‑header content, not extension.** Opening a new file (any path, incl. a second‑instance launch or a drop while a batch is loaded) raises the same **"Close the current file?"** confirmation before replacing; the app never opens a second window (single‑instance lock, §16.3).
- **Multi‑file / folder open** — native Open is single‑selection; a multi‑file or folder drop is rejected with an inline "Open one claim file at a time" message (never silently takes the first).
- **Browse the batch** — scroll the virtualized list; single‑click or arrow keys set the active claim and preview; Next/Previous claim buttons; `Ctrl+G` / `#n` jump to a source index.
- **View a form** — selecting a claim renders page 1 at Fit Page; multi‑page claims expose page navigation.
- **Zoom & page** — per §4.4; each preview change stays consistent with export.
- **Search / filter** — per §4.3; on a filter change, if the active claim is still visible it stays active; otherwise the first result becomes active and previews (or the empty‑result state shows). `Enter`/`↓` from the search box move the active claim into the result list. "Clear search" restores the prior active claim when possible.
- **Select for export** — checkboxes / `Space` / `Ctrl`/`Shift`‑click; select‑all‑in‑file / select‑filtered / clear; running counts and hidden‑selected indicator; selection drives export scope, never display order.
- **Export single claim** — inspector or row context menu → export dialog pre‑scoped to that claim.
- **Export batch / subset** — File→Export or the action‑bar Export button → dialog → scope + mode + destination + manifest → native Save/folder → progress → result.
- **Cancel** — parse and export are both cancellable via the Cancel button and `Esc`; cancel is always safe (no partial artifact). A cancelled **parse** offers "Keep the ‹K› claims read so far (marked incomplete)" vs "Discard."
- **Inspect raw data** — open inspector, expand warnings, optionally raw segments.
- **Close/clear** — explicit; wipes in‑memory state and selection; returns to Welcome.
- **Context menu on a row** — Preview, Export this claim, Show details, Copy claim number (plain text). No destructive actions.
- **Error recovery** — every error path offers a forward action.

---

## 7. Data Shown Per View

### 7.1 Claim list row
Checkbox · Seq # · patient name (subscriber fallback) · claim # (CLM01) · billing provider · total charge (CLM02, decimal‑aligned) · form‑type badge · page count · status cell. Empty cells show "—" with "not present in source."

### 7.2 Status bar
File name · "Claim x of N" (full batch) · "287 Professional · 40 Hospital · 13 Dental" · unsupported/failed counts · verified vs "Claim count unconfirmed" · offline indicator · sample‑data chip when applicable.

### 7.3 Form preview — mapped boxes
- **CMS‑1500 (Professional):** patient/insured boxes; Box 21 diagnoses (ICD‑10 indicator, A–L); Box 24 grid (dates, POS, CPT/modifiers, dx pointers translated to letters, charges, units/minutes, rendering NPI, shaded NDC band); providers (17/25/31/32/33 with NPIs/taxonomy/tax ID); COB (9/11/29); totals (28/29/30); additional‑details band when present; "Page x of y."
- **UB‑04 (Institutional / Hospital):** FL04 type of bill; patient/subscriber; value/occurrence/span/condition codes (FL18–41); revenue‑line grid with rev codes and line‑23 `0001` total; diagnoses/procedures FL66–81 with POA; payer rows FL50–65 in A/B/C order; page stamps.
- **Dental claim:** see §21 for the full field map, column order, wireframe, brand spec, and pagination threshold.

### 7.4 Inspector — structured readout
Same values as the form (single extraction), labeled key/value groups with **box/FL/loop tags**, warnings list, raw‑segments section. Never shows raw element values in error text.

### 7.5 Export dialog
Resolved scope + count · type/status manifest · mode · destination path (or folder + filename pattern) · PHI/sync/unverified notices. (No encryption option in v1.)

### 7.6 About / notice
App version · Electron/CVE‑pin note · template + coordinate‑map version/hash · offline assurance · PHI guidance (BitLocker, no sync, unencrypted export, non‑persistence) · **exported‑PDF accessibility statement** (§10.7).

**Never displayed anywhere:** recent‑file history; any element *value* inside an error message/toast/log line (errors reference segment IDs/positions only).

---

## 8. Navigation Model

- **Single primary window**, three‑region master–detail. No browser‑style history.
- **Two orthogonal, visually and behaviorally distinct axes** in the detail area: **between claims** (list selection / Next‑Prev claim) and **within a claim** (Page 1..y). To prevent confusion they are enforced concretely:
  - The **claim navigator** and the **page navigator** are separate labeled groups ("Claims" vs "Pages of this claim") with distinct control shapes and positions in the action bar.
  - A **one‑time, non‑modal inline hint** appears the first time a multi‑page claim is opened, explaining the difference (no blocking tour).
- **Modality:** Export is a modal dialog; Open/Save/folder are native OS dialogs. The inspector is a non‑modal drawer.
- **Position persistence:** selecting a claim resets the page view to page 1 (zoom persists). Returning to a claim need not restore its inner page.

**Layout geometry (canonical, locked):**
- **Left claim list** — resizable splitter, default ~320px, min 240px, max 420px.
- **Center preview** — flexible, min width = the form width at Fit Page.
- **Right inspector** — a **collapsible drawer that overlays** the right edge of the preview (does **not** compress the preview's fixed geometry). Default **collapsed**. `Ctrl+D` toggles. Default width 360px (min 300, max 480).
- Splitters are draggable with a double‑click‑to‑reset; splitter positions persist across launches (never claim data).
- **Minimum window size 900×600.** Responsive collapse order (same thresholds whether triggered by window size or OS text scaling):
  - **Below ~1100px:** inspector is overlay‑only (already the default), never a third fixed column.
  - **Below ~820px effective:** the claim list collapses to a toggleable rail/overlay, leaving the preview full‑bleed; a persistent control re‑opens it.
  - The preview always retains a guaranteed minimum height; the count‑mismatch banner is the only always‑full band, while offline/PHI notices collapse to status‑bar glyphs on short windows.

---

## 9. Keyboard Shortcuts & Focus Model (Windows conventions)

### 9.1 Focus & context
- **Focusable regions (ordered focus ring):** Search field → Claim list → Preview canvas → Inspector. **`F6` / `Shift+F6`** cycle regions; a **visible active‑pane indicator** shows which region owns focus.
- **Scope rule:** claim/page navigators bound to `Ctrl`‑modified keys work **globally** regardless of focus; **bare arrows act on the focused region only** (list = active‑claim movement; canvas = pan; inspector = scroll). This resolves every Down/PageDown collision deterministically.

### 9.2 Bindings (Windows‑normalized)
- **Ctrl+O** Open · **Ctrl+E** Export · **Ctrl+Shift+E** Export this claim · **Ctrl+Shift+W** Close file (with confirm when a batch is loaded) · **Alt+F4** Exit.
- **Ctrl+F / Ctrl+L** focus Search · **Ctrl+G** Go to claim # · first‑character type‑ahead in the focused list.
- **↑/↓** (list focus) move active claim · **Ctrl+↑/↓** move active claim globally · **Ctrl+Home/End** first/last claim (source order).
- **PageUp/PageDown** (canvas focus, page overflows viewport) scroll the page, crossing to prev/next **form page** only at the page edge · **Ctrl+←/→** prev/next form page globally.
- **Ctrl+Plus / Ctrl+Minus / numpad +/− / Ctrl+Shift+Plus** zoom in/out (synonyms accepted) · **Ctrl+0** Actual Size · **Ctrl+9** Fit Page · **Ctrl+8** Fit Width.
- **Space** toggle focused row's export check · **Shift+↑/↓** extend checked range · **Ctrl+Click / Shift+Click** mouse equivalents · **Ctrl+A** select all rows **only when the list has focus** (selects field text when Search has focus) · **Ctrl+Shift+A** clear selection.
- **Ctrl+D** toggle inspector · **Ctrl+C** copy claim number when a row is focused · **F1** shortcuts overlay.
- **Esc precedence stack** (first applicable wins): (1) cancel active drag → (2) close top‑most modal/overlay → (3) cancel a running parse/export (with the no‑partial‑artifact guarantee) → (4) clear Search → (5) return canvas focus to the list → (6) no‑op.
- **Electron default web accelerators are suppressed** in the production build (no bookmark/reload/DevTools/`Ctrl+Shift+C`), so app bindings are never shadowed.
- **No shortcut is the only way** to reach an action; all appear in menu accelerators and the F1 reference, which includes a **per‑focus‑context column**.

---

## 10. Accessibility (WCAG 2.1 AA)

### 10.1 Text alternative for the canvas (1.1.1) — the core content
The pdf.js form canvas is an opaque image to AT. Its **required, always‑present** text equivalent is the inspector's structured readout (§4.5): always in the DOM/accessibility tree even when the drawer is visually collapsed; `Ctrl+D` affects visual layout only. Canvas carries `aria-label` + `aria-describedby` → the readout for the current page. Every mapped box (including empty/placeholder pages) has a labeled readout entry tagged with its **box/FL/loop number** so a blind reviewer can locate "Box 24 line 3" or "FL50 Payer A" that a sighted colleague cites.

### 10.2 Virtualized list (4.1.2, 1.3.1)
`role="grid"` with **`aria-rowcount` / `aria-setsize` = full batch size** and **`aria-rowindex` / `aria-posinset` = true source index** on every rendered row (not the DOM window index). Keyboard/SR focus on a row keeps that row rendered; focus is restored when scrolling brings it back. `Ctrl+Home/End`, `Ctrl+G`, and type‑ahead reach rows outside the rendered window. Acceptance test: jumping to claim 200 announces "Claim 200 of 340."

### 10.3 Focus management on transitions (2.4.3, 3.2.1)
| Transition | Focus target | Announcement |
|---|---|---|
| Parse complete | first claim row | batch summary via status region |
| Claim selected (mouse/kbd) | stays on list | new selection announced; preview readout updates |
| Export dialog open | dialog's first control (focus trapped in dialog) | dialog title |
| Export dialog close / cancel | the invoking control | — |
| File‑level error view | error heading | assertive |
| Count‑mismatch / aborted banner appears | banner announced via `role="alert"`, **focus not stolen** | assertive |
| Theme change | unchanged | none |

### 10.4 Keyboard operation of the canvas (2.1.1)
Full keyboard pan (arrows / Home / End) when the canvas has focus; documented focus‑escape (`Esc`/`Tab` → list); no keyboard trap. The structured readout remains the primary non‑visual path, so panning is a convenience, not the only route to clipped data.

### 10.5 Color independence (1.4.1)
Never encode status by color alone. **Every** cue pairs color with icon and/or text: warning, error/couldn't‑display, form‑type uncertain, replacement/void, form‑type badge (letter + shape), drop‑zone valid/reject, **active‑claim selection** (left rule + bold), and **checked‑for‑export** (check glyph). Selection and checked state are exposed via `aria-selected` and checkbox `checked`.

### 10.6 Live‑region verbosity (4.1.3)
The determinate progressbar carries `aria-valuenow` / `aria-valuetext` and is queried on demand (silent). Any `aria-live` step announcements are **throttled to ~10% milestones plus completion/cancel/error** — never per claim. Same for the per‑claim preview spinner.

### 10.7 Exported‑PDF accessibility (documented decision)
The export is a text overlay onto a self‑drawn black form grid. **Decision 2026‑07‑24: visual fidelity + caveat — full PDF‑UA tagging is OUT of v1 scope.** v1 requirement: the exported PDF still contains a **real text layer** (selectable/searchable field values under the overlay) so it is not a pure image; **the About/notice screen states explicitly that exported PDFs are not fully screen‑reader (PDF‑UA) accessible**, so the team knows the limitation. The **app UI itself remains fully WCAG‑AA** (the always‑present structured readout in §4.5 is the accessible equivalent of the visual form). PDF‑UA tagging can be added later without reworking the render pipeline.

### 10.8 General AA
Contrast ≥4.5:1 (≥3:1 large text / essential graphics), verified **per theme against each background each token actually sits on** (including status glyphs shown on the white form canvas). Keyboard‑complete; visible focus indicator (theme‑specific, §14.6); comfortable target sizes and row spacing; reduced‑motion honored; no time limits; usable at 200% scaling with reflow (the fixed‑geometry preview's accessible alternative is the reflowing readout); export dialog fields have programmatic labels and field‑tied error announcements; consistent icon/label identification across menu, action bar, and context menu.

---

## 11. Drag‑and‑Drop & File Handling

- **Window‑level guard:** `dragover`/`drop` are `preventDefault`‑ed on the whole window so Chromium never navigates to / opens the file in place. Drop is a first‑class open path across the **entire** window, not just Welcome.
- **Dragover affordance (coarse, buildable):** a single dragged item → "Ready to open" styling; a folder or multiple items → reject styling ("Open one file at a time"). Reject styling is a coarse hint, not a content guarantee — file content/path is often unavailable pre‑drop.
- **Post‑drop validation:** accept **any** dropped file regardless of extension, then validate the ISA header on read. Non‑X12 → the full‑view file‑level error; a coarse structural reject (folder/multi‑file) → inline reject affordance on the drop zone.
- **Drop while a batch is loaded** → the same "Close the current file?" confirmation, then replace in place.
- **Accepted‑types:** the Open dialog defaults to `.dat/.edi/.txt` but always offers **All files (*.*)**; validity is content‑based so extensionless clearinghouse files (`.837`, `.x12`, `.out`, numeric names, no extension) open fine.

---

## 12. Perceived Performance & Feedback Thresholds (global rules)

- **Two‑phase loading** (see §10 of loading in §5): **Phase 1** indeterminate/byte‑based "Reading file — X of Y MB / Scanning claims…" that counts ST/CLM segments; **Phase 2** determinate "Reading claim n of N" once N is known. State which metric drives each phase. A byte‑based fallback covers files where a pre‑count is skipped for speed.
- **Progressive display:** claim rows stream into the list in source order as parsed; already‑parsed claims are immediately interactive; progress moves to the status bar, not a blocking overlay.
- **Page‑count hint** is computed from a cheap **service‑line‑count heuristic at parse time** (independent of full rendering) so it's present the instant a row appears and never reflows; the rendered preview is authoritative over the hint. Define a fallback glyph when the heuristic can't determine it.
- **Render cancellation / scrubbing:** selection changes **debounce** the preview render (~150 ms after selection settles); any in‑flight render for a superseded selection is cancelled and discarded (never painted); the canvas skeleton appears only if a render exceeds ~120 ms. Fast list scrubbing never blocks on rendering.
- **Loader thresholds (applied to all transient feedback — parse, preview, export, filter):** operations under ~100–120 ms show **no** loader (feel instant); any loader that does appear stays visible a **minimum ~400–500 ms** to avoid flicker; skeletons appear only after the delay threshold.
- **Search** is debounced (150–200 ms), async, non‑blocking, with a live "Showing X of N" readout; the empty state appears only after the debounced filter settles at zero.

---

## 13. Overflow, Truncation & Slot‑Count (field‑fit policy)

All fit/truncation decisions are computed **once in form (point) coordinates at render time**, identical across every zoom level and in the export; zoom only scales the already‑laid‑out page. This is an explicit invariant alongside preview/export fidelity.

**Per field class:**
- **Alphanumeric text (names, taxonomy, remarks, modifiers string):** auto‑shrink font down to a stated floor (**6pt**), then clip. **Never wrap** inside a single‑line comb/box. A **persistent on‑canvas truncation marker** (a right‑edge overflow glyph — an amber corner tick / caret keyed to a footnote) renders in **both preview and export bytes**; the full untruncated value is in the inspector. Each page carries a footer note **"N fields truncated — full values in details."** The marker is a non‑color cue (icon + footnote), added to the §10.5 list.
- **Numeric / currency (CLM02, box 28/29/30, UB‑04 line 23, units/minutes, prior‑paid COB):** **never clipped or ellipsized** — that would silently change the apparent value. Auto‑shrink to the floor; if it still doesn't fit, render an unmistakable **overflow token** (e.g. `###`) plus a **hard warning** ("value exceeds box capacity"), never a partial digit string that could be misread as a smaller number.
- **Slot‑count overflow (multi‑value capped regions):** enumerate each capped region and capacity — CMS‑1500 Box 21 (12 diagnoses A–L), UB‑04 FL18–41 value/occurrence/span/condition codes, FL66–81 diagnoses/procedures, dental diagnosis pointers. When source data exceeds capacity, **overflow to a continuation / additional‑details page** ("Diagnoses M+ continued"), **never drop**. Add a claim‑row status glyph and an inspector warning ("4 diagnosis codes exceeded Box 21 capacity").

**Lossless vs lossy decision table (which overflow is relocated vs marked‑truncated):**

| Overflow type | Resolution | Lossy? |
|---|---|---|
| Extra service lines (>6 / >22) | continuation page | lossless |
| Extra slot values (13th dx, 30th condition code) | continuation / additional‑details page | lossless |
| Over‑wide single‑cell **text** | shrink to floor, then clip + on‑canvas marker | **lossy (last resort)** |
| Over‑wide single‑cell **numeric** | shrink to floor, then overflow token + hard warning | never partial‑lossy |
| Extra modifiers beyond cell | relocate to additional‑details band | lossless |
| NTE / remarks over‑long | relocate to additional‑details band | lossless |

**Lossy truncation is reserved solely for single‑cell text width overflow after the font floor is hit**, and is always marked on the form.

---

## 14. Visual Direction (Brotherhood brand, weighed for an internal PHI utility)

Brand baseline (user memory): forest green, a single serif typeface, line‑art icons, scripture callouts, **no emojis**. Canonical reference: the 3rd‑edition Complete Guidelines. Brand establishes **quiet ownership and trust**, not decoration. Neutral, low‑chroma surfaces so claim content and warnings dominate.

### 14.1 Typography
- **Heading / identity / light chrome:** the single Brotherhood serif. **Recommended placeholder pending the canonical family:** a licensed transitional serif (e.g. *Source Serif 4* or *Spectral*) with Windows fallback `Georgia, 'Times New Roman', serif`. **The serif's embed/subset license must be confirmed before design lock** (it is embedded in the dental PDF export); if it fails, the fallback becomes primary from day one.
- **Body / data / list rows / form overlays / comb fields:** a highly legible mono for numeric alignment (dates, NPIs, dollar/cents). **Recommended:** *IBM Plex Mono* (or *JetBrains Mono*) with fallback `'Consolas', 'Courier New', monospace`; paired with a neutral sans (*IBM Plex Sans* / Segoe UI fallback) for non‑numeric labels. Data legibility beats stylistic consistency.

### 14.2 Color anchor (forest green)
- **Recommended placeholder** pending extraction from the Complete Guidelines swatch: **`#1E4D2B`** (forest green). Provide a **50–900 ramp**; each step's contrast is measured against both light and dark neutrals. Designer latitude applies to spacing/placement, **not** to inventing the primary color.
- **Two distinct greens (must not be conflated):**
  - **UI / chrome green** — theme‑aware, used for primary actions, active‑claim rule, header/status accents, brand mark. Has explicit **light and dark** variants; in dark mode it shifts **up the ramp** (a lightened/desaturated step, recommended ~`#4C9A5E`) to the nearest AA‑passing step against the dark surface, and must not read as a "success/verified" green.
  - **Print / document green** — fixed, used only in the **dental** form export; tuned for AA on white paper **and** for grayscale‑print legibility. It is a print color, never recolored by app theme.

### 14.3 Semantic palette (defined, not left to guesswork)
Two‑column light/dark tokens, each with measured contrast against **every** background it sits on (chrome surface *and*, for glyphs on the form, white paper). Any status glyph rendered **on the light form canvas uses its light‑background token regardless of app theme.**

| Token | Light | Dark | Notes |
|---|---|---|---|
| Warning | amber `#B45309` | `#F59E0B` | icon + text |
| Error / couldn't‑display | calm red `#B91C1C` (not marketing‑red) | `#F87171` | icon + text |
| Replacement / voided | violet/neutral `#6D28D9` | `#A78BFA` | icon + text |
| Form‑type uncertain | slate `#475569` | `#94A3B8` | icon + text |
| Offline‑OK | muted teal/green‑gray `#0F766E` | `#5EEAD4` | distinct from brand green |
| Drop‑valid | brand‑green tint | dark‑green tint | icon + label |
| Drop‑reject | error red | dark error | icon + label |
| Form‑type badges (P/I/D/Unsupported) | 4 hues **backed by letter+shape as primary channel** | dark variants | verified distinguishable under deuteranopia |

### 14.4 On‑screen "Actual Size" vs true print size
Reserve the true‑size guarantee for the **exported / printed PDF** (print at 100%, no fit‑to‑page). The on‑screen control is labeled **"Actual Size (approx.)"**, meaning 100% of the rendered page at native resolution; it derives scale from OS DPI (`devicePixelRatio` + a documented target PPI) and recomputes on monitor change. A note states physical‑inch accuracy is guaranteed only on paper.

### 14.5 Form artwork in dark mode (fidelity vs theme — resolved)
The **form preview canvas is always "paper" (light, print‑true) in both themes**, because it renders export bytes; the theme never inverts form content (preserves preview↔export identity). In dark mode, **dim the surround, not the paper**: place the light form on a low‑luminance neutral matte (~`#1E1E1E`) with a subtle border/drop shadow to separate paper from matte. Optionally offer a **display‑only "dim preview" scrim** (a semi‑transparent overlay over the canvas) so the white page isn't retina‑searing during long dark‑room sessions; this scrim is **not part of export bytes** and is stripped from export.

### 14.6 Dark‑mode scope (decision)
The shell **respects the Windows dark theme**, but dark theming is scoped to **chrome only** (menus, list, status bar, dialogs, inspector). The form canvas is frozen as paper (§14.5). This gives dark‑mode users a non‑glaring shell without the cost/risk of theming a surface that can never legitimately go dark. Focus ring and drop‑zone states are **theme‑specific** (a light/high‑contrast focus ring on dark surfaces, meeting 3:1 non‑text contrast against its own background; drop valid/reject given explicit light+dark values with icon+label so they never rely on a single green/red that works in only one theme).

### 14.7 Iconography
**Recommended base:** a stroke‑based line‑art set (e.g. *Lucide* / *Feather*) restyled to a **consistent stroke weight of 1.5px on a 24px grid**, with a **16px small‑size variant** for list‑row status glyphs (legible and distinguishable in monochrome for color‑blind users). Every icon pairs with text or a tooltip. **No emojis anywhere in UI or export.** Required glyph inventory (checklist so nothing is discovered late): open, export, export‑this‑claim, zoom‑in, zoom‑out, actual‑size, fit‑page, fit‑width, prev‑claim, next‑claim, prev‑page, next‑page, go‑to, search, filter, close‑file, checkbox on/off, warning, couldn't‑display, form‑type‑uncertain, replacement/void, offline, drop‑valid, drop‑reject, truncation marker, provenance/detected, inspector‑toggle, page‑count, sample‑data.

### 14.8 Scripture callouts & tone
Scripture callouts allowed **only** on low‑stakes non‑workflow surfaces (Welcome, About), never on rendered claim forms, the PHI‑bearing export (**including the dental claim**, which is both a rendered form and PHI‑bearing), or any error/warning UI. Optional and unobtrusive. Warnings/errors use calm, honest visual language (icon + text + accessible color), distinct from brand green — nothing alarmist, nothing marketing‑badge‑like.

### 14.9 Two form visual languages
Keep them clearly separated: **chrome = branded shell**; **all three forms (CMS‑1500 / UB‑04 / ADA dental) = neutral black coordinate grids** (print‑oriented, faithful to each standard layout, unbranded apart from a small unobtrusive identity mark on the dental facsimile footer, see §21). No form body is a branded surface. Both light and dark chrome accents satisfy AA.

**Designer latitude:** exact tints within the supplied ramp, spacing scale, icon detailing, list‑row micro‑layout, and brand‑mark prominence are the designer's — the requirement is *legible, calm, honestly‑stateful, quietly branded, print‑true*.

---

## 15. Copy & Labeling (approved strings)

- **Form‑type labels (canonical everywhere):** "Professional (CMS‑1500)", "Institutional / Hospital (UB‑04)", "Dental claim". Status‑bar summary spells them out. Bare P/I/D only in tooltips.
- **Error copy — two‑tier pattern.** Primary line is plain‑language and jargon‑free; the PHI‑safe technical reference is demoted to a "Technical details" line in the inspector. **Approved reason catalog (primary line → where technical detail goes):**
  - Missing required field → "This claim couldn't be turned into a form because a required value is missing." (detail: "Segment ‹ID›, position ‹n›")
  - Can't show as form (unsupported version) → badge "Can't show as form"; placeholder heading "This claim can't be shown as a paper form," subtext "It uses a claim format this viewer doesn't recognize yet, so we've listed its basic details instead." (detail: raw version code in inspector)
  - Render failure → "This claim couldn't be drawn as a form." (detail: "Segment ‹ID›, position ‹n›")
  - Truncated field → on‑form marker + "N fields truncated — full values in details."
  - Wrong transaction (whole file) → "This is a payment / remittance file (835), not a claim file."
  - Count mismatch → "This file says it contains 340 claims, but only 338 were found. It may be incomplete or damaged."
- **Status / filter chip labels:** "Has warnings", "Couldn't display", "Form type uncertain", "Replacement or voided claim" — each with a one‑line tooltip ("Replacement/voided: the provider marked this claim as correcting or cancelling an earlier one"). Hyphenated internal tokens stay in code, never on screen.
- **Additional‑details band note:** "Extra service details are shown in a band below the form."
- **Close action:** single verb "Close file."

---

## 16. Windows‑Desktop Conventions

### 16.1 Title bar / window frame
Use the **native OS frame** (`frame:true`, default title‑bar) so Windows 11 Snap Layouts, Aero Snap, double‑click‑to‑maximize, and shake‑to‑minimize come free. Title bar shows app name + current file name (middle‑ellipsized), standard min/max/close. If a custom frame is ever required for brand, it must re‑implement Snap‑Layouts hover, double‑click maximize, and ≥32px caption buttons with correct hover/active states — otherwise, native. **Chrome stack budget:** caption + always‑visible menu bar + workspace action bar + workspace + status bar; the action bar and status bar have overflow rules (§17.6) so the stack never crushes the preview's minimum height.

### 16.2 Menu & taskbar
Menu bar always visible with mnemonics (`&File / &View / &Help`) and Alt reveal. Parse/export progress mirrored on the taskbar button (`setProgressBar`, cleared on completion/cancel). **Jump List / recent documents left empty** (no `addRecentDocument`) — consistent with the no‑recent‑files rule.

### 16.3 Single instance & file association
`app.requestSingleInstanceLock()`: a second launch **focuses/restores the existing window** and routes the file through the same "Close the current file?" prompt — never a second window. `argv` parsing handled for both cold start and warm second‑instance. **No default file‑type association is registered** (at most an opt‑in association for `.edi` only — never `.txt`/`.dat`, which Windows treats generically). Files reach the app via Open dialog, drag‑drop, or explicit "Open with."

### 16.4 Window state / multi‑monitor
Remembers window size/position and splitter positions (never claim data). On restore, **validate saved bounds against the current display layout** (work‑area intersection); if the saved rectangle is wholly/mostly off any visible work area, or exceeds the primary display, clamp to the primary monitor's work area and center. Re‑clamp on monitor hot‑plug/resolution change. Declare **per‑monitor‑DPI‑aware v2**; the approximate "Actual Size" recomputes device‑pixel scale on monitor change.

### 16.5 Other
Per‑user, no‑admin posture (no UAC, no "run as admin"). Right‑click context menus on list rows and preview. Printing is via the exported PDF with documented "print at actual size (100%, no fit‑to‑page)" guidance; any in‑app Print defaults to actual size.

---

## 17. Responsive / Resize Behavior

- **Preview re‑fit:** Fit Width / Fit Page are **sticky live‑refit modes** that recompute continuously on any window or splitter resize. Actual Size and explicit % zooms are **fixed** and produce pan/scroll when the viewport is smaller than the form — **never auto‑downscale** (which would break print‑truth). Default mode on first load is Fit Page.
- **Splitters:** list and inspector edges are draggable (min/max per §8), double‑click resets, positions persist. The inspector overlays (does not compress) the preview.
- **Restore geometry vs monitor changes:** per §16.4.
- **Form aspect ratio:** the **dental claim is portrait Letter**, the same page geometry as CMS‑1500 and UB‑04, so the preview viewport, fit math, and pagination are uniform across all three types; the preview recomputes fit on each claim selection.
- **Chrome overflow (§17.6):** each action‑bar and status‑bar item has a drop/collapse priority; low‑priority items move to an overflow menu or truncate (file name middle‑ellipsized) as width shrinks. Export and Open never collapse out of the action bar. A minimum preview height is guaranteed; the count‑mismatch banner is the only always‑full band; offline/PHI collapse to status‑bar glyphs on short windows.

---

## 18. Trust & Reconciliation (visible, on both surfaces)

- **Form‑type provenance:** every claim shows *why* it was routed (§4.4 provenance chip); disagreement → "Form type uncertain" badge + filter.
- **Single extraction:** overlay and inspector are one value set; mismatches raise a data warning (§4.5).
- **Blank‑box semantics (three distinct treatments so a dropped value never looks like an empty field):**
  1. **Empty in source** → truly blank box.
  2. **Present in source but unmapped / not rendered** → a subtle marker (small caret/hatch) on the box + an inspector warning naming the segment/element that had data but no target.
  3. **Extracted but failed to place** → an error glyph on the box.
  These markers appear on‑screen and are stamped into the exported PDF.
- **Line‑count reconciliation:** a per‑claim stamp in the inspector and compactly on the form footer — **"Service lines: 7 of 7 rendered across 2 pages."** Any shortfall becomes an error glyph on the row. Diagnosis count (HI segments vs boxes A–L) reconciled the same way.
- **Charge reconciliation (exact cents, zero tolerance):** compare Σ line charges vs CLM02 as **integer‑cents equality**; on mismatch show both totals and the signed delta ("lines sum $1,240.00 vs CLM02 $1,204.00, delta +$36.00"), never a bare boolean, plus the charge‑cell marker in the list (§4.3).
- **Reference integrity warnings:** dangling diagnosis pointers (points to a letter with no diagnosis), missing referenced provider/payer loops, payer‑sequence gaps (S present, P missing) — render the pointer/marker **as‑is with an inline warning glyph** (never silently blank or guess) and list the specific broken reference by segment position in the inspector.

---

## 19. Preview ↔ Export Fidelity (restated precisely)

The guarantee is **"the preview shows the same coordinate‑mapped content the export writes"** — not literal byte‑identity across every export variant. Specifically:
- The **content, layout, truncation markers, blank‑box markers, reconciliation stamps, and the unverified footer stamp are identical** between preview and export (the preview reflects the currently resolved export footer state).
- **Encryption (qpdf) and per‑file packaging are explicitly exempt** from any byte‑identity claim.
- Truncation/fit is computed in form coordinates (§13), so it is identical at every zoom and in export.

---

## 20. Export Numbering & Stamps

- Exported claims **always retain their original batch source index** in any footer/stamp, regardless of subset or filter — so the same claim prints the same footer number in a full‑batch or a selected‑subset export. Intra‑claim "Page x of y" is always **claim‑local**.
- Selection is a filter over the source‑ordered batch, never a re‑order; the export dialog shows the resolved count and index range before writing.
- **Unverified footer stamp (verbatim), on every page of every form type including placeholders:** **"Claim count could not be confirmed — file may be incomplete."** Placed in the page footer.

---

## 21. Dental Claim Layout (full spec — self‑drawn ADA‑2024 facsimile)

Portrait Letter, print‑true, exported into the PDF. **A faithful self‑drawn facsimile of the 2024 ADA Dental Claim Form (J43024) layout** — same treatment as CMS‑1500 and UB‑04: the app authors its own black coordinate grid matching the ADA form's standard box positions (fields 1–58, plus the Record‑of‑Services grid, fields 24–31), using the on‑hand sample form as the layout reference. It is **not** the ADA's copyrighted form file and the watermarked sample is never shipped. It is PHI‑bearing content → **no scripture appears on it**. (Decision 2026‑07‑24: render the actual forms on hand; do not source clean/licensed blanks. A standing ADA‑form IP note is carried in the build plan — internal use is fine; review before wide/external distribution. A generic Brotherhood‑branded tabular summary remains available as a fallback layout.)

**Design intent for the facsimile:** the *form* is a neutral black coordinate grid faithful to the ADA layout (like the other two forms), so unlike the earlier "branded content surface" framing, the dental form is **not** a branded surface — the Brotherhood mark appears only as a small, unobtrusive footer/identity element, never restyling the standard ADA field structure. Fixed **print green** (§14.2), if used at all here, is limited to that small identity mark; the form body is black‑on‑white and print‑true.

**Field / box coverage (must map onto the ADA‑2024 layout positions):**
1. **Header** — Type of Transaction (statement of actual services / predetermination), predetermination/preauth number, provenance chip (app chrome, not printed).
2. **Dental benefit plan (payer) + policyholder/subscriber + patient** blocks — names, IDs, DOB, relationship, plan/group, employer, matching the ADA field 1–23 positions.
3. **Record of Services Provided grid** — the ADA 24–31 columns **in the form's own order**, mono for codes/numbers, decimal‑aligned fee: Procedure Date (24), Area of Oral Cavity (25), Tooth System (26), Tooth Number(s)/Letter(s) (27), Tooth Surface (28), Procedure Code / CDT raw text (29), Diag. Pointer (29a), Qty (29b), Description (30 — **left blank/omitted**, no bundled CDT description dictionary), Fee (31). Header row repeats on continuation pages.
4. **Missing‑teeth chart (33)** + **Diagnosis code list qualifier / codes (34, 34a, A–D)** with reference‑integrity markers (§18).
5. **Ancillary / treatment info** — place of treatment, orthodontics (DN1 months, appliance‑placed date), prosthesis replacement + prior placement date (DN2), enclosures, accident info — mapped to ADA fields 38–47.
6. **Billing dentist (48–52a)** and **Treating dentist + location (53–58)** — name, NPI, license, TIN, address, phone.
7. **Totals + footer** — Other Fee(s) (31a), Total Fee (32), line‑count reconciliation stamp, "Page x of y", unverified stamp when applicable, truncation footnote when applicable.

**Pagination threshold:** the ADA Record‑of‑Services grid is **10 rows** on the printed form; paginate to a continuation page when service lines exceed the rows that fit (default **10 lines/page**, designer confirms against the drawn grid), repeating header/party blocks and carrying totals, with "Page x of y." Slot overflow (extra diagnosis pointers, extra prosthesis/missing‑teeth data) follows §13 (continuation, never dropped).

---

## 22. Summary of What a Designer Now Has

Complete screen inventory (§3), component list with the claim‑list column table and dual‑selection model fully specified (§4), every state including the four previously‑missing ones — valid‑no‑claims, wrong‑version whole‑file, partial/aborted parse, invalid export scope (§5), interaction specs with search/filter/selection semantics locked (§6), data‑per‑view (§7), canonical layout geometry + breakpoints + two‑axis navigation (§8), a Windows‑normalized keyboard map with a focus/context model (§9), a full WCAG contract that survives virtualization and canvas opacity (§10), drag‑drop and file handling (§11), perceived‑performance thresholds (§12), a complete overflow/truncation/slot‑count policy (§13), visual direction with concrete color/type/icon starting points and both theme columns (§14), approved copy strings (§15), Windows conventions (§16), resize behavior (§17), trust/reconciliation surfaces (§18), a precise fidelity statement (§19), export numbering/stamps (§20), and a full dental‑claim field map and wireframe (§21).

The only items still requiring the Brotherhood team are the canonical brand asset values noted below; recommended placeholders let design proceed immediately.

