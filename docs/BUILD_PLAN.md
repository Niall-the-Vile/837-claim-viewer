# Hardened Build Plan — Offline 837 EDI Claim Viewer (Electron / Windows)

## 0. Scope (locked — unchanged)
- Offline, single-machine Windows Electron app. **View-only.** No pricing/Medicare math.
- Parses X12 837 5010 batches and renders each claim onto a claim form, exports the whole batch to one multi-page PDF.
- Transaction types: **837P → CMS-1500**, **837I → UB-04 (CMS-1450)**, **837D → dental**. All three ship.
- Fidelity target reworded from "pixel-exact" to **point-exact in PDF space with a scaled, byte-identical preview** (see §4). Templates are **self-authored black coordinate grids**, not redistributed official artwork.
- Fully offline, no telemetry, no auto-update. Enforced and proven, not asserted (§8, §9).
- Audience: small non-technical internal Brotherhood negotiator team.

---

## 1. Architecture

```
Electron app
├─ main process        window lifecycle, dialogs, network kill-switch, IPC handlers
├─ worker (utilityProcess / worker_thread)
│     X12 decode → tokenize → envelope tree → normalized claim model
│     PDF generation (pdf-lib) — CPU-heavy, off the main/UI thread
├─ preload (contextBridge)  frozen, enumerated API only
└─ renderer (sandboxed)   claim list (virtualized) + pdf.js canvas preview + export UI
```

Key architectural decisions resolving the fidelity/security/perf findings:

- **Single rendering source of truth.** pdf-lib generates the overlaid PDF pages; the renderer displays *those exact bytes* via **pdf.js** rendered to canvas. Preview and export are byte-identical by construction. There is **no** parallel HTML/CSS form renderer. This also eliminates the DOM-XSS surface for claim data in preview.
- **Heavy work off the UI thread.** All decode + parse + PDF assembly run in a `utilityProcess`. Progress events (`claim n/N`, `writing page p`) drive a determinate progress bar; a Cancel aborts cleanly.
- **PHI never at rest except the one export.** Claim data lives only in the worker/main memory and an in-memory renderer session partition. No `localStorage`/`IndexedDB`/disk cache for claim content (§10).

---

## 2. Parser layer

### 2.1 Byte decode (before anything else)
Read the file as a **Buffer**, never as a UTF-8 string.
1. Strip a leading UTF-8/UTF-16 BOM and leading whitespace.
2. Sniff EBCDIC: if the first non-whitespace bytes are `0xC9 0xE2 0xC1` (`ISA` in cp037) transcode via **iconv-lite `cp037`**.
3. Otherwise attempt strict UTF-8; on decode failure fall back to **windows-1252** (latin1). Curly apostrophe `0x92`, accented Latin-1 names must survive.
4. Confirm the stream now starts with ASCII `ISA` (`0x49 0x53 0x41`). If not → friendly error "This is not a valid X12/EDI interchange" (naming the detected type), never a stack trace.

### 2.2 Delimiter recovery (positional — **resolves the #1 recurring blocker**)
The ISA is a fixed 106-byte record. Read delimiters positionally, never hardcode `* ~ : >`:
- element separator = byte index 3 (char after `ISA`)
- repetition separator = ISA11 = byte index 82
- component separator = ISA16 = byte index 104
- segment terminator = byte index 105 (immediately after ISA16)

If the ISA is < 106 bytes or the positional reads are inconsistent → explicit "ISA header unreadable" error. A **non-default-delimiter fixture** (re-emit a sample with `|`/`^`) is a CI gate so the hardcode can never creep back.

### 2.3 Tokenizer (delimiter-complete, 3-level)
- Scan for the ISA-declared segment terminator; `trim()` CR/LF/whitespace off each segment before reading its ID (handles `~\r\n` and one-segment-per-line files).
- **Flush the final buffered segment even with no trailing terminator** (do not require IEA/GE/SE to emit already-parsed segments).
- Decompose uniformly: **segment → element → (repetition array) → component**. Mappers address data as `segment[elem][rep][comp]`, so later-version composite growth only adds trailing indices instead of shifting fields.
- Cheap over/under-split detector: if a known segment's element count is wildly off expectation, emit a per-claim parse warning (delimiter-in-data corruption; X12 has no escape char).

