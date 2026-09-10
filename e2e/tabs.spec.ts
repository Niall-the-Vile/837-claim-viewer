import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { renderedCanvasSize, waitForFirstRender, UNRENDERED_CANVAS_WIDTH } from './support/canvas.js';

/**
 * Multi-file tabs (docs/ROADMAP.md §1 / docs/TABS_BUILD_PLAN.md §2/§2b): the
 * scenario the build's DoD calls out explicitly — open two files via the
 * `;`-queued CLAIM_VIEWER_E2E_OPEN seam, assert both tabs exist, switching
 * re-renders the correct claim, and closing one leaves the other intact —
 * plus same-file-twice dedupe, background-tab pdf.js release, middle-click
 * close, Ctrl+W/Ctrl+Tab/Ctrl+1-7 keyboard shortcuts, per-tab canvas
 * fingerprinting (no cross-tab/stale render), a rapid un-awaited tab-switch
 * race, and a closed tab's session actually refusing further claim IPC.
 * Drives the real, unpackaged dist/electron/main.js build, same as
 * e2e/app.spec.ts / e2e/multi-form.spec.ts — see those files' header
 * comments for why.
 *
 * docs/AUDIT_BUILD1.md MUST FIX #9 (test integrity): this file's header used
 * to claim coverage for middle-click close and Ctrl+W that did not actually
 * exist anywhere in the suite (a repo-wide grep for `{ button: 'middle' }`
 * or a Ctrl+W/Ctrl+Tab/Ctrl+1-7 keypress found nothing) — the tests below
 * are what makes that claim true.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');

// Two deliberately distinguishable fixtures: a single-claim JSON CMS-1500
// (no "Claim in this 837 file" stepper) and a two-claim X12 837I UB-04 (the
// stepper shows "Claim 1 of 2") — already used individually by
// e2e/app.spec.ts and e2e/multi-form.spec.ts respectively, so both are known
// to parse and render cleanly.
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
const FIXTURE_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');

function requireBuiltApp(): void {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`Built app not found at "${MAIN_ENTRY}". Run "npm run build" before the e2e suite (npm run verify does this for you).`);
  }
}

function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * PROFILE ISOLATION (docs/TABS_BUILD_PLAN.md §2e's hard prerequisite / guardrail
 * §1.9): mirrors e2e/app.spec.ts's launchApp() — see that file's header comment
 * for the full rationale. This file launches its own independent Electron
 * processes, so it needs the same fresh-userData-dir-per-launch treatment.
 */
async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-'));
  // eslint-disable-next-line no-console -- deliberate: makes per-launch profile isolation observable in `npx playwright test` output.
  console.log(`[e2e profile isolation] launching with fresh userData dir: ${userDataDir}`);

  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
      env: { ...definedEnv(process.env), ...env },
    });
  } catch (err) {
    rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const originalClose = app.close.bind(app);
  app.close = async () => {
    try {
      await originalClose();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
      // eslint-disable-next-line no-console -- see the log at launch above.
      console.log(`[e2e profile isolation] removed userData dir: ${userDataDir}`);
    }
  };
  return app;
}

