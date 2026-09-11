# Claim Viewer

Offline, single-machine Windows desktop app (Electron) that opens **one claim at a time** — a
clearinghouse **JSON** claim (primary) or an **X12 837** file (secondary) — renders it as a faithful
facsimile of its paper form (**CMS-1500** / UB-04 / ADA dental), and exports that form to **PDF**.
View-only. No pricing, no network.

See `docs/` for the plan:
- `PLAN_REVISION_v2_JSON.md` — current build plan (JSON input, single-claim). **Start here.**
- `UI_REQUIREMENTS_v2_single_claim.md` — current UI/design spec (design handoff).
- `BUILD_PLAN.md`, `UI_REQUIREMENTS.md` — earlier hardened X12/batch versions (historical).

## Status
- **Core engine (design-independent): working + tested.**
  - `src/model/claim.ts` — normalized, source-agnostic claim model.
  - `src/sources/claimSource.ts` — `ClaimSource` interface (JSON now, X12 later).
  - `src/sources/json/jsonClaimSource.ts` — flat clearinghouse JSON → model + non-blocking validation
    (charge/total reconciliation, dangling diagnosis pointers, NPI Luhn, diagnosis overflow).
  - Verified against the 5 real sample claims (locally) and a synthetic fixture (`test/`).
- **Next:** CMS-1500 self-authored template + coordinate map → pdf-lib render → pdf.js preview;
  Electron shell; then the UI (pending the design), then the X12 837 source (M3) and UB-04/dental (M4).

## Develop
```
npm install
npm run typecheck
npm test
```

## Install / deploy

`npm run build:dist` produces **`release/837 Claim Viewer Setup <version>.exe`** — an unsigned,
one-click NSIS installer.

- Installs **per-user** to `%LOCALAPPDATA%\Programs\claim-viewer`. **No admin rights, no UAC
  prompt**, nothing written to `Program Files` or to machine-wide registry keys.
- Creates a Start Menu and Desktop shortcut, and launches the app when it finishes.
- **Updating:** run the newer installer; it replaces the install in place. `session.json` and the
  recent-files list are deliberately preserved (`deleteAppDataOnUninstall: false`), so open tabs
  and recents survive an upgrade.
- **Uninstalling:** Settings → Apps, or the bundled `Uninstall 837 Claim Viewer.exe`.
- Still **unsigned** — SmartScreen will show "Windows protected your PC" the first time. Choose
  *More info → Run anyway*. Signing is a separate decision (it needs a purchased certificate).
- No auto-update, by design: there is no `electron-updater` dependency and no `build.publish`
  config, and `test/no-updater.test.ts` fails the build if either appears. The app's network
  kill-switch would block an update check anyway.

### Why an installer rather than a portable .exe

The app previously shipped as a single portable `.exe`. That target is a self-extracting archive:
it decompressed **366 MB** into `%TEMP%` on *every* launch, and electron-builder's `portable.nsi`
does `RMDir /r $INSTDIR` both before extracting and after exit, so the work could never be cached.

Measured on a dev machine:

| | Time to window |
|---|---|
| Portable `.exe` | **7.5 – 9.9 s**, every launch |
| Installed | **0.99 s**, and zero `%TEMP%` churn |

The portable target also cannot show progress while it works: with no splash image its NSIS script
runs `SetSilent silent`, and `portable.nsi` is read unconditionally from electron-builder's own
templates, so a custom script that could draw a progress bar is not reachable through config.
(`portable.splashImage` *is* accepted and passed to `makensis` as `-DSPLASH_IMAGE`, but the
`BgImage` plugin it relies on silently fails to draw — verified by sampling the screen across a
full cold start.) The installer shows its progress bar **once**, at install time, instead of a
blank 7-second wait on every launch.

## PHI / data policy
Real claim files are **PHI** and must never be committed. Only **synthetic** fixtures live in
`test/fixtures/`. `.gitignore` also excludes `/private-samples/` and `*.phi.json`.

Claim **content** is never written to disk by this app — every form preview and PDF render
happens fully in memory (`test/phi-at-rest.test.ts`), and closing a tab drops its parsed claim
from main-process memory immediately. The exceptions are all explicit, user-directed **exports**:
a single claim's PDF, a batch of PDFs (one per claim, plus an optional combined PDF merging all of
them) written to a folder the user picked, or a structured **CSV/JSON** export of the normalized
claim data written to a path the user picked — see "Export suite" below for the CSV/JSON policy.

As of the multi-file tabs build (`docs/TABS_BUILD_PLAN.md` §2e — an approved, deliberate policy
change), the app **does** persist a small amount of non-content state to `session.json` under
`app.getPath('userData')` (`%AppData%\837 Claim Viewer` on Windows), so it can restore your open
tabs on the next launch:
- The **file paths** (and display names) of currently open tabs, their left-to-right order, and
  which one was active.
