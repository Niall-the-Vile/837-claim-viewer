# Handoff to next Claude Code session — post-Build-3 plan

**Repo:** `Niall-the-Vile/837-claim-viewer` (branch `master`)
**Supersedes:** `CLAUDE_CODE_HANDOFF_Build3_and_beyond.md`'s Build 3 section (now shipped) and
reorders/extends everything after it based on decisions made with the project owner in a
2026-09-10 session. Read this file's decisions as authoritative over that older doc wherever
they differ — this file is the current source of truth for what to build next and in what order.

**This doc's job:** tell the next session exactly what to build, in what order, and why —
including product/architecture decisions already made so they aren't re-litigated. It does not
replace the repo's own specs (`docs/BUILD_QUEUE.md`, `docs/FEATURE_BACKLOG.md`,
`docs/UI_REQUIREMENTS_v3_queued_features.md`) — it tells you which to open and when, plus new
decisions those docs don't cover yet.

---

## Before you start

1. `npm run verify` — confirm the repo is green. If it isn't, stop and fix that first; do not
   build on red (repo rule 1, `docs/BUILD_QUEUE.md`).
2. Read `docs/BUILD_LOG.md` for what's actually shipped (source of truth over any planning doc,
   including this one, for *past* work).
3. If a build below has its own design doc already (e.g. `docs/EDITABLE_FIELDS_DESIGN.md` once
   written), read it before touching that build's code.
4. Follow the repo's own process rules verbatim (checkpoint every build: `npm run verify` green
   → `git commit` → tag on completion; any new preload/IPC touches
   `electron/preload.ts`+`electron/main.ts`+`src/renderer/global.d.ts`+the sorted key array in
   `e2e/app.spec.ts` in the same commit; adversarial audit before calling anything done; no
   spot-checking new lookup tables — assert every value; log everything in `docs/BUILD_LOG.md`).

---

## Status as of this handoff

- ✅ **Build 3 — Data integrity**: shipped, tagged `build-3-green`, pushed, verified green on
  GitHub Actions CI. 3.1–3.3 (extended structural warnings, CMS-1500 diagnosis-overflow fix,
  provenance footer) complete. **3.4–3.6 (per-box geometry, clickable warnings, search-highlight
  on the rendered canvas) were explicitly deferred as a stretch goal** — see `docs/BUILD_LOG.md`'s
  Build 3 section for why. Pick these up when Build 5's (837 export) or the ease-of-use batch's
  clickable-warnings item makes them worth doing.
- 🔄 **Editable fields + corrected-claim export**: in progress as of this handoff. Check
  `docs/BUILD_LOG.md` and `docs/EDITABLE_FIELDS_DESIGN.md` for whether it landed, and
  `git log`/`git tag` for `build-editable-fields-green`. If it's incomplete or the working tree
  is dirty from it, finish and checkpoint it before starting anything else below — do not start
  Build 4 on top of an unfinished, uncommitted feature.

---

## Decisions made this session (do not re-derive or re-ask — build to these)

1. **Editable form fields → a persisted "corrected claim" artifact.** This is a deliberate,
   explicit exception to the app's view-only architecture, approved by the project owner
   specifically (not a default any future session should extend further without asking).
   Non-negotiable invariants — see the full brief in this repo's Agent-tool history / re-derive
   from `docs/EDITABLE_FIELDS_DESIGN.md` once written:
   - The original source file is **never** opened for writing.
   - Edits persist as a new, versioned, hash-checked sidecar artifact via the existing
     `userData` persistence pattern (`src/app/persistence/`), added to its `ALLOWED_USERDATA_FILES`
     allowlist.
   - Warnings/reconciliation are always computed against the **original** parsed claim, never
     against edited values — an edit must never silently make a data-integrity warning disappear.
   - Any export made from a claim with active overrides carries a **mandatory, unremovable**
     visual "EDITED" indicator. This cannot be turned off by the user.
   - Plain click-to-copy on inspector fields must keep working; editing needs its own explicit,
     separate affordance.

