# Build 2 adversarial audit — findings and disposition

Audited: `build-2-green` (commit `a7cf83e`) — 2.0 UI text scale, 2.1 Ctrl+F search,
2.2 CMS code decoding.
Method: 4 independent audit dimensions, each finding verified by a separate
adversarial pass instructed to default to REFUTED.

**30 findings verified · 23 CONFIRMED · 5 ALREADY-ACCEPTED · 2 refuted or corrected.**

> **Verdict as delivered:** *"Build 2 is NOT trustworthy as tagged. The UI-scale and
> search features are architecturally sound and mostly working, but the 2.2
> code-decoding tables — the one feature whose entire value is factual accuracy —
> contain confirmed wrong decodes in three of eight tables."*

The verdict was correct. All 23 confirmed findings are fixed in `82acc68` and
`edcbb3c`.

---

## Why this audit mattered

Build 1's audit found 33 defects including an export that wrote the wrong claim.
Build 2's found something different and arguably worse: **the app was confidently
displaying false information.** Not a crash, not a layout glitch — wrong plain-English
labels rendered inline beside real dates and dollar figures, on claims used in
negotiation, with a fully green test suite.

The root cause was structural, not careless. Eight code tables shipped with **four
spot-check assertions between them**. Nothing could have caught a transcription error.

---

## BLOCKING

### 1. `occurrenceCodes.ts` — three-code transcription shift

A clean leftward shift through the therapy series: `39`, `44` and `45` carried the
labels belonging to `44`, `45` and `46`, and **`46` was absent entirely**. `27`, `28`
and `41` were displaced too.

The shift was self-evident from the file alone: it already had the correct
plan-established codes at `17`/`29`/`30`, and `38` correctly read "home IV therapy" —
the pair-mate of the OC 39 IV-discharge code that had been overwritten.

**Fix:** re-derived the whole `01–62` block from one aligned source in a single pass
rather than patching six keys. Patching would have left the neighbouring untested
entries in the same transcription run half-corrected.

**Also split `OCCURRENCE_SPAN_CODES` into its own table.** The file decoded FL31–34 and
FL35–36 against one merged table and its header claimed the approximation "is never
presented as certain — see decode.ts". `decode.ts` was a bare lookup; `main.ts` routed
both fields through the identical function into the same DTO field; the renderer gave
both identical treatment. **No code path implemented the claimed safeguard.** The two
NUBC lists do not even share a numeric range (occurrence `01–62`, span `70–82`), so the
merge produced confident wrong answers for no benefit.

### 2. `valueCodes.ts` — five wrong decodes including a duplicate label

Provable with no external source: `42` and `62` decoded to the **identical string**
"Veterans Affairs". Peritoneal dialysis sat on `68` with **no `67` key at all** — the
same off-by-one-key pattern as the occurrence table. `17`, `55` and `69` were wrong.

**Fix:** rebuilt the block from source. `62`/`63` and the reserved `73–75` range are
payer-internal and are now **omitted rather than given a guessed label**, per the file's
own stated policy. "No decode" is strictly better than "a plausible decode".

---

## MAJOR

| # | Finding | Fix |
|---|---|---|
| 3 | `conditionCodes.ts` — CC 81 decoded as "Cost outlier — IPPS", colliding with CC 61. NUBC 81 is the <39-weeks-gestation attestation, so a maternity claim displayed a reimbursement concept the code does not express. | Corrected; added 82–84, 87, 90–92. |
| 4 | `typeOfBill.ts` — K/M/P wrong, with an **invented "QIM" acronym on two different letters**. The frequency folds into `combined`, which lands on the headline "Type of bill" row, so a bill ending in M showed a nonexistent category instead of Medicare Secondary Payer. | K = OIG-initiated, M = MSP-initiated, P = QIO. Also corrected B (termination/revocation, distinct from D void/cancel). |
| 5 | 64-char decode truncation made discharge status **05 and 85 render byte-identical**, and dropped trailing modifiers from the joined service-line decode string. Full text was hover-only; the aria-label excluded the decode. | Truncation removed — `.inspRowVal` already wraps. Decode added to the accessible name. |
| 6 | Search open-state snapshot captured once per session, never re-captured, so a cross-claim jump replayed **one claim's layout onto another** and left force-opened groups permanently expanded. | Snapshot keyed to `(tabId, claimIndex)`, re-captured in `reapply()` before the force-open, refused when the key no longer matches. |
| 7 | `.dialog` had a scale-aware max-**width** but no max-**height**, inside a non-scrolling overlay under `#app { overflow: hidden }`. The shortcuts sheet overflowed at 175%, putting its **only close button above y=0** with no scrollbar. | Flex column, scrolling body, scale-aware max-height. |
| 8 | The entire preview-pane state layer (`#welcomeScreen`, `#loadingScreen`, `#errorScreen`, `#chipRow`, `.unsupportedNote`) was **outside every zoomed region**, so UI scale did nothing to the app's first screen or any parse-error message — precisely the text the feature existed to enlarge. | `zoom` applied to those five individually (never to `.stateScreen`/`#workspaceScreen`, which would pull `#pdfCanvas` into a zoomed subtree); boxes em-converted. |

