# Plan Revision v2 — JSON input, single-claim (2026-07-24)

**Supersedes** the X12/batch assumptions in `BUILD_PLAN.md` §0, §2 (parser), §3 (form mappers), §4.5 (batch export), §7 (fixtures), §10 (milestones), and the batch-oriented parts of `UI_REQUIREMENTS.md`. Everything not listed under "Still stands" below is revised here.

## Why
Real data does **not** arrive as X12 837 EDI. It arrives as **flat, pre-parsed clearinghouse claim JSON — one claim per file** (filename = `claimid`, e.g. `808226319.json`). Samples confirmed: both are `claim_form:"1500"` (professional). This removes ~40% of the hardened plan's complexity (no ISA/delimiters, no EBCDIC, no HL loops, no envelope integrity).

## 1. Input model (revised)
- **Reader:** `JSON.parse` a single file → validate → map to the normalized claim model. No tokenizer.
- **One claim at a time (user decision).** Open one JSON file, view it, export it. **No batch list, no multi-select, no batch export.**
- **Source abstraction:** a `ClaimSource` interface with two implementations:
  - `JsonClaimSource` — the primary/real path. Maps flat clearinghouse JSON → model. All samples so far are `claim_form:"1500"`.
  - `X12ClaimSource` — **built in v1 per user decision ("yes, build 837 support")**, using the hardened X12 parser from `BUILD_PLAN.md` §2 (delimiters/loops/HL). **Caveat: the user has no 837 test data.** Validated instead against the public **synthetic** 837 P/I/D corpus (Healthcare-Data-Insight/api-examples, ISA15=T) so the code path is exercised even though real 837s won't flow through the user's workflow.
- **File shape:** a single JSON **object** = one claim. An 837 file is a batch — the viewer loads it and steps through its claims **one at a time** (simple prev/next within the open file), preserving the single-claim view; no batch list/selection/export.

## 2. Form scope (revised — updated for the 837 decision)
- **CMS-1500 is the v1 primary deliverable** — fully mapped from the JSON (see §5). `claim_form` is read directly as the form selector for the JSON path (no GS08/ST03 derivation). Every JSON sample so far (5/5, incl. hospital-billed and ER claims) is `"1500"`.
- **All three form renderers (CMS-1500, UB-04, dental) get built** — because the **837 path reaches and tests UB-04 (837I) and dental (837D)** using the synthetic public corpus, even though the JSON feed hasn't produced a non-1500 claim. So UB-04/dental move from "deferred, no data" to "built and validated via the 837 source."
- **JSON mappers for UB-04/dental stay deferred** only in the narrow sense that the JSON feed's institutional/dental *shape* is still unknown (no rev-code/TOB/tooth fields seen). If a non-`1500` JSON ever appears, add a JSON→UB-04 / JSON→dental field map; the renderer + template already exist from the 837 work.
- Unknown/other `claim_form` (JSON) or unsupported 837 version → "cannot render as a form" placeholder; data still shown in the inspector.

## 3. What changes vs the hardened plan
- **X12 parser (BUILD_PLAN §2) is NOT deleted** — it becomes the `X12ClaimSource` module (secondary path, synthetic-test-only). The JSON path is the simple primary; the 837 path carries the parser complexity but is isolated behind the source interface.
- **Deleted from v1:** the 320px **batch claim list**, filter chips + type counts, dual-selection model, "Showing X of N / K selected", Select-all/filtered/clear.
- **Batch export** (scope radios, one-file-per-claim, "writing claim 128 of 340" progress). Export becomes **"Export this claim → one PDF."**
- Claims nav ("Claim X of 340", prev/next across a batch) and the batch count-mismatch banner.

## 4. What STILL STANDS (unchanged from BUILD_PLAN.md)
- **§4 PDF render / coordinate system** — self-authored black form templates, one versioned-JSON coordinate map, calibration grid, Unicode TTF embed, comb/overflow policy, **intra-claim pagination** (a single claim with many service lines still paginates: 6 rows/CMS-1500 page).
- **§5 Electron security** (contextIsolation/sandbox/CSP/frozen preload), **§6 offline enforcement** (network kill-switch + CI proof), **§9 PHI hygiene** (in-memory only, no at-rest, redacted logging, OneDrive export warning).
- **§8 packaging** — per-user install, **unsigned v1** (SmartScreen click-through), templates/fonts as replaceable resources.
- Single render source of truth (**pdf-lib generates → pdf.js renders the same bytes**), BitLocker-only export guidance (no qpdf), visual-fidelity export + PDF-UA caveat.

## 5. JSON → CMS-1500 field map (from the observed schema)
Names use `l/f/m` = last/first/middle. Charge lines come from the `charge[]` array.

