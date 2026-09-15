# Deployment guide — IT-managed / scripted rollout

This app ships as a single NSIS installer built by `npm run build:dist`
(`release/837 Claim Viewer Setup <version>.exe`). It is **unsigned** (see
"Code signing" below) and makes **no network call of any kind**, including no
auto-update check — see `test/no-updater.test.ts` and
`docs/CLAUDE_CODE_NEXT_SESSION.md` decision 4. This doc covers the installer's
command-line switches for an IT-managed or scripted (e.g. Group Policy /
SCCM/Intune) rollout, added in Build 7 — Installation & deployment
enhancements.

## Installer type

As of Build 7 the installer is electron-builder's **assisted** NSIS installer
(`oneClick: false` in `package.json`'s `build.nsis`), not the earlier
one-click installer. Interactively it now shows the standard multi-page
wizard: welcome page, an install-mode page (per-user vs. per-machine, with
per-user selected by default — see "Why per-user by default" below), an
install-directory page (the user may change the default location), then
install/finish. See `docs/BUILD_LOG.md`'s Build 7 section for why this
changed from the prior `oneClick: true` config and what was verified.

## Silent / unattended install

All switches below are handled by electron-builder's generated NSIS script
(`node_modules/app-builder-lib/templates/nsis/multiUser.nsh` /
`assistedInstaller.nsh` — read directly to confirm the exact behavior, since
that's what actually ships): flags come first, `/D=` (if present) always
comes **last** and is never quoted.

```
"837 Claim Viewer Setup 0.0.1.exe" /S
```
Silent install, no dialogs of any kind. Defaults to a **per-user** install
(no admin rights required, no UAC prompt) into
`%LocalAppData%\Programs\837 Claim Viewer` — this is
`selectPerMachineByDefault: false` in `package.json`'s `build.nsis` taking
effect. Exit code is 0 on success.

```
"837 Claim Viewer Setup 0.0.1.exe" /S /AllUsers
```
Silent, **per-machine** install (into `%ProgramFiles%\837 Claim Viewer` by
the OS's usual convention for an all-users install) — requires the installer
process itself to already be running elevated (e.g. launched from an admin
PowerShell/CMD session, or as SYSTEM via Group Policy/SCCM/Intune). A silent
run does **not** pop a UAC prompt on its own — see "What to expect" below for
the consequence of running `/S /AllUsers` from a non-elevated shell.

```
"837 Claim Viewer Setup 0.0.1.exe" /S /CurrentUser
```
Silent, explicit per-user install (same as plain `/S` given the
`selectPerMachineByDefault: false` default above; spelled out for a rollout
script that wants to be explicit rather than rely on the installer's
default).

```
"837 Claim Viewer Setup 0.0.1.exe" /S /D=C:\Apps\837ClaimViewer
```
Silent install to a custom directory. `/D=` must be the **last** argument on
the command line and must **not** be quoted, even if the path contains
spaces (an NSIS requirement, not specific to this app). Combine with
`/AllUsers`/`/CurrentUser` as needed, e.g.:
```
"837 Claim Viewer Setup 0.0.1.exe" /S /AllUsers /D=C:\Apps\837ClaimViewer
```

### What to expect from a silent install
- No windows, dialogs, license prompts, or progress UI of any kind.
- Desktop and Start Menu shortcuts are still created
  (`createDesktopShortcut`/`createStartMenuShortcut` stay `true` regardless
  of silent/interactive).
- `deleteAppDataOnUninstall: false` is unaffected by silent mode — an
  existing install's saved session, recent-files list, and any
  editable-fields "corrected claim" artifacts under that user's `userData`
  survive a silent reinstall/upgrade exactly as they would an interactive
  one.
- `runAfterFinish: true` still applies to an interactive run; a genuinely
  silent (`/S`) run does not launch the app afterward.
- Running `/S /AllUsers` from a **non-elevated** process: the installer
  cannot silently self-elevate (no UAC prompt appears in silent mode), so the
  per-machine install will fail. Elevate the calling process/script instead
  (run the deployment tool itself, or the wrapping script, as an
  administrator) — don't expect the installer to prompt for you.
- The installer is unsigned (see below), so **Windows SmartScreen may still
  intervene on first run of the installer itself** if it isn't otherwise
  trusted/allow-listed on the target machine (e.g. via an AppLocker/WDAC rule
  or a SmartScreen exclusion) — this is unrelated to the `/S` switch and
  applies to any unattended deployment of this unsigned installer. A
  scripted/GPO rollout that invokes the installer directly (rather than via
  interactive double-click) is not itself blocked by SmartScreen, which only
  intervenes on an interactive Explorer launch — but verify this on your own
  target image before a production rollout.

### Uninstall
The generated uninstaller (`Uninstall 837 Claim Viewer.exe`, registered in
Add/Remove Programs) accepts the same `/S` switch for a silent uninstall.
`deleteAppDataOnUninstall: false` means uninstalling — silently or
interactively — never deletes the per-user `userData` directory (session,
recent files, corrected-claim artifacts, audit log); only a person explicitly
deleting that folder does.

## Honest verification status (read before relying on this in production)

**Confirmed in this environment:**
- The `package.json` NSIS configuration is syntactically valid and
  electron-builder (`npm run build:dist`) builds a real installer `.exe`
  from it without error.
- The switches documented above (`/S`, `/AllUsers`, `/CurrentUser`, `/D=`)
  are exactly what electron-builder's own NSIS templates
  (`node_modules/app-builder-lib/templates/nsis/multiUser.nsh` /
  `assistedInstaller.nsh`) implement for an assisted (`oneClick: false`)
  installer — read directly, not assumed from external documentation.
- The per-user default install path
  (`%LocalAppData%\Programs\837 Claim Viewer`) and the per-machine
  requirement for elevation are both traced directly from that same
  generated-script logic.

**NOT verified in this environment, because it requires a real interactive
Windows session driving the installer UI (unavailable in this harness):**
- That a real `/S` run against a clean machine produces genuinely zero
  dialogs end to end (only the NSIS script logic was read, not exercised
  live).
- That `/S /AllUsers` run from an elevated shell actually completes a
  per-machine install without prompting.
- The exact SmartScreen behavior for a scripted vs. interactive launch on a
  representative target image.

**A human should run an actual `/S` install (and, separately, a `/S
/AllUsers` install from an elevated prompt) against a clean or disposable
Windows machine/VM before this is relied on for a real rollout**, and correct
this document if actual behavior differs from what's documented above.

## Code signing (parked, not built)
This installer remains unsigned. Code signing needs a purchased
code-signing certificate and entity verification — a cost/procurement
decision for the project owner, not something built unprompted in this
session. Self-signing was deliberately not attempted as a substitute; an
installer signed with a self-issued certificate is not trusted by Windows
SmartScreen/AppLocker any more than an unsigned one is, so it would not
actually solve the problem a real certificate solves.
