# Feature backlog — 50-reviewer panel

_215 feature requests from 50 reviewers (17 domain experts, 17 everyday users, 16 power users), 2026-07-27. Clustered, deduped and graded for build safety._

## Themes (most-requested first)

### 1. Get parsed data out of the app without retyping (clipboard / TSV / CSV)  
**38 filings.** By far the loudest signal: every persona retypes the Box 24 / Box 42-47 service-line grid and header identifiers (billing NPI, tax ID, patient account number, total charge, ZIP, POS) into a repricing spreadsheet, a negotiation letter, or an account note. They want click-to-copy on any inspector field, a 'copy service lines as TSV' action (Ctrl+Shift+C), and a 'copy claim summary' plain-text block. Named as the single biggest source of transcription error in the workflow.

### 2. Find/search across the parsed claim (and across an 837 batch) with jump-to-box  
**27 filings.** Ctrl+F over the parsed model — CPT, revenue code, member ID, control number, dollar amount, date, tooth number — that filters the inspector, tells you which claim in an 837 batch matched, and scrolls/flashes the corresponding box on the rendered form. Two separable halves: an inspector-only filter (cheap) and PDF box highlighting (needs renderer box geometry).

### 3. Side-by-side compare / field-level diff of two claims (original vs corrected/rebilled)  
**22 filings.** Replacement claims (CLM05-3 = 7 / bill type xx7) are a daily judgment call. Reviewers want to pin two open tabs (or two claims in one 837) into a split view with a diff of the normalized models — lines added/removed, units, modifiers, charges, DX pointers, NPIs — plus a matched service-line reconciliation table and a copyable/exportable diff summary. Explicitly framed as the payoff of the tabs work.

### 4. Deeper, domain-specific data warnings beyond the current five checks  
**18 filings.** Everyone wants their own hand-check list automated as non-blocking flags: DOS outside the statement period or in the future, duplicate service lines, revenue code with no HCPCS on outpatient UB-04, implausible units / NDC-quantity errors on J-codes, POS-vs-form-type mismatch, missing taxonomy or tax ID, TOB/discharge-status/frequency inconsistencies, dental tooth/surface/quadrant validity, and EDI structural defects (SE01 counts, duplicate CLM01, bad qualifiers). A separable tier of these is purely structural; another tier (NCCI/MUE/upcoding) is clinical judgment.

### 5. 837 batch triage: claim list/index pane with sort, filter and jump  
**16 filings.** Prev/next stepping is unusable on a 60-400 claim 837. Users want a sortable, filterable roster of every claim in the loaded file (claim/control number, patient account, billing provider, DOS span, total charge, line count, form type, warning icon) with click-to-jump, plus a file-level warnings roll-up so they can see batch health in one screen. EDI analysts additionally want the ISA/GS/ST envelope and SE-count manifest.

### 6. Richer export artifacts: appended summary / abstract / cover / continuation pages  
**12 filings.** The bare facsimile loses the context people actually work from. Requests: a claim-at-a-glance cover page, an inspector field-by-field annex, a revenue-code rollup page for long UB-04s, the warnings banner and reconciliation numbers carried into the PDF, a QA/reviewer sign-off page, and labelled continuation pages instead of silent truncation of >12 diagnoses or overflow service lines.

### 7. Plain-English decoding of coded fields and a field glossary  
**11 filings.** POS 21 vs 22, bill type 0131, frequency code 7, revenue code 0450, discharge status 30, modifiers 26/TC/59 — staff translate these by hand or from a paper cheat sheet. They want the decoded meaning shown next to the raw value in the inspector and a one-sentence hover explanation of each form box. Public CMS code sets only; separate from the licensed CPT/ICD description ask.

### 8. Annotations, flags and check-off state on service lines  
**11 filings.** Negotiators, QA reviewers, FWA investigators and EOB reconcilers all keep a parallel scratch document: per-line notes ('line 3 upcoded, ask for chart notes'), Dispute/Verify/OK triage marks, and matched/verified check-offs. They want it anchored to the line, filterable, and carried into an exported worksheet — and several explicitly ask whether note text lands on disk.

### 9. Accessibility: independent UI scaling, high-contrast render, non-colour severity encoding  
**10 filings.** Ctrl+scroll only zooms the canvas, so inspector labels stay tiny; low-vision users run Windows scaling at 175% and break the layout. Colour-blind users cannot separate amber from red on the warnings banner or green/red in the reconciliation panel. Asks: app-level UI font scale, a high-contrast/greyscale form render mode, glyph+word severity encoding, signed deltas with plain-language verdicts, and persistent-outline field locators.

