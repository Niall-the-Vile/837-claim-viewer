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
from main-process memory immediately. The one exception is an explicit, user-directed **export**:
the app writes the rendered PDF only to a path the user picked in a save dialog.

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
