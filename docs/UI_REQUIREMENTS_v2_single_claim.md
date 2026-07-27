# UI Requirements — Claim Viewer (single-claim) — design handoff

**For:** a Claude Design pass. This is the current, authoritative UI spec and **supersedes the batch-oriented `UI_REQUIREMENTS.md`** (the earlier 340-claim design was built before we learned the real data is one claim per file). Keep the earlier design's *visual language* — it's good — but restructure to a single-claim viewer as described here.

## 1. What the app is
An **offline, single-machine Windows desktop app** (Electron) that opens **one claim at a time** and renders it as a faithful facsimile of its paper claim form, then exports that form to **PDF**. View-only — no editing, no pricing, no network.

- **Primary input:** a clearinghouse **JSON file = one claim** (professional / CMS-1500 today).
- **Secondary input:** an **X12 837** file (a batch); the viewer steps through its claims one at a time. Institutional (UB-04) and dental (ADA) forms are reached via this path.
- Forms rendered: **CMS-1500** (primary), **UB-04**, **ADA-2024 dental** — each a self-authored black facsimile grid on white US-Letter (612×792pt).

## 2. Users & principles
Small internal Anabaptist Brotherhood negotiator team, non-technical. Zero-training: open → look → export. Calm, honest, print-true. Brotherhood brand expresses in the **chrome only** (not on the form body). Fully WCAG-AA in the app UI; the exported PDF is visual-fidelity with a "not fully screen-reader accessible" note (documented decision).

## 3. Window layout
A single desktop window (min ~1000×680), top-to-bottom:

1. **Title bar** — app name + current file name. Standard Windows window controls.
2. **Menu bar** — File (Open…, Export…, Export this claim, Close, Exit), View (Zoom In/Out, Fit Page, Fit Width, Toggle Inspector, Light/Dark), Help (Keyboard shortcuts, About).
3. **Toolbar** — grouped, labeled:
   - **Open** (primary-ish) · **Export** (primary).
   - **Zoom:** out / % / in / Fit Page / Fit Width.
   - **Pages of this claim:** ‹ Page x of y › (shown only when the claim paginates to >1 form page).
   - **Claim stepper (837 batch only):** ‹ Claim x of N in file › — hidden for a single JSON claim.
   - Right-aligned: **Toggle inspector**.
4. **Body** — two regions:
   - **Center: form preview** on a neutral matte. A **provenance chip** sits above the form ("Rendered from JSON claim 808226319" / "837 claim 3 of 40"). The form is the 612pt facsimile (see §5), horizontally centered, scrollable, zoomable.
   - **Right: inspector drawer** (collapsible, default open on a wide window, overlay on a narrow one) — see §6.
5. **Status bar** — file name · form type ("Professional — CMS-1500") · a per-claim data-validation summary ("2 data warnings" / "No warnings") · **offline indicator** ("Offline — no network access", icon+text) · **Sample-data chip** when applicable.

## 4. States (design all of these)
- **No file open (welcome):** app identity, a large **Open a claim file** action, drag-and-drop target ("Drop a .json or .837 file"), and a one-line reassurance ("Runs fully offline. Nothing leaves this machine."). Brand-appropriate, unobtrusive scripture allowed here only.
- **Loading/parsing:** brief indeterminate indicator (files are small); skeleton form optional.
- **Parse error / not a claim:** calm error card naming the problem ("This file isn't a valid claim JSON or 837 interchange"), with an Open-another action. Never a stack trace.
- **Unsupported form:** the claim parsed but its `claim_form` / 837 version has no renderer → a placeholder "Can't show this as a form" page **with the data still fully visible in the inspector**.
- **Per-claim data warnings:** a non-blocking banner above the form ("Line charges ($164.91) don't match the claim total ($164.92)"; "Diagnosis pointer E has no matching diagnosis") with a count; details in the inspector's reconciliation group.