- A capped list of the **10 most recently opened** file paths, surfaced in the File menu.

A file or folder name can be PHI-adjacent (e.g. it names a member), which is the accepted
trade-off Niall signed off on. Claim content itself is never part of this file — see
`src/app/persistence/sessionStore.ts` (the only module that writes it) and
`test/persisted-artifacts.test.ts` (which asserts no PHI canary ever lands in it). Use
**File → Forget open tabs & recent files…** at any time to clear both lists; the app's own About
screen (Help → About Claim Viewer) states this same policy and shows the running build's
version/date.

### Editable fields (deliberate exception — claim content is now written to disk)

As of the editable-fields feature (`docs/EDITABLE_FIELDS_DESIGN.md` — an explicit, Niall-approved
crossing of this app's own "view-only" boundary, done as safely as the team could make it), the
app can, at the user's explicit request, correct a bounded set of fields (patient DOB/phone/
account number, insured member ID/group, billing/rendering NPI and tax ID, and per-line
procedure code/modifiers/units/charge/diagnosis code) and remember those corrections. Two things
change as a direct result:

- **The original source file you opened is never touched.** It is opened read-only, always; no
  code path in this app ever writes to it.
- **Corrected values ARE written to disk** — the one exception, alongside the exported PDF, to
  "claim content is never written to disk." They live in a separate file, `corrected-claims.json`,
  in the same `userData` folder as `session.json`, keyed by the source file's path and guarded by
  a hash of that file's bytes: if the source file changes after an edit was saved, the app detects
  the mismatch and asks before doing anything with the old edits — it never silently reapplies (or
  silently drops) them. See `src/app/persistence/correctedClaimStore.ts` and
  `test/persisted-artifacts.test.ts`, which — same as `session.json` — asserts no PHI canary ever
  lands in it beyond the specific value you chose to type in.
- Every edited value stays visibly marked as edited (an "Edited" badge, with the original value
  still reachable on hover) everywhere it's shown, and any exported PDF built from a claim with
  active edits carries a mandatory, unremovable "EDITED" stamp alongside the existing
  "not an official form" disclaimer — an edited export can never be mistaken for an unedited one.
- Data-integrity warnings and the reconciliation panel are **always** computed from the originally
  parsed claim, never from your edits — correcting a field can never make a warning quietly
  disappear.

This is a narrower, more deliberate version of the "structured export"/"per-line notes" write
capabilities already anticipated (and deferred) elsewhere in this app's roadmap — see
`docs/EDITABLE_FIELDS_DESIGN.md` for the full design and what's still out of scope.

### Export suite (Build 4 — batch PDF, combined PDF, CSV, JSON)

The export dialog offers a **scope** (this claim, or all claims in the open file) and a
**format** (PDF, CSV, or JSON):

- **Batch PDF export**: renders every claim in the open file to its own PDF in a folder you pick,
  with a determinate progress bar and a Cancel button; one bad claim is reported individually and
  never aborts the rest of the batch. An optional checkbox additionally merges every successfully
  rendered claim's pages into one combined PDF, alongside — never instead of — the one-file-per-
  claim output.
- **Structured CSV/JSON export**: writes the normalized claim model (claim/service-line
  identifiers, codes, amounts, dates, and provider info) to a file you pick. **Patient identifiers
  (name, date of birth, address, full member ID) are excluded by default** — a clearly labeled
  "Include patient identifiers" checkbox is the explicit opt-in, and it is never pre-checked or
  remembered from a previous export. Every claim/row also carries an explicit EDITED indicator
  whenever any of its fields have an active correction (see above), so an edited claim's exported
  data — in every format, not just PDF — can never be mistaken for the claim's original values.

Every export in this suite writes to a location **you** choose (a save dialog or folder picker) —
none of it uses the `userData` persistence mechanism, and the same unencrypted-PHI/BitLocker
notice shown for a single-claim PDF export applies here too.

### X12 837 export (Build 5)

The export dialog's format choice also includes **X12 837 (EDI)** — a genuine X12 5010
implementation-guide-shaped 837P/837I/837D serializer (`src/sources/x12/x12ClaimSerializer.ts`),
scope-only (no identifiers opt-in — X12 is always a faithful, fully-identified EDI reproduction,
arguably the single most sensitive export format this app produces since it's the actual
submission wire format). It writes a `.837` file to a location you choose, same as every other
export here — **this is still just a file-format export**, exactly like the PDF/CSV/JSON paths:
the app has no network code and no payer connection, and this build adds none. Nothing in this
repo submits a claim anywhere.

Every export is validated by round-tripping it back through this app's own X12 parser
(`test/x12ClaimSerializer.test.ts`) and comparing the result to the claim that was exported — see
`docs/BUILD_LOG.md`'s Build 5 section for the full design writeup, including the EDI-native
"EDITED" equivalent (a `K3` free-text segment, since X12 has no visual-watermark concept) and the
control-number generation scheme.