2. **Per-line notes/triage marks (Build 6 below) are session-scoped only, not persisted.**
   The older handoff doc's Build 5.1 called for persisting these under `userData`; that's
   overridden — notes/flags live in memory, cleared on tab close or app restart. Simpler, and
   keeps "claim-adjacent text on disk" limited to the one deliberate exception above rather than
   two.

3. **837 export is its own build (Build 5), and it's the submission-grade version**, not a
   reference-only X12 dump. This means a genuine X12 5010 implementation-guide-compliant
   serializer (837P/837I/837D), proper ISA/GS/ST/SE envelope and control-number generation, and
   it must correctly carry field overrides from the editable-fields feature — figure out the
   right EDI-native way to signal "this claim has been edited" (X12 has no watermark concept;
   don't skip signaling this, but the mechanism is an open design question for that build).
   **Round-trip validation is a hard requirement**: export → re-parse the output through this
   repo's own `src/sources/x12/x12ClaimSource.ts` → diff against the source claim. Do not ship
   without that passing. Give this build its own adversarial audit pass before calling it done —
   a malformed real-world EDI submission is a materially worse failure mode than a bad PDF.

4. **"Check for updates" is a manual link only, not real update-checking.** The repo has an
   *enforced* guardrail (`test/no-updater.test.ts`) plus an e2e-verified network kill-switch
   against outbound requests — both stay intact. The About screen instead gets a "Check for the
   latest release" button that calls `shell.openExternal` to the GitHub releases page. The app
   itself makes no network call. Do not reinterpret this as license to add real update-checking
   later without an explicit new decision from the project owner.

---

## Build order (current — supersedes the older doc's Build 4/5/6 order and numbering)

### Build 4 — Export suite
- Batch export: render every claim in a loaded 837/JSON to individual PDFs via one folder pick
  (main-process loop, determinate progress + cancel, per-claim failure reporting — never fail
  the whole batch for one bad claim).
- Structured CSV export of the normalized claim (one row per service line + header fields).
  PHI-minimal column profile is the default; "include patient identifiers" is an explicit,
  visually-marked opt-in — same posture as an existing PHI-conscious pattern elsewhere in the app.
- Structured JSON export of the normalized claim (same PHI-minimal-by-default posture as CSV).
- Combined single PDF across a batch export (pdf-lib merge/`copyPages()` once per-claim PDFs
  exist — small effort on top of batch export).
- Appended pages (cover / field annex / UB-04 revenue-code rollup / warnings page) — inherits
  Build 3.2's region-builder test pattern.
- Full spec pointers: `docs/BUILD_QUEUE.md` Build 4, `docs/UI_REQUIREMENTS_v3_queued_features.md`
  §4–6, plus this session's CSV/JSON decisions above.

### Build 5 — X12 837 export
Submission-grade, as scoped in decision 3 above. Its own adversarial audit and round-trip test
requirement — do not bundle it loosely into Build 4's mechanical export work.

### Ease-of-use + accessibility batch (no strict internal order; independent, low-risk, can interleave)
- Tooltips with shortcut hints on icon-only toolbar controls
- Recent Files surfaced on the welcome/empty-state screen (not just the File menu)
- Keyboard command palette (Ctrl+K) — fuzzy over existing actions/tabs/claims only, never a
  second feature list
- Bundled sample-claim set ("Open Sample Claim") — the welcome screen already has an unused,
  hidden `#sampleChip` stub waiting for content
- Deferred-render fast mode (opt-in, default OFF) — open straight to the inspector, defer the
  pdf.js canvas render
- High-contrast/greyscale render mode (view toggle only; export stays the faithful facsimile
  unless explicitly chosen otherwise)
- Clickable warnings that focus/scroll the offending inspector field (the DOM/inspector half —
  reuses Ctrl+F's scroll+flash-outline machinery). The PDF-canvas-box half needs Build 3.4's
  deferred per-box geometry; do that first if tackling the canvas half too.
- Full spec pointers: `docs/BUILD_QUEUE.md` Build 6, `docs/UI_REQUIREMENTS_v3_queued_features.md`
  §9–11, plus `docs/FEATURE_BACKLOG.md`'s backlog section for filing counts/rationale.

### Build 6 — Notes & audit
- Session-scoped per-line notes/flags/check-off marks (see decision 2 above — **not** persisted).
  In-memory annotation map on `TabState`, keyed by service-line id, cleared on tab close/restart.
  Extend the existing copy/TSV machinery to optionally carry annotations as a clearly separate,
  labeled block — never folded into "copy claim summary." Keep annotations out of PDF/CSV/JSON
  exports by default, with an on-screen "N session notes — not included in export" indicator.
- Local audit log (metadata only — timestamp, user, action, source path, hashed claim id,
  destination, app version; **never claim content**). Append-only, capped/rotated, viewable from
  About.
- Full spec pointers: `docs/BUILD_QUEUE.md` Build 5, `docs/UI_REQUIREMENTS_v3_queued_features.md`
  §7–8 (read with decision 2 above in mind — the persistence half described there is overridden).

### Build 7 — Installation & deployment enhancements
- Manual "Check for the latest release" link on the About screen (decision 4 above) —
  `shell.openExternal` to the GitHub releases page, no in-app network call.
- Enterprise/silent install support (NSIS silent switches, or an MSI variant) for IT-managed
  rollout.
- Installer UX: optional install-directory / per-user-vs-per-machine choice instead of always
  one-click (`package.json`'s `build.nsis.oneClick` is currently `true`).
- Bundled "what's new" changelog on the About screen, baked in at build time — no network needed.
- Shortcut/uninstall polish.
- **Code signing** — flagged separately, needs a purchased code-signing certificate and entity
  verification. That's a cost/procurement decision for the project owner, not something to build
  unprompted.

---

## Design-gated — do not build until a design lands
(`docs/design/ClaimViewer_v2.dc.html` currently has no screen for either)
- Side-by-side claim compare / field-level diff (22 filings — the single most-requested item not
  yet scheduled).
- 837 batch triage pane: sortable/filterable claim roster with warning roll-up (16 filings).

If asked to build either, produce the design pass first and get it reviewed before writing
implementation code.

## Blocked on a human decision, not on code — surface to the project owner rather than guessing
- Redaction profiles in exports (needs sign-off on exactly which identifiers each profile masks).
- Idle auto-lock + PHI purge (policy vs. preference, timeout value).
- Export destination guardrails for removable/consumer-sync volumes (hard-block vs.
  warn-and-acknowledge — not yet selected).
- True 1:1 print (needs a human at a physical printer to verify box registration).
- Headless CLI mode / tear-off multi-window (only worth it if there's a concrete downstream
  consumer — check before building).
- Real update-checking, if ever reconsidered (decision 4 above currently rules this out).

---

## Guardrails that apply to everything above (do not relitigate these)

- Claim **content** is never written to disk except an explicit user-directed export or the one
  approved editable-fields exception above — Build 4's CSV/JSON export and the editable-fields
  corrected-claim artifact are the deliberate, already-approved cases. Each must update
  `README.md`'s data policy and the About screen when it lands, if it hasn't already.
- No CPT/HCPCS/ICD-10 descriptor tables (AMA-licensed) — only public, freely redistributable CMS
  code sets.
- No auto-update dependency of any kind (`test/no-updater.test.ts` enforces this; decision 4
  above keeps "check for updates" to a manual external link only).
- Severity is always glyph + word, never color alone; exactly two severities exist
  (`info` | `warning`) — no new rule may imply a third.
- `src/renderer/**`, `style.css`, and `index.html` are a single-writer lock in any multi-agent
  session — don't parallelize edits into them.
- No NCCI bundling, MUE limits, upcoding/FWA scoring, or any rule needing a quarterly CMS edit
  file — this is a view/warning tool, not an adjudication engine.
