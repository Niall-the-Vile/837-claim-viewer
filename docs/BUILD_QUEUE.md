# Build queue — run sequentially in the 2026-07-27 22:00 session

All builds run **back-to-back inside the single scheduled run**, not as separate
timed tasks: build durations are unpredictable, and two Claude sessions editing this
repo simultaneously would be destructive. Work the list in order and stop cleanly
when usage runs out.

Ordering follows the 50-reviewer panel's filing counts (`FEATURE_BACKLOG.md`) and
dependency order.

---

**UI requirements for every new surface in Builds 2-6 are in
`docs/UI_REQUIREMENTS_v3_queued_features.md`. Read it before implementing any of
them — search, decoded values, the warnings banner at volume, batch export,
structured-export options, appended PDF pages, per-line notes, the audit log viewer,
UI scaling/high-contrast and the command palette all have a written spec. Do not
invent layout for these.**

## Rules for EVERY build in this queue

1. **Start green or stop.** Before starting each build, run `npm run verify`. If the
   repo is not fully green (typecheck + vitest + build + Playwright E2E), **do not
   start the next build** — stop the whole chain, report what's broken, and leave the
   tree at the last green state. Never compound a failure.
2. **Finish green, then checkpoint.** Each build ends with a full `npm run verify`, a
   rebuilt portable `.exe`, and a section appended to `docs/BUILD_LOG.md` (what
   shipped, test/E2E counts, exe timestamp, anything unverified). That file is the
   morning report.
3. **Stop cleanly on usage limits.** If usage/limits are running out, finish the
   build in progress to a green, verified state, checkpoint it, and **do not start
   another**. A half-finished build left mid-refactor is far worse than a shorter
   queue. Say plainly in `BUILD_LOG.md` where the chain stopped and why.
4. **Guardrails in `TABS_BUILD_PLAN.md` §1 apply to every build**, plus whatever the
   preceding builds added. Re-read that list at the start of each.
5. **Delegate to Sonnet subagents**; keep review/synthesis on the main model.
6. **Screenshots to `docs/screenshots/`** for anything visual — **synthetic fixtures
   only, never a real claim file** (a screenshot of real data would put PHI in the repo).
7. **Adversarial verification** before each build is called done: fan out, then verify
   every finding CONFIRMED / REFUTED / ALREADY-ACCEPTED, defaulting to REFUTED when it
   can't be reproduced.
8. **Never distribute** the .exe anywhere. Producing it is the deliverable.
9. **Report honestly**, including partial completion. Never claim a success the command
   output doesn't support.

---

## Build 1 — Tabs + polish (already specified)
See `TABS_BUILD_PLAN.md`. Run it first, in full.

---

## Build 2 — Search & code comprehension
*Panel themes #2 (27 filings) and #7 (11). Renderer/UI + bundled data only.*

**2.1 Find/search across the parsed claim — inspector half.**
`Ctrl+F` filters the inspector to matching fields (CPT, revenue code, member ID,
control number, dollar amount, date, tooth number), with a match count and
step-through. In an 837 batch, report which claims matched and jump to one.
**Excluded tonight:** highlighting the matched box on the rendered PDF — that needs
per-box geometry from the renderers, which Build 3 adds.

**2.2 Plain-English decoding of public CMS code sets.**
Decoded meaning beside the raw value in the inspector for place of service, type of
bill, frequency code, discharge status, revenue codes, condition/occurrence/value
codes and common modifiers. **Public CMS sets only** — CPT/ICD descriptors are
AMA-licensed and stay out. Bundle as data files with a documented refresh path.

---

## Build 3 — Data integrity
*Panel theme #4 (18 filings). Touches the warning engine and renderers — the riskiest
build in the queue; demands the strongest fixtures and tests.*

**3.1 Extended structural warnings (non-clinical tier only).** DOS outside the
statement period or in the future; duplicate service lines; revenue code without
required HCPCS on outpatient bill types; missing taxonomy/tax ID; UB-04 `0001` total
vs detail sum; dental tooth/surface/quadrant format validity; EDI structural defects
(SE01 counts, duplicate CLM01, bad qualifiers). All non-blocking flags.
**Clinical-judgment edits (NCCI/MUE/upcoding) stay out** — they need quarterly CMS
files an offline app can't keep current, and a stale table producing confident wrong
flags is worse than no flag.