---

## Confirmed minors — all fixed

- **Shift+Enter skipped the last match.** The plain modulo folded the `-1` sentinel to
  `len-2`. Extracted as a pure `nextMatchIndex()` so the sentinel is unit-testable.
- **Focus dropped to `<body>`** when the cross-claim jump button hid itself while
  focused — the common case, since a query unique to one claim drops the count to 0
  after jumping.
- **`priorFocusEl` had no else-branch**, so entering the field from `<body>` left a
  stale element and Esc threw focus somewhere the user never came from.
- **Search matched across component boundaries.** Separators are deleted before a
  substring test on the concatenation, so `0399` matched by spanning a date's day and a
  procedure code's leading digits — a counted match and a persistent outline on a row
  where the string appears nowhere on screen. Now matched per component. `+` joins `-`
  in the strip set so money matching is symmetrically sign-blind rather than
  asymmetrically wrong.
- **Search state was never reset on tab close**, so a query — and the closed document's
  snapshot — survived into the next file opened.
- **Revenue codes were keyed 4-digit only** while SV2-01 passes through verbatim, so a
  3-digit code silently lost its decode. `decode.ts` already left-padded for the
  identical variance on FL04.
- **Modifier 63** dropped the under-4-kg threshold that is its entire applicability
  trigger.
- **`.toast`'s em conversion divided by 13** while the element declares `12.5px`, so
  every toast rendered ~4% narrower than intended. It is the one converted element that
  declares its own font.

---

## Test-quality findings — the reason this was invisible

The audit's own summary of the largest gap:

> *"No unit test asserts ANY value in the eight `src/data/` code tables beyond a handful
> of spot checks... Every confirmed wrong decode in this audit was invisible to a fully
> green suite."*

Fixed by `test/decodeTables.test.ts` (new, 44 assertions), which pins the corrected
codes **and** adds mechanical structural checks: no blank or placeholder labels, and
**no two codes in one table sharing a decoded string.** That last check needs no
code-set knowledge at all and would have caught `valueCodes` 42/62 and `conditionCodes`
61/81 automatically.

**It found a ninth defect on its first run** that all four audit agents missed:
`revenueCodes.ts` decoded `0960`, `0970` and `0980` to the identical bare string
"Professional fees".

Two existing tests **actively resisted** their own fixes and were repointed:

- `decode.test.ts` used POS `27` as its "unrecognized code" fixture — but 27 is
  assigned (Outreach Site/Street, 2023-10-01). It was a real table gap, so correcting
  the table turned the test red.
- `e2e/decode.spec.ts` anchored on occurrence codes `A1`/`A2` being undecodable, calling
  them "payer-specific extensions". They are standard NUBC insured-designation codes.

Both now assert invariants that cannot go stale as the tables grow — the durable one
being *no row ever renders the word "Unknown"*.

Also fixed:

- **`fitMath.test.ts`'s "scale-invariance" tests were tautologies** presented as the §9
  acceptance proof: they called a pure function twice with identical inputs and asserted
  the results matched. Any implementation passes, including one dividing by a hidden
  `--ui-scale` global. Replaced with hardcoded expected values; the header now correctly
  names `e2e/uiScale.spec.ts` as the sole proof of that criterion.
