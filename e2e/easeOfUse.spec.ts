import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Ease-of-use + accessibility batch (docs/CLAUDE_CODE_NEXT_SESSION.md) — E2E
 * coverage for:
 *   1. Tooltips with shortcut hints on icon-only toolbar controls.
 *   2. Recent Files surfaced on the welcome/empty-state screen.
 *   4. Bundled sample-claim set ("Open Sample Claim").
 * (Items 3, 5, 6, 7 have their own describe blocks appended below as they
 * land, per this batch's plan — one file for the whole batch rather than a
 * scattering of one-off specs, matching the existing per-feature-file
 * convention loosely while keeping this batch's coverage together.)
 *
 * Drives the real, unpackaged dist/electron/main.js build, same as every
 * other E2E file in this suite.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');

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

/** Mirrors e2e/app.spec.ts's launchApp() — a fresh, throwaway userData profile per test (guardrail §1.9). */
async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-'));
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
    }
  };
  return app;
}

/** Mirrors e2e/session-restore.spec.ts's launchAppWithUserData — caller owns the directory's lifecycle across two launches. */
async function launchAppWithUserData(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...definedEnv(process.env), ...env },
  });
}

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 1: tooltips', () => {
  test('icon-only toolbar controls carry a visible title naming the action and its shortcut, alongside their existing aria-label', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const expectations: Array<{ selector: string; titlePattern: RegExp; ariaLabel: string }> = [
        { selector: '#zoomInBtn', titlePattern: /Zoom in.*Ctrl/, ariaLabel: 'Zoom in' },
        { selector: '#zoomOutBtn', titlePattern: /Zoom out.*Ctrl/, ariaLabel: 'Zoom out' },
        { selector: '#prevPageBtn', titlePattern: /Previous page.*Ctrl/, ariaLabel: 'Previous page' },
        { selector: '#nextPageBtn', titlePattern: /Next page.*Ctrl/, ariaLabel: 'Next page' },
        { selector: '#themeToggleBtn', titlePattern: /Toggle light\/dark theme.*Ctrl\+Shift\+L/, ariaLabel: 'Toggle light/dark theme' },
      ];
      for (const { selector, titlePattern, ariaLabel } of expectations) {
        const el = page.locator(selector);
        await expect(el).toHaveAttribute('title', titlePattern);
        await expect(el).toHaveAttribute('aria-label', ariaLabel);
      }

      // Dialog close buttons (export dialog here — the same markup pattern
      // is shared by shortcuts/about/forget/samples).
      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportOverlay')).toBeVisible();
      await expect(page.locator('#exportOverlay .iconBtn[data-close="export"]')).toHaveAttribute('title', /Close.*Esc/);
      await page.keyboard.press('Escape');

      // Search-clear button only appears once there's a query to clear.
      await page.keyboard.press('Control+f');
      await page.locator('#inspectorSearchInput').fill('abc');
      await expect(page.locator('#inspectorSearchClearBtn')).toBeVisible();
      await expect(page.locator('#inspectorSearchClearBtn')).toHaveAttribute('title', /Clear search.*Esc/);
    } finally {
      await app.close();
    }
  });

  test('claim in this 837 file steppers carry a visible title', async () => {
    const FIXTURE_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#nextClaimBtn')).toHaveAttribute('title', /Next claim.*PageDown/);
      await expect(page.locator('#prevClaimBtn')).toHaveAttribute('title', /Previous claim.*PageUp/);
    } finally {
      await app.close();
    }
  });
});

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 2: recent files on welcome screen', () => {
  test('a recently-opened file is clickable from the welcome screen, not just the File menu', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-eou-recent-userdata-'));
    try {
      // First launch: open a file so it lands in the recent-files store.
      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
      try {
        const page1 = await app1.firstWindow();
        await page1.waitForLoadState('domcontentloaded');
        await page1.locator('#welcomeOpenBtn').click();
        await expect(page1.locator('#workspaceScreen')).toBeVisible();
        // Close the tab so session.json's OPEN-TABS list is empty (recent
        // files is a separate, independent list — closing a tab never
        // removes its entry from it) — the point of this test is the
        // welcome screen's recent-files section, so the second launch needs
        // to actually land on the welcome screen rather than restoring a tab.
        await page1.keyboard.press('Control+w');
        await expect(page1.locator('#welcomeScreen')).toBeVisible();
      } finally {
        await app1.close();
      }

      // Second launch against the SAME profile, with no tabs restored
      // (session.json isn't touched by this test — only the recent-files
      // side of it) so the welcome screen is what's on screen.
      const app2 = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: definedEnv(process.env) });
      try {
        const page2 = await app2.firstWindow();
        await page2.waitForLoadState('domcontentloaded');
        await expect(page2.locator('#welcomeScreen')).toBeVisible();

        await expect(page2.locator('#welcomeRecentFiles')).toBeVisible();
        const item = page2.locator('#welcomeRecentFilesList .recentFileItem').first();
        await expect(item).toContainText('synthetic-1500.json');

        await item.click();
        await expect(page2.locator('#workspaceScreen')).toBeVisible();
        await expect(page2.locator('.tab')).toHaveCount(1);
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('welcome screen shows no recent-files section on a completely fresh profile', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#welcomeScreen')).toBeVisible();
      await expect(page.locator('#welcomeRecentFiles')).toBeHidden();
    } finally {
      await app.close();
    }
  });
});

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 4: bundled sample claims', () => {
  test('the welcome screen\'s "Open a sample claim…" link opens the samples dialog, and a clean sample opens with zero warnings', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#welcomeScreen')).toBeVisible();

      await page.locator('#welcomeSampleBtn').click();
      await expect(page.locator('#samplesOverlay')).toBeVisible();
      const items = page.locator('#samplesList .sampleItem');
      await expect(items).toHaveCount(4);

      await items.filter({ hasText: 'Institutional' }).first().click();
      await expect(page.locator('#samplesOverlay')).toBeHidden();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#warnBanner')).toBeHidden();
      // The previously-unused #sampleChip stub now shows content for a tab
      // opened via the sample picker.
      await expect(page.locator('#sampleChip')).toBeVisible();
      await expect(page.locator('#sampleChip')).toContainText('Sample data');
    } finally {
      await app.close();
    }
  });

  test('File > Open Sample Claim opens the same dialog, and the defective sample shows its real warning', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('[data-menu-trigger="file"]').click();
      await page.locator('[data-action="openSamples"]').click();
      await expect(page.locator('#samplesOverlay')).toBeVisible();

      await page.locator('#samplesList .sampleItem').filter({ hasText: 'bad billing NPI' }).click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#warnBanner')).toBeVisible();
      await expect(page.locator('#warnBanner')).toContainText('1 data warning');
      await expect(page.locator('#warnMessages')).toContainText('fails the NPI check');
    } finally {
      await app.close();
    }
  });
});