### 10. Structured data export (CSV / XLSX / JSON) of the normalized model  
**9 filings.** Distinct from clipboard copy: a file deliverable of the normalized claim — one row per service line plus header fields — written next to the PDF, with stable column headers, optional warning/reconciliation flag columns, and a combined workbook across a whole batch. This is the real deliverable for the spreadsheet-driven and automation-minded users.

### 11. Redaction / minimum-necessary and PHI-safe export and screen modes  
**9 filings.** Claim facsimiles get sent to provider billing offices, members, outside counsel and appeal packets, and get demoed on shared screens. Users want selectable redaction profiles (mask patient name to initials, member ID, SSN, DOB to year, address to ZIP) burned into the rendered content with a REDACTED/profile-name stamp, plus a one-key on-screen PHI mask toggle for presentations.

### 12. Keyboard-first navigation: command palette, go-to-box, warning stepping, quick export  
**9 filings.** A fuzzy command palette that also lists open tabs and claims, Ctrl+G 'go to box 24', arrow/PageUp panning inside a zoomed preview, F8/Shift+F8 stepping through data warnings across a batch, keyboard-only quick export reusing the last folder, and a rebindable keymap.

### 13. Warning-banner usability: clickable jump-to-line, plain-English wording, severity roll-up  
**8 filings.** The current warnings say what is wrong but not where or what to do. Users want each warning clickable (focus the offending inspector field / form box), phrased in one sentence of consequence ('line 3 points to a diagnosis not on this claim — ask the provider to correct'), and summarised as a single clean/warn indicator, plus a copyable findings list for emails and appeal letters.

### 14. Batch export / batch print of every claim in an 837  
**8 filings.** Building a negotiation or provider packet means one PDF per claim; today that is one save dialog per claim. Asks: Export All / Export Selected to a chosen folder using the existing PHI-free naming with collision suffixes, progress and cancel, a written/failed summary, and optionally one combined PDF in claim order.

### 15. Field-level provenance: trace a rendered box back to its 837 segment or JSON path  
**6 filings.** When a provider or clearinghouse disputes a read, staff must cite the source: click a box or inspector field and land on the exact loop/segment/element (e.g. 2400 SV101-2) or JSON key, and the reverse. Extensions asked for: why a box is blank (absent vs empty vs unmappable) and a per-claim report of segments present in the 837 but not rendered (2320 COB, CAS, NTE, K3).

### 16. Pricing-context field group (ZIP+4, POS, bill type, facility vs non-facility)  
**6 filings.** Locality/GPCI and wage index depend on service-facility ZIP+4 (Box 32) not the billing address, and the facility switch comes from POS (24B) or the UB-04 bill type. Users want those pinned into a small 'pricing inputs' inspector group with unmasked 9-digit ZIP and one-click copy — surfacing parsed fields only, no rate math.

### 17. Compliance instrumentation: access/disclosure logging, idle lock, export destination guardrails, provenance stamp  
**5 filings.** Privacy and legal roles want an append-only local metadata-only audit log (Windows user, timestamp, file path, hashed claim identifier, action, export destination) with CSV export; a policy-enforced idle timeout that blanks the preview and purges decoded PHI; export-target detection that blocks or requires typed acknowledgement for removable/consumer-sync/unencrypted destinations; and an optional source SHA-256 + app version + 'not a submittable form' footer band on exports.

### 18. Multi-window / dual-monitor working  
**4 filings.** Tear a tab off into its own window (optionally always-on-top) for comparing a UB-04 against the professional claim, opt-in synchronised zoom/scroll/page across windows, and per-monitor layout restore across mixed 4K/1080p DPI.

### 19. Headless CLI / scripting hooks  
**4 filings.** Run the same renderer from PowerShell: --in/--out/--split-claims/--format pdf/--quiet for unattended batch rendering, --emit-json/--emit-csv to hand the normalized model to the repricing tooling, --validate-only --json with --fail-on warning for gating a drop folder, and open-at-claim addressing from other tools.

### 20. Sticky view preferences across claims, files and sessions  
**4 filings.** Zoom level, fit mode, UI scale, contrast mode, inspector open/closed and drawer width all reset on every claim step and every file open — costly for low-vision users (re-zoom dozens of times a day) and on slow machines (each reset re-renders). Overlaps directly with tonight's session-restore work.