- **Canvas baselines were captured with no wait for the first pdf.js render.**
  `#pdfCanvas` carries no width/height attributes, so unrendered it reports the
  **300×150 HTML default, not 0×0** — making `expect(width).toBeGreaterThan(0)` vacuous
  under a comment claiming it proved "a real render". A repo-wide pattern, now behind
  `e2e/support/canvas.ts`.
- A `searchMatch.test.ts` comment described a two-query case never executed and
  contradicted the assertion beneath it, so "correcting" the code to match would have
  broken the suite.

---

## ALREADY-ACCEPTED (deliberate, documented at the point of omission — do not "fix")

- **UI scale does not re-run fit**, leaving fit-page/fit-width tabs at a stale zoom.
  Not a Build 2 defect: `toggleInspector` changes the pane width by 372px without
  re-fitting and is byte-identical in `build-1-green`. The independence is explicitly
  asserted as intended. If ever tightened, do it uniformly for scale AND inspector
  toggle via a shared `refitActiveTab()`.
- **`modifiers.ts` reproducing CPT Appendix A modifier descriptors** is spec-mandated,
  not an unrecorded exception to the AMA boundary — `BUILD_QUEUE.md` mandates "common
  modifiers" in the same sentence that excludes CPT/ICD *descriptor tables*, and no such
  table exists under `src/data/`.
- **Decoded text and the Raw JSON/837 group are unsearched.** Both exclusions are
  deliberate and documented; the index is the raw `row.value`, never the `.decoded`
  sibling. Do not widen without a spec change.
- **Manually collapsing a group while a query is active is undone on the next
  keystroke.** Both halves are the documented contract verbatim. The two rules must not
  be changed independently.
- **Search state survives a tab switch.** Documented as intentional, explicitly
  enumerating "tab switch / claim step / a cross-claim search jump".

---

## Sourcing discipline

The audit ran **offline** and flagged this itself:

> *"the replacement labels must be taken from a source during the fix pass, not from
> this report."*

That instruction was followed. Every replacement label came from the Noridian JE/JF
Part A reference tables (occurrence, occurrence span, value, condition codes) and the
NUBC claim-frequency series — not from the audit's suggestions. The audit's
*internal-inconsistency* evidence (duplicate strings, missing keys, the visible shift)
stands on its own and was confirmed independently by those sources on every point.

Where the audit flagged something it could not confirm, it said so, and those were
handled separately rather than swapped for another guess:

- `conditionCodes` `62` — source says PIP bill, payer-internal. **Omitted** rather than
  relabelled.
- `typeOfBill` `B` — confirmed genuinely wrong (termination/revocation, not "cancel of
  election", which is D). Corrected.

**One open discrepancy, deliberately not changed:** Noridian gives value code `66` as
"Medicare spend down amount"; the file says "Medicaid spend-down amount", which matches
the widely-published NUBC definition. It was not flagged by the audit and the sources
conflict, so it was left alone rather than swapped on a single ambiguous reading. Worth
a second source check on the next refresh.

---

## Verification

| Gate | Before | After |
|---|---|---|
| typecheck (3 configs) | pass | pass |
| vitest | 202 | **258** |
| Playwright E2E | 47 | **49** |
| screenshot specs | 8 | 8 |
| portable exe | rebuilt | rebuilt, unsigned (intended) |

**asar verified** — all 8 decode tables ship as compiled `.js` (as `.json` they would
ship *empty* while every test passed, since vitest reads the source tree), 8 TTFs
present, and the corrected values confirmed **inside the package**: occurrence 44/45/46
correct, `OCCURRENCE_SPAN_CODES` present, value 67/68/69 correct, condition 81 correct,
TOB K/M/P correct, and the string "QIM" appearing exactly once — in the comment
explaining why it must never appear again.

**Every new assertion was confirmed to fail against the pre-fix code**, per the rule
established after Build 1's About-version bug hid behind a `not.toHaveText('')`
assertion:

- **26 of 44** new code-table assertions fail at `build-2-green`; 18 pass.
- With `style.css` reverted and the app rebuilt, **exactly the two new 175% tests fail**
  and the other four in that file pass.

---

## Still open

- The 13 SHOULD-FIX items and coverage gaps from `AUDIT_BUILD1.md`.
- Builds 3–6 not started.
- **Nobody has run the app against a real claim yet** — the one thing no audit catches.
- UI scale at 175% is verified programmatically, never seen on a real 175%-DPI display.