## 5. The form preview (facsimile)
- Faithful black-on-white recreation of the standard form layout with **box numbers** (CMS-1500 1a/2/3…33; UB-04 FLs; ADA 1–58 + 24–31 grid). Monospace for codes/numbers/dollars; dollars right/decimal-aligned; missing values render as a muted em-dash "—", never blank-that-reads-as-data-loss.
- **Service-line grid** is the visual centerpiece (CMS-1500 box 24; UB-04 rev-code lines; ADA record of services). Supports **many lines** incl. tiny `$0.01` quality lines; **paginates** to continuation pages (repeat header/party blocks, carry totals, "Page x of y") when lines exceed the grid — never silently truncated.
- **Footer** per page: "Service lines: N of N rendered", "Page x of y", and an "unverified" stamp when applicable.
- The form body carries **no brand color** (print-true). Dental facsimile may show a small unobtrusive "Anabaptist Brotherhood" identity mark in the footer only.
- **Zoom:** 25–400%, Fit Page (default on open), Fit Width; zoom persists as you page/step.

## 6. Inspector drawer (the accessible + trust surface)
Always present in the DOM/accessibility tree even when visually collapsed (`Ctrl+D` toggles visual only). Content:
- **Field groups**, each labeled with its **form box** ("Patient · Box 2", "Diagnoses · Box 21", "Providers · Box 33", "Service lines · Box 24"), listing key→value rows that mirror the form.
- **Reconciliation group:** service-line count rendered vs parsed; **Σ line charges vs claim total** with a signed delta when they differ; NPI sanity.
- **Raw view (collapsible):** "Raw JSON fields" (JSON path) or "Raw 837 segments" (837 path) — read-only, monospace.
- Provenance & warnings surfaced here too.

## 7. Export flow
- **Export dialog** (single-claim — no batch scope): shows "Export this claim (#{claimId}) as PDF"; **Destination** path (Save-file dialog, PHI-free default filename = `claim_{claimId}_{formtype}_{yyyy-mm-dd}.pdf`, defaulting to a non-synced folder); a short **manifest** ("CMS-1500, 5 service lines, 1 page"); and a **PHI notice** ("This PDF is unencrypted PHI. Store on a BitLocker volume only."). Buttons: Cancel / Export. **No encryption control** (out of v1).
- If a synced path (OneDrive/Dropbox/Drive) is chosen, an inline warning.
- **Progress:** brief for one claim; then a **done state** — "Exported to …" with **Open containing folder** (primary) and Open PDF (secondary).
- **Export this claim** (Ctrl+Shift+E) can skip straight to the dialog with sensible defaults.

## 8. Keyboard (Windows-normalized)
Open Ctrl+O · Export Ctrl+E · Export this claim Ctrl+Shift+E · Close Ctrl+W · Toggle inspector Ctrl+D · Zoom Ctrl+ + / Ctrl+ - / Ctrl+0 · Fit Page Ctrl+9 · Fit Width Ctrl+8 · Prev/next form page Ctrl+←/→ · (837 batch) prev/next claim PageUp/PageDown · Shortcuts F1. Visible focus, full keyboard operability, F6 cycles regions (toolbar → preview → inspector).

## 9. Visual direction
- Reuse the earlier design's system: **Source Serif 4** (headings/identity), **Open Sans** (UI), **IBM Plex Mono** (codes/data/forms). Brotherhood green (`#006E47` placeholder — confirm from the 3rd-ed brand guide) for chrome accents/primary actions only. Light + dark themes (the form body stays print-true white in both; dark theme dims the surrounding matte).
- No emojis; line-art icons; calm status colors distinct from brand green.

## 10. Explicitly out of scope for v1 (don't design these)
Batch/claim-list panel, filter chips + counts, multi-select, batch export (scope radios, one-file-per-claim, "writing claim N of M"), the file-level count-mismatch banner. (These were in the earlier design; remove them.)

## Deliverables wanted from the design
Screens/states: welcome, workspace (CMS-1500 + a UB-04 + a dental example), inspector open/collapsed, export dialog, export done, unsupported-form placeholder, parse-error, keyboard-shortcuts sheet — in light and dark.