### 21. Perceived performance on old hardware  
**2 filings.** Open straight into the inspector with the pdf.js render deferred until Preview is clicked (80% of reads only need the fields), and make the 500ms minimum loading state adaptive so it is not added on top of an already-slow real render when paging a 60-claim batch.

### 22. Training and onboarding support  
**2 filings.** A bundled File > Open Sample Claim set of synthetic claims (clean 837P, 837I with revenue codes, 837D, and one each triggering charge mismatch / bad DX pointer / invalid NPI) so a cohort opens identical claims, plus an annotated numbered-callout export mode for training handouts.

## Approved for the 2026-07-27 unattended build
See `TABS_BUILD_PLAN.md` §2f for the implementation brief.

1. **Copy service lines to clipboard as TSV (Ctrl+Shift+C)** — The single most-requested item across all 50 reviewers (38 filings) and the named root cause of daily transcription errors. It is also the cheapest thing on the list.

2. **Click-to-copy on every inspector field** — Requested alongside the grid copy by nearly every persona (NPIs, member IDs, control numbers, charges read aloud on provider calls); a mistyped NPI is described as an hour lost.

3. **Copy claim summary and copy warnings/reconciliation findings as plain text** — Team leads, appeals writers, member services and admin staff all retype the mismatch amounts, warning text and claim identifiers into Teams, account notes and letters; it reuses the exact machinery of the two items above.

4. **Glyph + explicit Error/Warning word on the warnings banner and inspector badges** — A colour-blind reviewer filed this as critical — severity currently reads as amber-vs-red only, so a blocking data problem is indistinguishable from a note without asking a coworker. Also improves the banner for everyone.

5. **Reconciliation panel: signed delta and plain-language verdict** — Colour-blind and low-vision users cannot read the current green/red outcome, and bookkeepers and appeals writers want the actual difference figure they currently compute by hand.

6. **Plain-English explanation line for each of the five existing data warnings** — Non-technical staff (admin assistant, older staff member, executive director, volunteer) cannot tell from 'diagnosis pointer with no matching diagnosis' whether the file is broken or they are; five fixed strings covers the entire current rule set.

7. **Make the 500ms minimum loading state adaptive** — On old office PCs the artificial floor is added on top of a genuinely slow render on every claim step through a 60-claim batch; a reviewer filed it as high-value and it is a few lines.

## Backlog — high value, needs human review/design

1. **[large] Find/search across the parsed claim and the 837 batch, with jump-to-box highlight** — Second-most requested theme (27 filings, several 'critical'). The inspector-filter half is moderate; the PDF-highlight half needs per-box geometry emitted by the renderers, which is exactly the layer tonight must not touch.

2. **[large] 837 batch claim list / triage pane with sort, filter and warning roll-up** — 16 filings; prev/next stepping is called unusable on 60-400 claim batches. Requires running the parse and warning pass across all claims up front, a new panel, and memory/perf decisions that interact directly with the tabs work.

3. **[large] Side-by-side compare with field-level diff of two claims** — 22 filings and the most-cited payoff of the tabs refactor. Needs a model-diff algorithm, a service-line matching key (CPT+modifier+DOS), a split layout, and design decisions about how changes are marked.

4. **[large] Structural extended data warnings (non-clinical tier)** — 18 filings. The defensible subset — DOS outside statement period or in the future, duplicate service lines, revenue code without required HCPCS on outpatient bill types, missing taxonomy/tax ID, UB-04 0001 total vs detail sum, dental tooth/surface/quadrant format validity — is real value but touches the warning engine and needs per-form-type rule design and a large fixture corpus.

5. **[large] Redaction profiles rendered into the exported PDF** — 9 filings from compliance, privacy, member-facing and escalation roles; today staff black out claims in Acrobat afterwards. Must be burned into the content stream (not an overlay), touches every renderer, and needs legal sign-off on which identifiers each profile masks.

6. **[medium] Batch export of all claims in an 837 to individual PDFs** — 8 filings; described as the single biggest time sink for packet building. Needs progress/cancel, filename collision suffixes, per-claim failure reporting, and repeated renderer invocation under memory pressure.

7. **[medium] Structured export of the normalized claim as CSV/XLSX/JSON** — 9 filings; the real deliverable for spreadsheet and automation users, and the natural feed into the repricing tooling. Writes claim data to disk, so it needs an explicit PHI decision (filename rules, the export dialog notice, whether a PHI-minimal column profile is the default).