### 2.4 Envelope tree + per-ST type detection (**resolves mixed-batch blockers**)
Model the file strictly: `ISA → GS[] → ST[] → claims`. **Reset all HL/loop state per ST.**
- Transaction type is a **per-ST** property. Resolve from **GS08** (authoritative implementation-convention reference) with **ST03** as fallback; **prefix-match** `005010X222`→P, `X223`→I, `X224`→D (tolerant of `A1`/`A2` addenda suffixes).
- **Version allowlist gate:** known-supported (X222/X223/X224 + addenda) → render. Known-but-unsupported (e.g. 004010, 008010/7030) or missing/contradictory → still list the claim from the generic loop model (patient/claim#/total) but render an **"unsupported X12 version <code> — form rendering disabled"** placeholder page instead of guessing a form.
- One physical file may produce a **mixed** CMS-1500 / UB-04 / dental output interleaved into one PDF. `multi-tran.dat` plus a hand-built **mixed P+I interchange** fixture prove per-ST routing.

### 2.5 Envelope integrity (non-fatal)
Reconcile SE01 segment count, GE01 transaction count, IEA01 group count, and control-number pairs (ISA13/IEA02, GS06/GE02, ST02/SE02). On mismatch → non-dismissable "file may be incomplete/corrupt (expected X, found Y)" banner and mark the batch **unverified** in the exported PDF footer. Close any open ST at EOF (truncation guard). These are **warnings, not parse gates.**

### 2.6 HL hierarchy + patient resolution (**resolves self-claim blocker**)
- Build an explicit **HL tree** from HL01 (id) / HL02 (parent) / HL03 (level 20/22/23) — never by segment order or counters. Flatten claims by walking 2300 → its 2000B subscriber → its 2000A billing provider.
- **Canonical patient rule:** if no 2000C/2010CA child exists, `patient := subscriber (2010BA)` and relationship := self (SBR02/PAT01 = 18). Only when 2000C is present does `patient := 2010CA`, subscriber kept separately for insured-info boxes. Test `-minimal` (self) and `-all-fields` (dependent).

### 2.7 Normalized claim model (discriminated, loss-free)
```
Claim {
  formType: P|I|D|UNSUPPORTED
  billing/rendering/referring/facility providers (by loop 2010AA/2310A/2310B/2310C + NM1 qualifier)
  patient, subscriber
  payers: ordered by SBR01 (P/S/T) → [{ name(2330B), id, priorPaid(2320 AMT*D), CAS[], insured(FL58-65) }]
  diagnoses: ordered HI array (index→A..L), each with qualifier (ABK/ABF) + POA (composite 8th comp)
  serviceLines: (Professional{SV1,dxPointers} | Institutional{SV2,revCode} | Dental{SV3,TOO[],DN1,DN2})[]
        each carrying: DTP dates {qualifier,D8|RD8,value(s)}, charge, units{qualifier,value},
        optional 2410 LIN/CTP (NDC+drug qty), CR1/CR2/CR3, HCP repricing, line-level 2420 overrides, 2430 SVD/CAS
  claimLevel: CLM02, CLM05 composite (facility/classification/frequency), HI code families
  rawSegments kept on every node so unmapped data is never lost
  warnings: [] (per-claim validation)
}
```
- **Diagnosis pointers** stored as raw SV107 ordinals; resolved to letters at render time so A–L ordering stays authoritative. Cap 12 dx / 4 pointers per line (NUCC), flag overflow.
- **Per-claim isolation:** every claim's mapping is wrapped in try/catch. One malformed claim → an error placeholder card/page ("Claim 37: <reason>, segment n"), never an aborted batch or export. A closing summary page lists all failed claims. `837P-validation-issues.edi` is a **golden that must render, not crash.**

---

## 3. Form-mapper layer (spec-derived, one mapper per form type)

Each mapper is driven by an explicit **loop/segment → box** table authored from the authority docs, **not** captured from output (see oracle finding, §7).

### 3.1 CMS-1500 (837P → NUCC v13.0)
- **Provider disambiguation table** keyed by loop + NM1 entity qualifier: 2010AA(85)→box 33 + 33a NPI + box 25 Tax ID (REF*EI/SY) + 33b taxonomy (PRV); 2310A(DN)→17/17b; 2310B(82)→31/24J; 2310C(77)→32/32a. Line-level 2420 overrides claim-level for that 24 row.
- **Box 21 / 24E:** render box 21 from HI (ABK/ABF) with the `0` ICD-10 indicator; build a fixed HI-index(1..12)→letter(A..L) table and translate each SV107 numeric pointer to its letter for 24E.
- **Box 24 double-row grid:** each detail row = unshaded (24A-J values) + shaded upper (supplemental). Map 2410 LIN(N4 11-digit NDC)+CTP unit/qty into the **shaded** band with `N4` qualifier; rendering NPI into 24J shaded/unshaded.
- **NDC normalization** to 5-4-2/11-digit (leading-zero pad by segment); drug qty (CTP04/CTP05 unit F2/GR/ML/UN/ME) kept **separate** from SV line units.
- **Anesthesia:** branch on SV103 UOM qualifier — `MJ`→minutes, `UN`→units for 24G; surface start/stop from DTP*472. Do not print raw minutes as units.
- **COB:** destination payer 2010BB → box 1/11/11a-d; other 2320/2330 payer → box 9/9a-d; 2320 AMT*D prior paid → box 29. Unit test asserts box-9-vs-11 placement per COB fixture.
- **Ambulance/edge data with no native box:** CR1 (distance/reason), 2310E/2310F or 2420G origin/destination N3/N4, HCP repriced amount → rendered in an **addendum band** appended to the form page, not dropped.

### 3.2 UB-04 (837I → NUBC manual)
- **HI code-family mapper** keyed by composite qualifier, each an ordered slot array with its own arity, left-to-right fill:
  - value codes FL39-41 (`BE`, code+amount pairs, 12 slots; amount right-justified/zero-padded to cents, no `$`/comma)
  - occurrence FL31-34 (`BH`, code+D8 date, 8 slots)
  - occurrence span FL35-36 (`BI`, code+RD8 range, 2 slots)
  - condition FL18-28 (`BG`, code only, 11 slots)
- **Type of Bill FL04 (derived):** `0` + facility(CLM05-01) + classification(CLM05-02) + frequency(CLM05-03). Frequency 7=replacement/8=void surfaced in the **claim-list row**. Validate against commercial-replacement fixture.
- **Diagnoses/procedures FL66-81:** ICD indicator FL66; principal + up to 17 other dx (FL67/67A-Q) each with **POA from the HI composite's final component**; admitting dx FL69; procedures + dates FL74/74a-e; provider NPIs FL76-79.
- **COB payer rows FL50-65:** sort payer loops by SBR01 (P→A, S→B, T→C); FL54 prior-payer paid from 2320 AMT/adjudication; FL55 est. due; FL58-65 insured aligned to the same A/B/C row index.

### 3.3 Dental (837D) — self-authored ADA-2024 facsimile (user decision 2026-07-24)
- **Render a faithful self-drawn facsimile of the 2024 ADA Dental Claim Form (J43024) layout**, same treatment as CMS-1500/UB-04: author our own black coordinate grid matching the standard ADA field positions (fields 1–58, Record-of-Services grid 24–31), using the on-hand sample (`Downloads\misc\2024_SampleADAClaimForm_2024Jan.pdf`) + the 837D IG as the layout reference. We do **not** overlay or redistribute the ADA's copyrighted form file, and we do **not** ship the watermarked sample. Per Niall's explicit direction: work with the forms on hand, do not source clean/licensed blank forms.
- **Standing IP note (not a build blocker):** the ADA form *design/trade dress* remains the ADA's; a self-drawn functional facsimile is the pragmatic path, but before wide/external distribution this is a judgment call worth a quick ADA-license review. Niall = decision owner. Does not gate the milestone. (A generic Brotherhood-branded tabular summary remains available as a fallback layout if the facsimile is ever deemed too risky.)
- Parser first-class captures dental segments: **TOO** (repeating, both 2300 and 2400 levels; TOO01 qualifier JP/JO, TOO02 tooth, TOO03 surface composite M/O/D/B/L/I/F), **DN1** (ortho months), **DN2** (tooth status/missing), area of oral cavity, diagnosis + pointers.
- **CDT D-codes are raw pass-through text only.** No embedded CDT code→description dictionary (CDT *code descriptions* are separately ADA-licensed — a distinct issue from the form layout, sidestepped by never printing a description column).
- Produce an explicit **837D element → field mapping table** (~58 ADA data fields: ortho, prosthesis replacement + prior placement date, missing-teeth grid, predetermination vs claim, oral cavity, enclosures, diagnosis pointers, treating-vs-billing dentist) reviewed before building the renderer.

---

## 4. PDF render / coordinate system

### 4.1 Templates
- **Self-author** each form as a clean black coordinate grid at exactly **Letter 612×792 pt** (verify `getSize()`; fail loud otherwise). This sidesteps NUCC/NUBC/red-drop-out **copyright and registration-drift** entirely and is correct for a non-submission viewer.
- Freeze each template file, **pin by SHA-256** in the coordinate-map manifest with form version; a hash mismatch fails CI loudly.

### 4.2 Coordinate mapping (**resolves origin/units blockers**)
- **One coordinate map per form, authored in PDF points from a defined top-left origin, stored as versioned JSON** (a reviewable diff, not code). Preview derives from the *same* map scaled by `previewDPI/72` — never a second coordinate set.
- Mapping helper at template load: read `getSize()`, `getMediaBox()`/`getCropBox()`, and `/Rotate`; translate so the visible corner is (0,0); assert 612×792. Convert top-left→pdf-lib bottom-left: `y_pdf = pageHeight - y_top - fontAscent`, offset by CropBox origin. If `/Rotate` ≠ 0, normalize by baking rotation into a fresh page. Because templates are self-authored these are all zero/identity, but the helper guards against it regardless.
- **Calibration mode (Milestone 0):** overlay a 1/8-inch registration grid + corner ticks, render an "all fields at max length" synthetic claim, commit a golden PNG per form, pixel-diff in CI.

### 4.3 Fonts & field formatting
- Embed a **Unicode TTF via @pdf-lib/fontkit with `{subset:true}`** (bundled DejaVu/Noto + the Brotherhood serif for headings) — **never** a StandardFont (WinAnsi throws on accented NM1 names and aborts the whole batch). Confirm the serif's license permits embedding/subsetting in a distributed app. Embed once at document level.
- **Comb/segmented fields** (MM|DD|YYYY dates, SSN/EIN/NPI, dollar|cents columns) → a first-class `combField` schema type: per-cell x-array (or start-x + pitch), drawn with an embedded **monospace** face; dollar amounts **right-aligned** via `font.widthOfTextAtSize` with cents in their own column, sign preserved.
- **Overflow policy stored per field** (max width in the map): measure → shrink to a min font floor (~6pt) → truncate with a visible **ellipsis** so clipped data is obvious. Multi-line fields (CMS-1500 box 19, UB-04 FL80, two-line N3 addresses) use a word-wrap helper (greedy pack + mid-word hard-break for long account numbers) that clips vertically with an ellipsis on the last visible line.
- **Name composition** from present NM1 elements only (no stray `SMITH, JOHN , `).
- On any residual glyph/encoding failure: transliterate/`?`-substitute the offending run + per-claim warning; **one bad claim never nukes the multi-page PDF.**

### 4.4 Intra-claim pagination (**resolves silent line-loss blocker**)
Unit of layout = **form page, not claim**. `totalPages = Σ ceil(serviceLines / rowsPerForm)` (CMS-1500 = 6, UB-04 = 22, with line 23 reserved for UB-04 revenue `0001` total on every page). Each continuation page repeats header/patient/provider FLs, carries per-page subtotals + correct final-page totals (box 28/29/30; UB-04 total line), and stamps "Page x of y". Fixtures with >6-line 837P and >22-line 837I assert rendered line count == parsed 2400 count.

### 4.5 Batch export performance (**resolves size/memory blockers**)
- Embed the template **exactly once** with `embedPage()` → a single reusable Form XObject; `page.drawPage(embedded)` + `drawText` per page. **Never** `copyPages`/re-embed inside the per-claim loop. Verify output object count stays flat as claim count grows (500-claim fixture; template bytes counted once).
- Run generation in the worker; **stream/segment** large batches; write to a **temp file inside an app-controlled dir and atomically rename** to the user's chosen path on completion (a killed export never leaves a half-written PDF). Memory-ceiling test at 1000 claims. Batch-scale testing pulled forward to Milestone 2, not Milestone 5.
- Renderer receives only a **lightweight list projection** (patient, claim#, provider, total, page index) via IPC; fetches a single claim's detail on demand; renders **one** preview at a time. Never structured-clone the whole object graph.

### 4.6 Deterministic ordering & metadata
- **Deterministic claim order = source segment order** (never map/hash iteration); asserted over `multi-tran`.
- Scrub the PDF Info dict (neutral Producer/Creator, fixed CreationDate/ModDate) — needed for byte-reproducible goldens **and** PHI hygiene.

---

## 5. Electron security & IPC

- **BrowserWindow webPreferences:** `contextIsolation:true, nodeIntegration:false, sandbox:true, nodeIntegrationInSubFrames:false, webSecurity:true`. DevTools disabled in production; never `--remote-debugging-port`.
- **Strict CSP** via meta tag **and** `session.onHeadersReceived`: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- **All claim-derived strings rendered via `textContent`/DOM APIs — never `innerHTML` or template-string HTML.** (Even with the pdf.js-canvas preview, claim text in list rows and warning panels is attacker-influenced.)
- `webContents.setWindowOpenHandler(()=>({action:'deny'}))`; `will-navigate`/`will-redirect` cancel any http/https/mailto.
- **Frozen contextBridge preload API only** — `openBatch()`, `getClaimList()`, `getClaim(i)`, `exportPdf(indices)`. No generic `ipcRenderer` passthrough. Every IPC arg is type/shape-validated in main; renderer input treated as untrusted.
- **All fs + dialogs in main.** Main returns dialog-chosen paths; the renderer never supplies a filesystem path. Any claim-derived default filename is sanitized (strip path separators, cap length) to block path traversal/overwrite.

---

## 6. Offline / zero-network enforcement (proof, not claim)

- **Runtime deny-all guard (Milestone-1 gate):** `session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']}, (d,cb)=>cb({cancel:true}))`, allowing only `file:`, `devtools:`, `blob:`, `data:`. Log every cancelled request.
- Disable Chromium background traffic: `app.commandLine.appendSwitch('disable-features','Translate,ComponentUpdate,OptimizationHints,NetworkTimeServiceQuerying')`; disable DNS prefetch; `webPreferences.spellcheck=false` + `session.setSpellCheckerDictionaryDownloadURL('')` (stops the gvt1.com dictionary fetch); **do not** start `crashReporter` or `autoUpdater`.
- **CI release check:** grep the packaged asar + unpacked resources for `electron-updater`, `autoUpdater`, `update.electronjs.org`, and any feed URL; fail the release if present. Automated test boots the packaged app behind a loopback-only firewall / 500-ing proxy and asserts the block-log contains only the guard's own cancellations. This is the single artifact that turns "offline" into proof.

---

## 7. Test strategy (fixtures = the synthetic ISA15=T `.dat`/`.edi` set)

**Layered, deterministic, spec-anchored:**
1. **Byte-reproducibility guard (must pass first):** render the same claim twice → identical bytes (fixed CreationDate/ModDate, fixed embedded font file in *both* app and harness, normalized object ordering). Goldens are untrustworthy until this passes.
2. **Placement manifest golden (primary mapping-regression layer):** the renderer emits a serializable `{fieldId, boxName, x, y, text, fontSize}` manifest **before drawing**. Snapshot that JSON — deterministic, human-diffable, pinpoints the exact field. Localizes a one-box regression instead of failing a whole-page snapshot.
3. **Independent correctness oracle:** for `-all-fields.dat` (P/I/D), **hand-author expected-value tables from NUCC v13.0 / NUBC** ("known input value X must land in named box Y"). Drive initial mapping correctness from this spec table, **not** captured output (capture-goldens are regression-only, and would enshrine day-one bugs like billing NPI in 24J).
4. **Raster smoke (thin top layer):** pinned single rasterizer version + single OS, per-pixel tolerance + max-diff-pixel budget (never exact equality).
5. **Overflow fixtures:** synthesized >6-line 837P and >22-line 837I (mutate anesthesia/wheelchair `.dat`) assert total page count + line 7 renders in row 1 of page 2 with repeated header; **no line loss**.
6. **Robustness/negative fixtures:** non-standard-delimiter copy (`|`/`^`), `\r\n`-terminated + no-trailing-terminator, BOM, windows-1252 apostrophe + accented name, EBCDIC cp037, dropped required 2010BB loop, empty CLM, mid-file truncation, non-X12 (PDF/ZIP/empty). Each asserts a handled warning/error/partial render — never an exception or blank screen.
7. **Envelope/COB semantics:** mixed P+I interchange proves per-ST routing; COB fixtures assert box-9-vs-11 / FL50 A-B-C ordering; multi-tran asserts deterministic page order.
8. **837D coordinate-only goldens** (assert placement JSON against blank-canvas coordinates; **no ADA artwork committed** to the repo — avoids a licensing violation in the test fixtures themselves).
9. **Packaged-build smoke:** render one CMS-1500 from the *packaged* app and diff against a golden PDF so a missing bundled template/font fails CI, not the user.
10. **Data reconciliation check** surfaced in UI: Σ service-line charges vs CLM02 total; NPI length/checksum; numeric-charge / date-format validation → non-blocking "N data warnings on this claim" expander (defines the `837P-validation-issues.edi` acceptance behavior).

---

## 8. Packaging & distribution (Windows)

- **Unsigned for v1 (user decision 2026-07-24).** No code-signing cert initially; users click through a Windows SmartScreen "unknown publisher" warning on install. Acceptable for the tiny internal team. Document the exact click-through ("More info → Run anyway") in operator guidance. **Keep the build signing-ready** — electron-builder `win.signtoolOptions` wired but empty — so dropping in an internal-PKI (GPO Trusted Publishers) or EV cert later is a config change, not a rebuild. Revisit before any wider rollout. Not a CI gate in v1.
- **Per-user install:** `perMachine:false`, into `%LOCALAPPDATA%\Programs` — no admin/UAC. All mutable data (coordinate maps, templates, fonts, exports, logs) under `app.getPath('userData')` (config only) / user-chosen paths — never inside the read-only install dir.
- **Templates + fonts in `build.extraResources`** (unpacked, resolved via `process.resourcesPath`), not asar+`__dirname`. Data (template PDFs + coordinate JSON + form-version metadata) is **versioned separately** from the binary and drop-in replaceable from userData, so a coordinate/NUCC-revision fix doesn't require a full signed reinstall (matches "manual refresh stays").
- **No electron-updater**, no `publish:` config. Updates = manual reinstall.
- **File-open flow, not file association:** lead with File → Open filtered to `*.dat;*.edi;*.txt`, plus drag-and-drop onto the window and a second-instance/`open-file` argv handler. `.dat` association is opt-in-checkbox polish only (Windows blocks silent default-app takeover; `.dat` is widely claimed).
- **Pin Electron to a patched release** with a documented manual CVE-pull cadence (no auto-update).

---

## 9. Compliance / PHI hygiene

- **Non-persistence architecture (not "secure delete").** Claim data loads only into worker/main memory + an **in-memory renderer session partition** (no `persist:` prefix). No `localStorage`/`IndexedDB`/HTTP cache for claim content; `session.setCacheEnabled(false)` + `clearCache`. Automated test greps the userData tree for a known synthetic SSN after a load/export cycle and **fails if found.**
- **Do not advertise secure delete** (SSD wear-leveling, NTFS journaling, VSS, pagefile make it a false assurance). Documented explicitly.
- **No temp PHI intermediates** beyond the app-controlled export temp file (atomic-renamed, §4.5). **No `app.addRecentDocument`**; suppress recent-file tracking in dialogs where possible.
- **Exported PDF:** scrub Info dict; UI notice that the export is **unencrypted PHI, store on BitLocker volumes only** (user decision 2026-07-24: BitLocker guidance only, **no in-app/qpdf encryption in v1**). Offer a **per-claim export** option to limit blast radius vs one all-patient file. (qpdf password-encryption remains an easy future add-on if confidentiality-at-rest is ever required — pdf-lib cannot encrypt — but is out of v1 scope.)
- **OneDrive/sync guard:** default the export dialog to a non-synced location; warn if the chosen path resolves under a known OneDrive/Dropbox/Google Drive root (env vars / known-folder GUIDs). Document that "offline" covers the app's own network behavior, not OS sync/indexing/AV.
- **No crashReporter upload.** In all error paths log **segment IDs and positions only** — never element values; redact/mask NM1/DMG/REF/SBR content before it reaches a log, toast, or thrown Error. Lint/test asserts no raw claim element is passed to console/logger.
- **Clear in-memory claim state on window close** + explicit "Close/Clear" action. Document machine-hardening assumptions (dedicated account, BitLocker, screen lock) the app can't enforce.

---

## 10. Milestones & definition-of-done

**M0 — Walking skeleton + calibration + packaging spine (de-risks the real unknown first).**
DoD: one hardcoded claim's fields overlaid onto the self-authored CMS-1500 grid → single PDF opened via pdf.js canvas (preview == export bytes); coordinate JSON + calibration grid harness in place; template SHA pinned; network kill-switch + block-log live and green; a **signed, clean-VM-verified installer** produced. No parser, no list. Proves the overlay→export→preview→package spine end to end.

**M1 — Parser + claim list + robustness contract.**
DoD: opens every provided fixture including `multi-tran.dat`, a mixed P+I interchange, and `837P-validation-issues.edi` **without crashing**; lists every claim (patient/claim#/provider/total, replacement/void flagged) across all GS/ST; per-ST type detection + version allowlist gate; positional delimiter recovery + non-default-delimiter fixture passing; encoding matrix (BOM/1252/EBCDIC) passing; envelope-integrity warnings surfaced; per-claim error isolation proven (one bad claim → placeholder, batch survives); batch-scale (500/1000 claims) memory + object-count tests. Failure contract (skip-and-flag, non-fatal) decided here.

**M2 — CMS-1500 render + PDF (837P), full mapping.**
DoD: spec-derived oracle table for `837P-all-fields` all green (box 21 letters + ICD indicator, 24E pointer translation, 24 shaded NDC + 24J, provider 17/25/31/32/33 disambiguation, COB 9/11/29, anesthesia MJ/UN, comb-field alignment); **intra-claim pagination** (>6 lines) with continuation totals; ambulance/HCP addendum band; placement-manifest goldens + raster smoke; batch export of a 500-claim mixed file within memory ceiling.

**M3 — UB-04 render + PDF (837I).**
DoD: HI value/occurrence/span/condition mappers by qualifier with correct arity + cents formatting; TOB FL04 derivation (replacement/void validated); FL66-81 dx/POA/procedures; COB FL50-65 A/B/C ordering; **22-line pagination with line-23 `0001` total on every page + continuation** (treated as a distinct unproven risk with its own high-line-count fixture — M2 does not prove it). Self-authored UB-04 grid licensing-clean (no NUBC artwork/text embedded).

**M4 — Dental (837D) self-authored ADA-2024 facsimile.**
DoD: TOO/DN1/DN2 + oral-cavity + dx-pointer extraction (incl. multi-TOO line); self-drawn ADA-2024 (J43024) facsimile grid — fields 1–58 + Record-of-Services grid 24–31 — matching the on-hand sample layout; CDT D-codes raw pass-through (no description table); coordinate-only goldens; full 837D field-mapping table reviewed. Standing ADA-form IP note carried in the risk register (not a blocker); generic tabular summary retained as an available fallback layout.

**M5 — Polish, hardening, release.**
DoD: progress/cancel + atomic write; PHI-at-rest grep test green; OneDrive/export warnings; per-claim export; **BitLocker-only storage notice (no qpdf in v1)**; offline-proof CI (firewall/proxy + updater-grep) green; **unsigned per-user installer** with SmartScreen click-through documented (signing wired but empty); **export is visual-fidelity, not PDF-UA tagged — "not fully screen-reader accessible" caveat in About**; drop-in template/coordinate replacement path documented; operator guidance (storage, SmartScreen install, actual-size printing) written.

---

## 11. Resolved risk register
- **CMS-1500/UB-04 artwork licensing** → sidestepped entirely by **self-authored black coordinate grids** (public-domain government forms; nothing redistributed).
- **ADA dental form (residual, accepted)** → all three forms are self-drawn facsimiles, not redistributed artwork; the ADA form *design* is still the ADA's, so the self-drawn ADA-2024 facsimile carries a **standing IP note**: fine for internal use per Niall's decision, worth a quick ADA-license review before wide/external distribution. CDT *code descriptions* never bundled (separate CDT license) — sidestepped by printing codes only, no description column.
- **"Pixel-exact" ambiguity** → redefined as point-exact PDF space + scaled byte-identical pdf.js preview (single coordinate map, single render engine).
- **Preview ≠ export drift** → eliminated (preview renders the exact export bytes).
- **Batch heterogeneity / mixed types** → per-ST detection + interleaved single PDF.
- **Silent line loss** → mandatory intra-claim pagination with no-line-loss tests.
- **Offline claim vs proof** → runtime kill-switch + firewall/proxy CI test + updater grep.
- **Golden-file rot / captured bugs** → spec-derived oracle + placement-manifest + byte-reproducibility guard.
- **SmartScreen / admin install** → signed (EV or GPO-trusted) per-user installer verified in CI.

