# Changelog

Bundled with the app and shown on the About screen ("What's new") — built in at
compile time, no network fetch involved. Summarized from `docs/BUILD_LOG.md`,
which remains the authoritative, detailed record of every build.

## Build 7 — Installation & deployment enhancements
- About screen: "Check for the latest release" link opens the GitHub releases
  page in your default browser. This is a manual link only — the app makes no
  network call of its own and never checks for updates in the background.
- About screen: this changelog, bundled locally and shown on-screen.
- Enterprise/silent install support for IT-managed rollout (NSIS `/S`,
  `/AllUsers`, `/CurrentUser`, `/D=` switches) — see `docs/DEPLOYMENT.md`.
- Installer now shows the standard install-directory / per-user-vs-per-machine
  screen instead of always installing one-click, per-user only.

## Build 6 — Notes & audit
- Session-scoped per-line notes, dispute/verify/OK flags, and check-off marks
  in a new "Notes & flags" inspector group. Never saved to disk — cleared the
  moment a tab or the app closes, and never included in any export.
- A local, append-only, metadata-only audit log (who opened or exported a
  claim, when, from/to which file) — never claim content — viewable from the
  About screen.
- "Copy annotations worksheet", kept clearly separate from "Copy claim
  summary".

## Ease-of-use + accessibility batch
- Tooltips with shortcut hints on every icon-only toolbar control.
- Recent files surfaced on the welcome screen, not just the File menu.
- Keyboard command palette (Ctrl+K) — fuzzy search over existing actions,
  open tabs, and claims in the current file.
- Four bundled, synthetic, PHI-free sample claims ("Open Sample Claim") for
  trying the app without a real file.
- Optional "fast open" mode: opens straight to the inspector and defers the
  PDF canvas render until you ask for it.
- Optional high-contrast/greyscale render mode for the on-screen preview
  (view only — exports stay the faithful facsimile).
- Clickable warnings: click a warning in the inspector to jump to and flash
  the field it concerns.

## Build 5 — X12 837 export
- A genuine, submission-shaped X12 5010 837P/837I/837D export (proper
  ISA/GS/ST/SE envelope and control numbers) alongside the existing PDF/CSV/
  JSON exports.
- Every export validates round-trip: the app re-parses its own X12 output and
  diffs it against the source claim before calling the export successful.
- An edited claim's X12 export carries an EDI-native "EDITED" signal via a K3
  free-text marker, since X12 has no visual-watermark concept.

## Build 4 — Export suite
- Batch export: render every claim in an open file to individual PDFs in one
  folder, with progress and cancel — one bad claim never fails the batch.
- Combined single PDF across a batch export, alongside the per-claim files.
- Structured CSV and JSON export of the normalized claim. Both are
  PHI-minimal by default; including patient/insured identifiers is an
  explicit, visually-marked opt-in.

## Editable fields & corrected-claim export
- Correct values on a curated set of form fields (patient DOB/phone/account
  number, insured member ID/group, billing NPI/tax ID, rendering NPI,
  per-line procedure code/modifiers/units/charge, per-diagnosis code) without
  ever writing to the original source file.
- Corrections are saved as a separate, versioned, hash-checked "corrected
  claim" artifact next to the app's other saved settings. If the source file
  changes later, saved corrections are flagged stale rather than silently
  applied or dropped.
- Data-integrity warnings are always computed from the original parsed
  values, never from an edit — correcting a field can never make a warning
  disappear.
- Any export made from a claim with active corrections carries a mandatory,
  unremovable "EDITED" indicator, in every export format.

## Build 3 — Data integrity
- Extended structural, non-clinical warning set: date-and-arithmetic checks
  (service dates outside the statement period or in the future), duplicate
  service lines, EDI structural defects (segment-count mismatches, duplicate
  claim IDs), dental tooth/surface validity, and missing billing tax ID/
  taxonomy.
- CMS-1500 diagnosis-overflow fix for claims with more diagnosis pointers
  than the form has room to print.
- A provenance footer on every rendered/exported page, naming the source file
  and confirming it was not modified.
