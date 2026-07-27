# Claim Viewer — Conformance Audit

_6-dimension adversarial audit, 2026-07-24. 21 confirmed of 23 verified findings._

## Overall
The app is functionally close to spec but not yet shippable as configured. No blocking defects were confirmed, but seven major issues span parse correctness, export integrity, accessibility, and packaging — most consequentially: packaging emits only an unpacked dir (no installer/portable exe, contradicting the build plan's own DoD), the JSON source fabricates a phantom service-facility from a "0" NPI sentinel, CMS-1500 box 33 drops the billing provider's city/state/ZIP (a payment-critical NUCC field), and export can serialize a different claim than the one the user reviewed because claim-stepping isn't blocked while the export overlay is open. Three documented accessibility requirements are actively violated (inspector removed from the a11y tree when collapsed, no modal focus management, F6 region-cycling advertised but unimplemented). Fourteen minor/nit items are real but low-impact, and one durability item (no fsync in writeFileAtomic) is a documented, intentional out-of-scope limitation. Nothing here indicates data corruption of correctly-populated fields, but the facility-sentinel and box-33 defects mean the rendered form can misrepresent claim data, which for a PHI-sensitive claim viewer warrants fixing before deployment.

## Confirmed — BLOCKING (0)

## Confirmed — MAJOR (7)

1. Phantom service-facility from '0' NPI sentinel: jsonClaimSource.ts hasAny() (:129-131) treats facility_npi:'0' as present because s() (:33-37) only normalizes the empty-date sentinel, so claim.facility becomes a non-null object with blank name/address and NPI '0'; golden cms1500-synthetic-json.json:824-852 renders box 32 populated where the feed signalled no facility. The same file exempts npi==='0' for rendering provider (:304), proving the convention is known but not applied to facility/referring presence detection.

2. CMS-1500 box 33 (Billing Provider) drops the city/state/ZIP line: renderCms1500.ts:808-817 emits only name / street(+phone) / NPI(+taxonomy) and never calls cityStateZipLine, unlike the facility case (:798-806). Boxes 32 and 33 share height (layout.ts:331-332), so it is a mapping omission, not a space limit; the approved design shows a 4-line box 33. Payment-critical NUCC field.

3. Export can serialize a different claim than reviewed: PageUp/PageDown -> stepClaim (src/renderer/main.ts:1075-1084, 732-742) fires while the export overlay is open with no anyOverlayOpen() guard; loadCurrentClaim (:692-729) never re-renders the manifest, and confirmExport (:834) exports state.currentIndex. On a multi-claim 837 file, opening export on claim A then paging advances to claim B while the manifest still shows A, so B is exported with B's default filename.

4. F6 'cycle regions' advertised in the shipped footnote (src/renderer/index.html:294) but unimplemented: the keydown handler (main.ts:1061-1142) has no F6 case and KEY_GROUPS (:884-918) omits it; F6 has no default Electron behavior, so the advertised region-cycling does nothing. Spec §8 and design 1167 spec F6.

5. Modal dialogs (Export, Shortcuts) have no focus management: both declare role=dialog aria-modal=true (index.html:254,285) but openExportDialog (main.ts:801-816) / openShortcuts (:944-946) only unhide; no .focus() exists anywhere in src/, so focus is not moved in, trapped, or restored, and behind-scrim controls stay Tab-reachable. Violates spec §2 WCAG-AA requirement.

6. Inspector is removed from the accessibility tree when collapsed: updateInspectorVisibility (main.ts:282-287) sets inspectorEl.hidden, and style.css:43-45/833-835 apply display:none, removing the <aside> from the a11y tree; the form preview is a bare <canvas> (index.html:216) with no text alternative, so a collapsed inspector leaves no accessible claim representation. Directly contradicts UI req §6 ('always present in the DOM/accessibility tree … Ctrl+D toggles visual only').

7. Packaging produces no installer and no portable exe: package.json:56-58 build.win target is only 'dir' and the build script passes electron-builder --dir; no nsis/portable target exists, while BUILD_PLAN.md:216/231 (M0/M5 DoD) require an unsigned per-user installer. Config emits only release/win-unpacked/, so there is no shippable artifact.

## Confirmed — MINOR / NIT (14)

1. Professional (SV101) and dental (SV301) modifier extraction is unbounded: x12ClaimSource.ts:330 and :561 use procComposite.slice(2) with no upper bound, so an optional C003-7 description component would be captured as a spurious 5th modifier; the institutional extractor correctly uses slice(2,6) (:474) and takes index 6 as the description (:460,:481). Latent — current corpus SV101 carries no 7th component.

2. CMS-1500 box 11b label/value mismatch: layout.ts:150 labels 11b 'OTHER CLAIM ID (Designated by NUCC)' but keys it to insured.employer (renderCms1500.ts:749-750), so any employer value prints under the OTHER CLAIM ID label — an internal label/value inconsistency. Minor because employer is rarely populated in the real 1500 samples.

3. E2E test seams ship live in the packaged exe: electron/main.ts:366-381 (open) and 432-444 (save) gate only on CLAIM_VIEWER_E2E_OPEN / CLAIM_VIEWER_E2E_SAVE env-var presence with no IS_DEV/app.isPackaged guard (unlike the kill-switch/CSP at :37,119,164), routing env-var paths straight into readFile->loadClaims and renderClaim->writeFileAtomic (unencrypted PHI); the asar-extracted main.js contains both env vars. The comment at :363-365 falsely claims the seam can never affect the packaged app. Impact is dialog-hijacking requiring an operator click plus attacker-controlled environment.

4. Interrupted export orphans a temp file in the PHI export directory: writeFileAtomic (electron/main.ts:474-483) writes .<name>.<uuid>.tmp inside the user-chosen export dir (not app-controlled), and unlink cleanup runs only in the catch of the current call — a kill between write (:477) and rename (:478) orphans it. No startup/next-run sweep exists, and on Windows the dot-prefix confers no hidden attribute, so the orphan is visible. Deviates from BUILD_PLAN.md:146/205 (app-controlled temp dir).

5. Designed export 'done' state missing: confirmExport (main.ts:834-836) shows only a 6s auto-hiding toast (:865-873); no shell.showItemInFolder/openPath IPC exists in electron/, so the exported file cannot be opened from the app. Design ClaimViewer_v2.dc.html:776-777 and spec §7 (:55) require Open-folder / Open-PDF actions.

6. Welcome screen omits the drag-and-drop target: index.html:156 shows 'or use File → Open' and no dragover/drop listener exists in src/ or electron/, whereas design ClaimViewer_v2.dc.html:562 and spec §4 (:32) require a drop target for .json/.837.

7. Ctrl+Shift+E 'Export this claim (skip dialog)' and its File-menu item unimplemented: the only Ctrl+Shift branch is Shift+L->theme (main.ts:1089-1093), so Ctrl+Shift+E falls through to case 'e' -> openExportDialog (:1100-1103), opening the normal dialog instead of skipping it; the File menu (index.html:35-37) lists only Open/Export/Close. Spec §8/§3 and design 1152 require the skip-dialog shortcut and menu item.

8. Data-warnings banner is not announced to assistive tech: #warnBanner (index.html:131) has no role/aria-live (unlike the toast at :299), yet renderWarnBanner (main.ts:666-676) rewrites its count/messages on every claim load and PageUp/PageDown step, so screen-reader users get no announcement when warnings appear or change.

9. Boxes 28/29/30 (Total Charge / Amount Paid / Balance Due) draw frames and labels only on the last page: the draw loop is wrapped in if(isLastPage) at renderCms1500.ts:203-207, so on intermediate pages of a multi-page claim the 25-30 grid row is left un-framed and incomplete. Cosmetic.

10. Box-24 column headers G. DAYS/UNITS, H. EPSDT, I. ID QUAL are shrunk to the 4pt floor and ellipsis-truncated: narrow widths at layout.ts:273-275 (33/24/22pt) plus fitText minSize:4 (renderCms1500.ts:557-558) truncate to 'G. DAYS/UNI...', 'H. EPS...', 'I. ID Q...'. Legibility nit; data cells unaffected.

11. Unicode font embedding deferred: text.ts:8-13 stays on base-14 WinAnsi StandardFonts and safeText() (:60-78) transliterates via NFKD / substitutes '?', so PHI text outside cp1252 (e.g. 'Núñez'->'Nunez') is altered on export. TODO-documented, but PLAN_REVISION_v2_JSON.md:29 still lists it under 'What STILL STANDS' — a plan/code mismatch.

12. Documented DoD test/CI gates absent: no PHI-at-rest/SSN grep test and no updater-grep gate exist in test/ or e2e/, no autoUpdater/electron-updater reference anywhere to grep against, and there is no CI workflow (no .github/) — the gates named in BUILD_PLAN.md:203/231/242 depend on a maintainer running npm run verify locally.

13. electron-builder win.signtoolOptions not wired: package.json:56-58 build.win contains only { target: 'dir' } with no signtoolOptions placeholder, unmet against BUILD_PLAN.md:192 ('signing-ready — signtoolOptions wired but empty'). Config-only gap; app is correctly unsigned for v1.

14. E2E covers only the single-claim JSON CMS-1500 path: e2e/app.spec.ts opens only test/fixtures/synthetic-1500.json (:59) and is the sole spec; the multi-claim 837 stepper (gated at src/renderer/main.ts:274 for summaries.length>1) and the ub04/dental/unsupported render branches (claimService.ts:51-62) are exercised only by vitest calling functions directly, never through the shell.

## Prioritized fix list (21)

1. src/sources/json/jsonClaimSource.ts:129-131 — exclude npi==='0' from the facility (and referring, :223) hasAny presence check (add a sentinel-NPI helper) so a facility object is built only from real facility_name/facility_npi data, matching the npi==='0' exemption already used at :304.

2. src/render/cms1500/renderCms1500.ts:808-817 — insert cityStateZipLine(claim.billingProvider.address) between the street line and the NPI line in the billingProvider case, mirroring the facility case (:798-806) and the design's 4-line box 33.

3. src/renderer/main.ts:732-742 (or the PageUp/PageDown branch at :1075-1084) — early-return from stepClaim when anyOverlayOpen(), mirroring the Escape special-casing, or re-render the manifest*El nodes whenever currentIndex changes while the export overlay is open.

4. src/renderer/main.ts:282-287 + style.css:43-45,833-835 — collapse the inspector visually only (width:0 / off-canvas / visually-hidden) instead of hidden/display:none so it stays in the accessibility tree per UI req §6.

5. src/renderer/main.ts:801-816,944-946 — on dialog open, move focus to the dialog title/first control and trap Tab/Shift+Tab within it; on close (confirmExport/closeOverlay) restore focus to the invoking control.

6. src/renderer/index.html:294 / src/renderer/main.ts keydown handler — implement F6 focus cycling (toolbar -> #pdfScroll -> #inspector) or remove the F6 sentence from the footnote.

7. package.json:56-58,16 — add a win.target of 'portable' or 'nsis' (per-user, perMachine:false) and drop --dir from the build/verify script so a shippable installer/portable exe is emitted.

8. electron/main.ts:366-381,432-444 — gate both E2E seams on a production-off condition in addition to the env var (e.g. IS_DEV && process.env[...], or !app.isPackaged) and correct the false comment at :363-365; the Playwright E2E runs the unpackaged dist where IS_DEV is already true.

9. src/sources/x12/x12ClaimSource.ts:330,561 — bound the professional and dental modifier slices to slice(2,6) to match the institutional extractor (:474) so an SV101-7/SV301-7 description component is never captured as a spurious modifier.

10. src/render/cms1500/layout.ts:150 + renderCms1500.ts:749-750 — reconcile box 11b: either relabel to reflect employer data or leave it structural and drop insured.employer from the visible form, aligning with field-map §5.

11. electron/main.ts:474-483 — sweep leftover .<name>.*.tmp siblings in the target dir before/after writing, or place the temp in an app-controlled dir per BUILD_PLAN.md:146/205, or set the Windows hidden attribute on the temp.

12. src/renderer/index.html:131 — add role='status' / aria-live='polite' to #warnBanner so warning appearance/changes are announced on load and on 837 claim stepping.

13. src/renderer/main.ts:834-836 + electron/ — add an export 'done' state with Open-folder / Open-PDF actions backed by an IPC shell.showItemInFolder/openPath, or document the toast-only decision.

14. src/renderer/index.html:156 + main.ts — add a dragover/drop handler on the welcome/preview pane for .json/.837, or document removal of the drag-and-drop affordance.

15. src/renderer/main.ts:1086-1103 — add a Ctrl+Shift+E branch that exports with defaults (skipping the dialog) plus the matching File-menu item (index.html:35-37), or drop it from the spec/shortcuts sheet.

16. src/render/cms1500/renderCms1500.ts:203-207 — draw the 28/29/30 frames and labels on every page, suppressing only the total values on non-last pages, so the 25-30 grid row is complete on intermediate pages.

17. src/render/cms1500/layout.ts:266-277 — abbreviate the box-24 headers (e.g. 'G. DAYS', 'H. EPSDT', 'I. QUAL') or widen columns G/H/I slightly so they never hit the 4pt ellipsis floor.

18. src/render/text.ts:8-13 — implement the @pdf-lib/fontkit Unicode TTF embed, or restate PLAN_REVISION_v2_JSON.md:29 to mark it a deferred/accepted limitation.

19. Add a static no-updater-reference test and a PHI-at-rest/SSN grep test over userData, and wire npm run verify into a CI workflow (currently no .github/).

20. e2e/app.spec.ts — add an E2E case opening an 837 fixture (e.g. test/fixtures/x12/837I-all-fields.dat) to exercise the multi-claim stepper and UB-04 preview/export through the real shell, plus an unsupported-form case.

21. package.json:56-58 — add signtoolOptions: {} under build.win per BUILD_PLAN.md:192.

## Accepted limitations (no action) (1)

1. writeFileAtomic never fsyncs the temp file before rename nor the directory after (electron/main.ts:474-483), so a power loss could leave the renamed target present yet zero-length. The no-fsync fact is real, but both the docstring (:473) and BUILD_PLAN.md:146 deliberately scope the guarantee to process-kill/interrupt, not power loss; write-then-rename fully satisfies that documented contract. Intentional out-of-scope limitation for this offline, manual-export, re-exportable tool — fix only if power-loss durability is later brought into scope.

## Coverage gaps (6)

1. E2E exercises only the single-claim JSON CMS-1500 path (e2e/app.spec.ts:59, one fixture, one spec); the multi-claim 837 stepper and the UB-04 / dental / unsupported render branches are covered only by vitest calling functions directly, never through the Electron shell.

2. No PHI-at-rest / synthetic-SSN grep test exists in test/ or e2e/ despite BUILD_PLAN.md:203 requiring one.

3. No updater-grep gate exists (there is no autoUpdater/electron-updater reference to assert against), despite BUILD_PLAN.md:231/242.

4. No CI pipeline exists (no .github/ or CI workflow) — all DoD gates depend on a maintainer running npm run verify locally; the sole automated offline assertion is the outbound-fetch block at e2e/app.spec.ts:124-132.

5. 837 I/D parsing is validated only against a synthetic public corpus (no real payer samples), and real JSON samples were all claim_form '1500', so the 837I/837D and non-1500 JSON code paths lack real-world input coverage.

6. Note: the finding claiming a stale E2E header comment with expect.soft downgrades and an .evaluate click workaround was REFUTED — the current e2e/app.spec.ts already uses plain expect() and a real .click(), and the header documents the fix; no action needed there.