| CMS-1500 box | JSON field(s) |
|---|---|
| 1a Insured ID | `ins_number` |
| 2 Patient name | `pat_name_l`, `pat_name_f`, `pat_name_m` |
| 3 Patient DOB / sex | `pat_dob`, `pat_sex` |
| 4 Insured name | `ins_name_l/f/m` |
| 5 Patient address/phone | `pat_addr_1/2`, `pat_city`, `pat_state`, `pat_zip`, `pat_phone` |
| 6 Patient rel. to insured | `pat_rel` (18=self, 01=spouse, 19=child, G8=other) |
| 7 Insured address/phone | `ins_addr_1/2`, `ins_city/state/zip`, `ins_phone` |
| 9 / 9a-d Other insured | `other_ins_name_l/f/m`, `other_ins_group`/`other_ins_number`, `other_ins_plan` |
| 10a-c Condition related to | `employment_related`, `auto_accident`, `auto_accident_state` |
| 11 Insured group/FECA | `ins_group` |
| 11a / 11b / 11c | `ins_dob`+`ins_sex` / `ins_employer` / `ins_plan` |
| 11d Other health plan | true if `other_ins_*`/`other_payer_*` present |
| 17 / 17a / 17b Referring | `ref_name_l/f/m` / `ref_id` / `ref_npi` |
| 18 Hospitalization dates | `hosp_from_date`, `hosp_thru_date` |
| 19 Additional info | `narrative` |
| 21 Diagnoses (ICD-10, A–L) | `diag_1`…`diag_12` → letters A–L (indicator `0`); `diag_13..24` overflow-flagged (paper 1500 holds 12) |
| 23 Prior auth | `prior_auth` |
| 24A date | `charge[].from_date` / `thru_date` |
| 24B place of service | `charge[].place_of_service` |
| 24D proc + mods | `charge[].proc_code` + `mod1..mod4` |
| 24E dx pointer | `charge[].diag_ref` (letter string, e.g. "AB" → A,B) |
| 24F charges | `charge[].charge` |
| 24G units | `charge[].units` |
| 24J rendering NPI | `prov_npi` (+ `prov_taxonomy`) |
| 24 shaded (lab/NDC) | `clia_number`, `narrative` |
| 25 Federal Tax ID | `bill_taxid` + `bill_taxid_type` (E=EIN, S=SSN) |
| 26 Patient account # | `pcn` |
| 27 Accept assignment | `accept_assign` |
| 28 / 29 | `total_charge` / `amount_paid` |
| 32 / 32a Service facility | `facility_name`, `facility_addr_1/2`, `facility_city/state/zip` / `facility_npi` |
| 33 / 33a / 33b Billing provider | `bill_name`, `bill_addr_1/2`, `bill_city/state/zip`, `bill_phone` / `bill_npi` / `bill_taxonomy` |
| Carrier block (top) | `payer_name`, `payerid`, `payer_addr_1/2`, `payer_city/state/zip` |
| Rendering provider (31) | `prov_name_l/f/m`, `prov_npi` |

Not present in the feed (leave blank on the form, or confirm later): boxes 14/15/16 (onset/similar-illness/work dates), 22 (resubmission — possibly `icn_dcn_1`). `pat_rel` and `*_poa` present but POA only matters for institutional.

## 6. Claim model + validation
- Normalized model unchanged in spirit (patient, insured, payers[primary/other], diagnoses[A–L], serviceLines from `charge[]`, providers billing/rendering/referring/facility).
- **Per-claim validation surfaced in the inspector (non-blocking):** Σ `charge[].charge` vs `total_charge`; NPI length/checksum on `bill_npi`/`prov_npi`; date format sanity; `diag_ref` letters that point past the populated `diag_*`. `"0000-00-00"` dates and empty strings render as blank/—, never literal.

## 7. Revised UI (single-claim)
Keep from the existing design: Open, the 612pt form preview + provenance chip, zoom (out/in/fit-page/fit-width), **pages-of-this-claim** nav (multi-line claims still paginate), the inspector drawer (box-tagged field groups + reconciliation), Export → one PDF with destination + BitLocker/PHI notice, offline indicator, Sample-data chip, light/dark.
Drop for v1: the whole left claim-list panel, filter chips/counts, selection model, batch count banner, batch export scope/progress, claims prev/next.
Change: inspector "Raw segments" → **"Raw JSON fields"**; batch count-mismatch banner → **per-claim data-validation banner** (reconciliation/missing-field warnings). The window becomes a focused single-claim viewer (roughly: toolbar + preview + inspector).

## 8. Revised milestones
- **M0 — skeleton:** open one CMS-1500 JSON → map → self-drawn grid → PDF → pdf.js preview → unsigned per-user installer. Offline kill-switch live.
- **M1 — JSON reader + single-claim viewer:** parse/validate one file; normalized model; viewer (preview, zoom, inspector, pages nav); robustness (malformed JSON, missing/empty fields, unknown `claim_form`, `0000-00-00` dates).
- **M2 — CMS-1500 full mapping + export:** complete §5 map incl. 24 grid, multi-letter dx pointers, intra-claim pagination (>6 lines), provider disambiguation, Category-II/`$0.01` lines; export this claim → PDF with BitLocker notice.
- **M3 — X12 837 source:** `X12ClaimSource` (parser from BUILD_PLAN §2) producing the same normalized model; per-claim step-through of a batch file; validated against the synthetic public 837 corpus (P/I/D). No user test data — corpus is the oracle.
- **M4 — UB-04 + dental renderers:** self-authored UB-04 and ADA-2024 templates + coordinate maps, driven by 837I/837D claims from M3. (JSON→UB-04/dental mappers added later only if a non-1500 JSON appears.)
- **M5 — polish/packaging:** PHI-at-rest grep test, offline-proof CI, unsigned installer, operator guidance.

## 9. Open items
- **UB-04/dental via JSON:** if the JSON feed ever emits a non-`1500` claim, send one so I can add a JSON→UB-04/dental field map (the renderers/templates already exist from M4). The 837 path covers these forms in the meantime.
- **837 realism:** the 837 source is validated only against the synthetic public corpus; if a real 837 ever surfaces, re-verify against it.
- **Missing 1500 fields** (14/15/16/22): confirm whether the JSON feed ever carries onset/resubmission data or they stay blank (all 5 samples: blank).
- Confirm the full set of `claim_form` values the JSON feed emits (only `"1500"` seen across 5 files, incl. hospital-billed + ER).