8. **[medium] Direct print (Ctrl+P) at true 1:1 scale** — 5 filings, two of them 'critical' — paper-file users currently fight the printer's fit-to-page default, which puts CMS-1500 boxes off register. Needs print-scale control, margin handling and physical printer verification, which cannot be done unattended.

9. **[medium] Appended summary / abstract / cover pages on export** — 12 filings covering a claim-at-a-glance cover, an inspector field annex, a revenue-code rollup for long UB-04s, and carrying the warnings and reconciliation into the document. Touches the export pipeline and needs page-layout design.

10. **[medium] Plain-English decoding of public CMS code sets in the inspector** — 11 filings. POS, type of bill, frequency code, discharge status, revenue codes and common modifiers are public, freely redistributable tables, so this is the safe part of the 'decode the codes' ask. Needs bundled reference data, a refresh story, and inspector layout work.

11. **[medium] Independent UI text scaling separate from PDF zoom** — Filed as critical by the low-vision reviewer, who currently runs Windows scaling at 175% and breaks the app layout. Small in principle, but only if the chrome is already rem-based; verifying and fixing every fixed-px layout is a full pass and cannot be validated unattended.

12. **[large] High-contrast / greyscale form render mode** — Critical for the low-vision reviewer and requested by the colour-blind reviewer — the CMS-1500 red drop-out and UB-04 tint blocks are unreadable on screen. Requires an alternate render path in every form renderer while keeping the faithful facsimile as the export default.

13. **[medium] Clickable warnings that focus the offending field** — 8 filings across the warning-usability theme; today the banner says what is wrong but not where. Requires warnings to carry a stable field/line anchor, which likely means changing the warning objects the rule engine emits.

14. **[large] Field-level provenance back to the 837 segment or JSON path** — 6 filings from the roles who must cite a source to a clearinghouse or provider. Requires the parsers to retain source offsets through normalization — highest-risk layer in the app.

15. **[large] Local metadata-only access and disclosure audit log** — Filed as critical by both the compliance attorney and the privacy officer for HIPAA accounting of disclosures. Deliberately scoped to metadata (user, timestamp, path, hashed claim identifier, action, export destination) with claim content never logged, but it introduces the app's first persistent record and needs a policy decision on retention, location and whether hashed member identifiers are acceptable on disk.

16. **[medium] Idle auto-lock with PHI purge from renderer memory** — Shared-office walk-away exposure named by the privacy officer. Needs an idle/session-change hook, a locked pane, verified purge of decoded PHI, and a policy-vs-preference decision on the timeout.

17. **[medium] Export destination guardrails (removable / consumer-sync / unencrypted volumes)** — Cloud sync of PHI to a non-BAA consumer account is a reportable breach; staff routinely save to Desktop and OneDrive. Needs Windows volume/BitLocker interrogation and a hard-block-vs-acknowledge policy decision.

18. **[medium] Provenance footer band on exports (source filename, SHA-256, parse time, app version, facsimile disclaimer)** — Makes an exported claim stand on its own as a dispute exhibit. Modest logic but touches every renderer's page layout.

19. **[medium] Session-scoped per-line notes, flags and check-off marks** — 11 filings; negotiators, QA reviewers and EOB reconcilers all keep a parallel scratch document today. In-session-only marks are compatible with the current posture; the persistence half is not (see out_of_scope).

20. **[medium] Keyboard command palette, go-to-box, preview panning and warning stepping** — 9 filings from RSI, keyboard-power and small-screen users; also the discoverability surface for the growing shortcut set. Broad surface area and it collides with tonight's tab/keyboard bindings.

21. **[medium] Inspector type-to-filter with keyboard focus jump** — Filed as critical by the RSI and keyboard-power reviewers. Genuinely mid-sized on its own, but it adds per-tab inspector state in the same week the tabs refactor is establishing per-tab state — worth doing deliberately rather than unattended.

22. **[medium] Collapsible/overlay inspector with remembered width, and sticky view preferences** — 4 filings; low-vision users re-zoom dozens of times a day and 13-inch laptops lose half the form width. Deferred because it overlaps directly with tonight's session-restore work and would collide.

23. **[medium] Deferred-render fast mode (open into the inspector, render on demand)** — Filed as critical by the old-PC reviewer — 80% of reads only need the fields. Requires decoupling the render from the open path, which interacts with the tab-activation and background-tab memory work landing tonight.