test.describe('837 Claim Viewer — E2E — multi-file tabs', () => {
  test('opening two files via the E2E queue creates two tabs; switching re-renders the correct claim; closing one leaves the other intact', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // No tabs at all yet -> the strip is hidden (tabs.ts's currentScreen():
      // no tabs -> welcome).
      await expect(page.locator('#tabStrip')).toBeHidden();

      // Open file #1 (queue index 0, the CMS-1500 JSON) from the welcome
      // screen -> exactly one tab, active, workspace visible.
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#tabStrip')).toBeVisible();
      await expect(page.locator('.tab')).toHaveCount(1);
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      // Single-claim JSON file: no "Claim in this 837 file" stepper.
      await expect(page.locator('#claimGroup')).toBeHidden();
      const provenanceTab1 = await page.locator('#provenanceChipText').textContent();
      expect(provenanceTab1).toContain('JSON');

      // Open file #2 (queue index 1, the two-claim 837I) via the toolbar
      // Open button — the EXISTING tab stays open (a browser-style
      // background open, not a replace), a second tab appears and becomes
      // active.
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);
      await expect(page.locator('.tab').first()).not.toHaveClass(/isActive/);

      // The second (active) tab shows the 837I UB-04's 2-claim stepper.
      await expect(page.locator('#claimGroup')).toBeVisible();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');
      const canvasTab2 = await page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
      expect(canvasTab2.width).toBeGreaterThan(0);
      expect(canvasTab2.height).toBeGreaterThan(0);

      // Switch back to tab 1 by clicking it — re-renders the CMS-1500
      // claim: the stepper hides again (single claim) and the provenance
      // chip reverts to the JSON claim's text, proving the switch actually
      // reloaded tab 1's content rather than just toggling a CSS class.
      await page.locator('.tab').first().click();
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      await expect(page.locator('.tab').nth(1)).not.toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeHidden();
      await expect(page.locator('#provenanceChipText')).toContainText('JSON');
      const canvasTab1 = await page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
      expect(canvasTab1.width).toBeGreaterThan(0);
      expect(canvasTab1.height).toBeGreaterThan(0);

      // Close tab 2 (the inactive one) via its close button — tab 1 stays
      // exactly as it was (still active, workspace still showing its claim).
      const closeTab2 = page.locator('.tab').nth(1).locator('[data-tab-close]');
      await closeTab2.click();
      await expect(page.locator('.tab')).toHaveCount(1);
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeHidden();
      await expect(page.locator('#provenanceChipText')).toContainText('JSON');

      // Closing the LAST tab returns to the welcome screen and hides the
      // strip again (screen is derived: no tabs -> welcome).
      const closeTab1 = page.locator('.tab').first().locator('[data-tab-close]');
      await closeTab1.click();
      await expect(page.locator('#welcomeScreen')).toBeVisible();
      await expect(page.locator('#tabStrip')).toBeHidden();
      await expect(page.locator('.tab')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('a failed claim:getPdf on claim step never leaves the tab describing a different claim than the one on screen (docs/AUDIT_BUILD1.md MUST FIX #2)', async () => {
    // CLAIM_VIEWER_E2E_FAIL_PDF_INDEX (electron/main.ts's claim:getPdf
    // handler, added for this test) makes claim index 1's render always
    // throw — the two claims in FIXTURE_837I are deliberately distinguishable
    // by total charge ($89.93 for claim 1, $95.50 for claim 2; both happen to
    // have 2 service lines, so total is the reliable discriminator).
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I, CLAIM_VIEWER_E2E_FAIL_PDF_INDEX: '1' });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');
      await expect(page.locator('#statusTotals')).toContainText('$89.93');

      // Step to claim 2 — claim:getDetail succeeds (claim 2's data DOES
      // exist), but the subsequent claim:getPdf for index 1 always throws
      // under this seam. Pre-fix, main.ts wrote tab.currentIndex/tab.detail
      // to claim 2 BEFORE this failure and never rolled them back, so the
      // tab strip/inspector/export dialog would go on describing claim 2
      // while the canvas silently kept showing claim 1's already-rendered
      // page.
      await page.locator('#nextClaimBtn').click();
      await expect(page.locator('#toast')).toBeVisible();
      await expect(page.locator('#toast')).toContainText('Simulated PDF render failure');

      // Everything must have rolled back to claim 1 — the claim actually
      // still on screen — not advanced to claim 2.
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');
      await expect(page.locator('#statusTotals')).toContainText('$89.93');
      await expect(page.locator('#statusTotals')).not.toContainText('$95.50');
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#errorScreen')).toBeHidden();
      await expect(page.locator('#exportBtn')).toBeEnabled();

      // The export dialog reads tab.currentIndex/tab.detail directly
      // (overlays.ts's openExportDialog) — this is the exact mechanism the
      // audit finding named ("export follows the wrong one"). Its manifest
      // must describe claim 1, never claim 2.
      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportOverlay')).toBeVisible();
      await expect(page.locator('#manifestTotal')).toHaveText('$89.93');
    } finally {
      await app.close();
    }
  });

  test('opening the same file twice focuses the existing tab instead of duplicating it', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I, FIXTURE_1500].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click(); // tab 1: FIXTURE_1500
      await expect(page.locator('.tab')).toHaveCount(1);
      await page.locator('#openBtn').click(); // tab 2: FIXTURE_837I, becomes active
      await expect(page.locator('.tab')).toHaveCount(2);
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);

      // Re-"open" FIXTURE_1500 (queue index 2) — main dedupes by resolved
      // path and returns tab 1's existing sessionId, so this must focus tab
      // 1 rather than create a third tab.
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeHidden(); // back on the single-claim JSON tab
    } finally {
      await app.close();
    }
  });

  test('background-tab pdf.js release: switching away releases the outgoing tab\'s document, and reactivating it rebuilds a fresh one (docs/AUDIT_BUILD1.md MUST FIX #1)', async () => {
    // src/renderer/main.ts's ensureClaimRendered logs `[tabs] rebuilding
    // pdf.js document for tab <id>` every time it actually has to rebuild a
    // tab's pdf.js document (tab.pdfDoc was falsy) — the ONLY way that can
    // happen for a tab that already finished loading once is if something
    // released it in between (activateTabById's background-tab release,
    // §2b). Before the MUST FIX #1 fix, tabs.ts's createTab set
    // state.activeTabId itself, so opening file #2 in the background never
    // even recognized tab #1 as "the tab being switched away from" —
    // nothing released tab #1's document, so reactivating it later found
    // tab.pdfDoc still truthy and never logged a second rebuild for its id.
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      const rebuildLogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('[tabs] rebuilding pdf.js document for tab')) rebuildLogs.push(msg.text());
      });
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click(); // tab 1 opens + renders -> 1st rebuild log for tab 1
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      const tab1Id = await page.locator('.tab').first().getAttribute('data-tab-id');
      expect(tab1Id).toBeTruthy();
      await expect.poll(() => rebuildLogs.filter((l) => l.includes(`tab ${tab1Id}`)).length).toBe(1);

      await page.locator('#openBtn').click(); // tab 2 opens in the background and becomes active
      await expect(page.locator('.tab')).toHaveCount(2);
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeVisible(); // tab 2's content genuinely rendered

      // Switch back to tab 1 — this MUST trigger a SECOND rebuild for tab
      // 1's id, proving its pdf.js document was actually released
      // (destroyed) when tab 2 became active, not merely left alive and
      // abandoned. This is the E2E-observable proxy for the fake-counting
      // unit test's guarantee (test/tabState.test.ts) actually being wired
      // up correctly in the real activateTabById orchestration.
      await page.locator('.tab').first().click();
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeHidden();
      await expect.poll(() => rebuildLogs.filter((l) => l.includes(`tab ${tab1Id}`)).length).toBe(2);
    } finally {
      await app.close();
    }
  });

  test('Ctrl+W closes the active tab, not the app window', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);

      // Ctrl+W used to close the FILE (single-file era); this build repurposes
      // it to close the active TAB (shortcuts.ts). Menu.setApplicationMenu(null)
      // (electron/main.ts) neutralizes any native window-close accelerator, so
      // this is provably testing the app's own handler, not an OS/Electron default.
      await page.keyboard.press('Control+w');
      await expect(page.locator('.tab')).toHaveCount(1);
      expect(app.windows().length).toBe(1);
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.keyboard.press('Control+w');
      await expect(page.locator('.tab')).toHaveCount(0);
      await expect(page.locator('#welcomeScreen')).toBeVisible();
      expect(app.windows().length).toBe(1);
    } finally {
      await app.close();
    }
  });

  test('Ctrl+Tab / Ctrl+Shift+Tab cycles between tabs', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click(); // tab 1
      await page.locator('#openBtn').click(); // tab 2, active
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);

      await page.keyboard.press('Control+Tab'); // wraps around to tab 1
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);

      await page.keyboard.press('Control+Tab'); // back to tab 2
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);

      await page.keyboard.press('Control+Shift+Tab'); // reverse direction, back to tab 1
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
    } finally {
      await app.close();
    }
  });

  test('Ctrl+1 / Ctrl+2 jump directly to a tab by position', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);

      await page.keyboard.press('Control+1');
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeHidden();

      await page.keyboard.press('Control+2');
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('middle-click on a tab closes it', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);
      const tab1Id = await page.locator('.tab').first().getAttribute('data-tab-id');

      // `auxclick` (tabs.ts's initTabStrip) — Playwright's `button: 'middle'`
      // click option fires exactly that, not the primary-button `click` path.
      await page.locator('.tab').first().click({ button: 'middle' });
      await expect(page.locator('.tab')).toHaveCount(1);
      await expect(page.locator(`.tab[data-tab-id="${tab1Id}"]`)).toHaveCount(0);
      // The survivor is the OTHER tab (837I), still active, its content intact.
      await expect(page.locator('.tab').first()).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('canvas fingerprint differs between tabs and is exactly restored when switching back (no cross-tab/stale render — docs/AUDIT_BUILD1.md MUST FIX #10)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const fingerprint = (): Promise<string> => page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => el.toDataURL());

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      // #workspaceScreen becomes visible BEFORE the first render is awaited,
      // so this baseline must wait — otherwise fp1 can be the blank 300x150
      // default canvas, and the "switching back restores fp1" poll below
      // would then never match a real render (docs/AUDIT_BUILD2.md).
      await waitForFirstRender(page);
      const fp1 = await fingerprint();
      expect(fp1.length).toBeGreaterThan(100); // a real, non-blank render, not just an empty canvas data URL

      await page.locator('#openBtn').click();
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);
      // The two fixtures render genuinely different forms (CMS-1500 vs
      // UB-04) — poll rather than a single read, so this can never race a
      // still-in-flight render.
      await expect.poll(() => fingerprint()).not.toBe(fp1);
      const fp2 = await fingerprint();

      await page.locator('.tab').first().click();
      await expect.poll(() => fingerprint()).toBe(fp1);

      await page.locator('.tab').nth(1).click();
      await expect.poll(() => fingerprint()).toBe(fp2);
    } finally {
      await app.close();
    }
  });

  test('rapid un-awaited A -> B -> A tab switching settles on the correct claim with no unhandled rejection', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click(); // tab 1
      await page.locator('#openBtn').click(); // tab 2, active
      await expect(page.locator('.tab')).toHaveCount(2);

      const tab1 = page.locator('.tab').first();
      const tab2 = page.locator('.tab').nth(1);

      // Fire without awaiting the app settling between clicks — faster than
      // a real user could double/triple-click, deliberately racing
      // preview.ts's render serialization and tabs.ts's pdf.js lifecycle
      // (docs/TABS_BUILD_PLAN.md §2 watch-out (b)).
      await tab1.click();
      await tab2.click();
      await tab1.click();

      await expect(tab1).toHaveClass(/isActive/);
      await expect(page.locator('#claimGroup')).toBeHidden(); // tab 1 = single-claim JSON
      await expect(page.locator('#provenanceChipText')).toContainText('JSON');
      // `> 0` would be vacuous: an unrendered #pdfCanvas reports the 300x150
      // HTML default, not 0x0 (docs/AUDIT_BUILD2.md, e2e/support/canvas.ts).
      const canvas = await renderedCanvasSize(page);
      expect(canvas.width).not.toBe(UNRENDERED_CANVAS_WIDTH);
      expect(canvas.height).toBeGreaterThan(0);

      expect(pageErrors).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test('claim:getDetail and claim:getPdf both reject once the owning tab is closed (session dropped — coverage gap #6)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const tabEl = page.locator('.tab').first();
      const tabId = await tabEl.getAttribute('data-tab-id');
      const sessionId = await tabEl.getAttribute('data-tab-session-id');
      expect(tabId).toBeTruthy();
      expect(sessionId).toBeTruthy();

      await tabEl.locator('[data-tab-close]').click();
      await expect(page.locator('#welcomeScreen')).toBeVisible();
      await expect(page.locator('.tab')).toHaveCount(0);

      const [detailOutcome, pdfOutcome] = await page.evaluate(async (sid: string) => {
        const claimApi = (window as unknown as { claimApi: { getDetail: (s: string, i: number) => Promise<unknown>; getPdf: (s: string, i: number) => Promise<unknown> } }).claimApi;
        const settle = async (p: Promise<unknown>): Promise<string> => {
          try {
            await p;
            return 'resolved';
          } catch {
            return 'rejected';
          }
        };
        return Promise.all([settle(claimApi.getDetail(sid, 0)), settle(claimApi.getPdf(sid, 0))]);
      }, sessionId as string);

      expect(detailOutcome).toBe('rejected');
      expect(pdfOutcome).toBe('rejected');
    } finally {
      await app.close();
    }
  });
});