**3.2 Continuation pages instead of silent truncation.** A UB-04 with more lines than
the form holds, or a CMS-1500 with >12 diagnoses, currently yields an incomplete paper
copy nobody notices until it's challenged.

**3.3 Provenance footer band on exports.** Source filename, SHA-256 of the source,
parse time, app version. The "visual facsimile, not a submittable form" disclaimer
**stays** — this footer supplements it, never replaces it.

**3.4 Per-box geometry emitted by the renderers**, unblocking search-highlight and any
future field locator.

**3.5 Clickable warnings that focus the offending field** — requires warnings to carry
a stable field/line anchor, which fits naturally with 3.1's rule-engine work.

---

## Build 4 — Export suite  *(newly unblocked)*
*Panel themes #6 (12) and #10 (9). Niall approved structured export on 2026-07-27.*

**4.1 Batch export** every claim in an 837 to individual PDFs — progress/cancel,
filename collision suffixes, per-claim failure reporting, memory-safe repeated
renderer invocation.

**4.2 Appended summary pages**: claim-at-a-glance cover, inspector field annex,
revenue-code rollup for long UB-04s, warnings + reconciliation carried into the PDF.

**4.3 Structured export — CSV / XLSX / JSON of the normalized model. APPROVED.**
One row per service line plus claim header fields. **This writes claim CONTENT to
disk** — a deliberate policy step beyond the file paths already persisted:
- Default to a **PHI-minimal column profile** (identifiers, codes, amounts, dates,
  provider info — no patient name/DOB/address), with a clearly-labelled opt-in
  "include patient identifiers" toggle for when the destination genuinely needs it.
- The export dialog's unencrypted-PHI / BitLocker notice must appear here too.
- Update `README.md`'s data policy and the About screen so the app's stated behavior
  matches what it now does.
- Re-scope (don't delete) the PHI-at-rest test again: it must still prove claim data
  never reaches disk *except* through an explicit user-initiated export.

**Deferred from this build:** true 1:1 print (Ctrl+P). It needs a human at a physical
printer to confirm CMS-1500 box registration — cannot be validated unattended.

---

## Build 5 — Notes & audit  *(newly unblocked)*
*Panel theme #8 (11 filings). Niall approved persistence and the audit log on 2026-07-27.*

**5.1 Per-line notes, flags and check-offs — now PERSISTENT. APPROVED.**
Per-line notes, Dispute/Verify/OK triage marks, filterable, carried into an exported
worksheet. Persist keyed to the source file + claim id under `userData`.
- **This puts free-text that will quote patient details on disk.** Store it in one
  clearly-named file so it can be found and purged; extend the existing
  "forget open tabs & recent files" action to offer clearing notes too.
- Update `README.md` and the About screen. Re-scope the PHI-at-rest test accordingly.

**5.2 Local audit log — metadata only. APPROVED.**
For HIPAA accounting of disclosures (filed *critical* by both the compliance attorney
and the privacy officer). Record: timestamp, Windows user, action (open / export /
print), source path, **hashed** claim identifier, export destination, app version.
- **Claim content must never be logged** — no patient names, no codes, no amounts.
- Append-only, one file under `userData`, with a documented retention/rotation story
  (cap size, roll over) and a way to view it from the About screen.
- Add a test asserting the log contains no PHI canary after a full open/export cycle.

---

## Build 6 — Accessibility & performance
*Panel theme #9 (10 filings). Visual — screenshot everything; expect a human pass.*

- **Independent UI text scaling**, separate from PDF zoom (filed *critical* by the
  low-vision reviewer, who runs Windows at 175% scaling and breaks the layout).
- **High-contrast / greyscale form render mode**, keeping the faithful facsimile as
  the export default.
- **Deferred-render fast mode** — open into the inspector, render on demand (filed
  *critical* by the old-PC reviewer; ~80% of reads only need the fields).
- **Keyboard command palette**, go-to-box, preview panning, warning stepping.

---

## DESIGN-GATED — do NOT build tonight

Niall chose a **Claude Design pass** for these two, so they wait for the design
artifact. Building them from my own layout judgment would waste the work.

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