24. **[large] Headless CLI mode (--in/--out/--split-claims, --emit-json, --validate-only)** — Two 'critical' filings; turns the viewer into the parsing front end for the repricing tooling and enables overnight batch rendering. Needs a non-GUI entry path, exit-code contract and offscreen rendering.

25. **[large] Tear-off claim windows with synchronized zoom/scroll and per-monitor layout restore** — Filed as critical by the dual-monitor reviewer for comparing a facility UB-04 against the professional claim. Multi-window Electron state, DPI handling across mixed displays, and layout persistence.

26. **[medium] Bundled synthetic sample-claim set for onboarding** — Filed as critical by the trainer — every cohort currently gets an emailed folder of scrubbed files. Low technical risk but requires authoring realistic synthetic 837P/837I/837D fixtures including deliberately defective ones, which is content work needing review.

27. **[large] 837 envelope / interchange manifest view (ISA/GS/ST, version, ISA15 test flag, SE counts) and dropped-segment report** — Two 'critical' filings from EDI and clearinghouse roles; the dropped-segment report in particular guards against negotiating from a form that silently omitted prior-payer COB data. Requires parser-level introspection.

28. **[medium] Continuation pages for overflow instead of silent truncation** — A UB-04 with more lines than the form holds, or a CMS-1500 with >12 diagnoses, currently produces an incomplete paper copy that nobody notices until it is challenged. Renderer pagination work.

29. **[medium] Pricing-context inspector group (service-facility ZIP+4, POS, bill type, facility vs non-facility)** — 6 filings from the pricing-adjacent roles; pure surfacing of already-parsed fields with one-click copy, no rate math, so it stays inside the boundary. Needs an inspector layout decision about pinning a group above the others.

## Out of scope (requested, but conflicts with a deliberate boundary)

1. Persistent per-claim notes, dispute annotations, verification check-offs and triage flags that survive reopening the file (annotator, EOB reconciler, escalation specialist, paper-bills user, QA reviewer). This is the 'not a claims database or case tracker, no status/workflow tracking' boundary, and it would put note text quoting patient details on disk, breaking 'claim content is never written to disk'. Session-scoped marks are in backlog_major; the persistence layer is the part that conflicts.

2. NCCI PTP bundling edits, MUE unit limits, upcoding detection and FWA pattern scoring (CPC, adjudicator, auditor, FWA investigator, data-quality analyst). These move the tool from a faithful viewer to an adjudication/audit engine making clinical-coding judgments, and they depend on quarterly CMS edit files that an unsigned portable exe with no auto-update and an enforced network kill-switch cannot keep current — a stale bundled edit table producing confident wrong flags is worse than no flag. Structural, date-and-arithmetic checks that need no clinical judgment are in backlog_major instead.

3. Bundled CPT/HCPCS/ICD-10 code descriptions and effective-date validity tables (CPC, patient advocate, member services, trainer). CPT descriptors are AMA-licensed and cannot be redistributed in an internal tool without a license, and the effective-date check has the same staleness problem as the edit tables. The public, freely redistributable code sets (POS, type of bill, revenue codes, discharge status, condition/occurrence/value codes, modifiers) are carved out into the backlog decoding item.

4. A claimviewer:// URI protocol handler for open-at-claim addressing from other tools (automation user). Registering a protocol handler requires a per-machine registry association, which conflicts with the deliberate portable, unsigned, copy-the-exe deployment model — and Windows will not let an unsigned portable app claim an association silently. Plain CLI arguments achieve the same workflow and are in backlog_major.

5. Pinning an arbitrary image or PDF of the member's mailed statement or EOB alongside the claim (patient advocate). The tool opens claim files and renders them; accepting arbitrary documents makes it a general document viewer and drags in an image/PDF import path with its own PHI handling. Comparing two claim files is the supported version of this need.

6. Applying or displaying the Brotherhood office/facility multiplier, or any repricing implication attached to the POS/bill-type context strip (ministry administrator). Pricing math lives in the separate medicare-pricing tooling by design. Surfacing POS and bill type as parsed fields is fine and is in the backlog; attaching a multiplier or a target amount to them is not.

7. Treating the exported PDF as a submittable or official form — including any framing of the integrity-stamped export as the original claim (compliance attorney, escalation specialist). The export is deliberately a visual facsimile and is not PDF-UA tagged; the provenance footer in backlog_major is acceptable only because it explicitly carries the 'visual facsimile, not a submittable form' disclaimer rather than removing it.
