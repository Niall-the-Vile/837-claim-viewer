import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Reproduction check for a user-reported bug: "File menu -> Open a claim
 * file... opens in the current window instead of opening in a new tab like
 * it normally does."
 *
 * The toolbar's #openBtn path is already covered by e2e/tabs.spec.ts; the
 * MENU path was not covered anywhere, which is exactly why a divergence
 * could go unnoticed. Both are supposed to funnel through the same
 * openClaimFlow() -> performOpen({kind:'dialog'}).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
const FIXTURE_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');

function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  if (!existsSync(MAIN_ENTRY)) throw new Error(`Built app not found at "${MAIN_ENTRY}". Run "npm run build:app" first.`);
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-menuopen-userdata-'));
  const app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: { ...definedEnv(process.env), ...env } });
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

test.describe('File menu -> Open', () => {
  test('opening a second, different file from the FILE MENU creates a second tab (not replacing the current one)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // First file via the welcome screen.
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('.tab')).toHaveCount(1);

      // Second file via the FILE MENU (the reported path).
      await page.locator('[data-menu-trigger="file"]').click();
      await page.locator('.menuPanel[data-menu-panel="file"] [data-action="open"]').click();

      await expect(page.locator('.tab')).toHaveCount(2);
      await expect(page.locator('.tab').nth(1)).toHaveClass(/isActive/);
    } finally {
      await app.close();
    }
  });

  test('opening the SAME file again from the File menu focuses the existing tab (the §2b dedupe)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_1500].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('.tab')).toHaveCount(1);

      await page.locator('[data-menu-trigger="file"]').click();
      await page.locator('.menuPanel[data-menu-panel="file"] [data-action="open"]').click();

      // Still one tab — the designed §2b behaviour.
      await page.waitForTimeout(1500);
      await expect(page.locator('.tab')).toHaveCount(1);

      // ...and it now SAYS so, instead of silently looking like a bug.
      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('already open');
      await expect(toast).toContainText('switched to that tab');
      await expect(toast).toContainText('synthetic-1500.json');
    } finally {
      await app.close();
    }
  });

  test('opening a THIRD distinct file from the menu with two tabs already open still adds a tab', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I, join(repoRoot, 'test', 'fixtures', 'x12', '837P-minimal.dat')].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);

      await page.locator('[data-menu-trigger="file"]').click();
      await page.locator('.menuPanel[data-menu-panel="file"] [data-action="open"]').click();
      await expect(page.locator('.tab')).toHaveCount(3);
    } finally {
      await app.close();
    }
  });

  test('for comparison: the same two files via the TOOLBAR button', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('.tab')).toHaveCount(1);

      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);
    } finally {
      await app.close();
    }
  });
});
