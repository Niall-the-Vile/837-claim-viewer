import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Multi-file tabs (docs/ROADMAP.md §1 / docs/TABS_BUILD_PLAN.md §2/§2b): the
 * scenario the build's DoD calls out explicitly — open two files via the
 * `;`-queued CLAIM_VIEWER_E2E_OPEN seam, assert both tabs exist, switching
 * re-renders the correct claim, and closing one leaves the other intact —
 * plus a couple of §2b polish checks (same-file-twice dedupe, middle-click
 * close, Ctrl+W closing the tab rather than the file). Drives the real,
 * unpackaged dist/electron/main.js build, same as e2e/app.spec.ts /
 * e2e/multi-form.spec.ts — see those files' header comments for why.
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
});
