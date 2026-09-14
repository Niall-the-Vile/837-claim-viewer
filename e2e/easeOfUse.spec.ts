import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { waitForFirstRender, UNRENDERED_CANVAS_WIDTH } from './support/canvas.js';

/**
 * Ease-of-use + accessibility batch (docs/CLAUDE_CODE_NEXT_SESSION.md) — E2E
 * coverage for:
 *   1. Tooltips with shortcut hints on icon-only toolbar controls.
 *   2. Recent Files surfaced on the welcome/empty-state screen.
 *   3. Keyboard command palette.
 *   4. Bundled sample-claim set ("Open Sample Claim").
 *   5. Deferred-render fast mode.
 *   7. Clickable warnings (inspector half).
 * One file for the whole batch rather than a scattering of one-off specs,
 * matching the existing per-feature-file convention loosely while keeping
 * this batch's coverage together.
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

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 7: clickable warnings (inspector half)', () => {
  test('clicking (or pressing Enter on) a warning row in the inspector reveals and flashes the field it concerns', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeSampleBtn').click();
      await page.locator('#samplesList .sampleItem').filter({ hasText: 'bad billing NPI' }).click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Open the "Data warnings" inspector group (collapsed by default here
      // since it's a single warning) via the status bar's warning button.
      await page.locator('#statusWarnBtn').click();
      const warnGroup = page.locator('details.inspGroup[data-group-id="warn"]');
      await expect(warnGroup).toHaveJSProperty('open', true);

      const warningRow = warnGroup.locator('.inspRow.inspRowClickable', { hasText: 'fails the NPI check' });
      await expect(warningRow).toBeVisible();
      await expect(warningRow).toHaveAttribute('title', /locate/i);

      // The Providers group is collapsed by default and has no persistent
      // outline yet.
      const providersGroup = page.locator('details.inspGroup[data-group-id="providers"]');
      await expect(providersGroup).toHaveJSProperty('open', false);
      await expect(page.locator('.searchMatchActive')).toHaveCount(0);

      await warningRow.click();

      await expect(providersGroup).toHaveJSProperty('open', true);
      await expect(page.locator('.searchMatchActive')).toHaveCount(1);
      // The flash landed on the Providers group's own heading (no specific
      // service line for an NPI warning) — a <summary>, not an .inspRow.
      await expect(page.locator('details[data-group-id="providers"] > summary.searchMatchActive')).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('Enter activates a focused clickable warning row the same way a click does', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeSampleBtn').click();
      await page.locator('#samplesList .sampleItem').filter({ hasText: 'bad billing NPI' }).click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.locator('#statusWarnBtn').click();
      const warningRow = page.locator('details.inspGroup[data-group-id="warn"] .inspRow.inspRowClickable', { hasText: 'fails the NPI check' });
      await warningRow.focus();
      await page.keyboard.press('Enter');

      await expect(page.locator('details.inspGroup[data-group-id="providers"]')).toHaveJSProperty('open', true);
      await expect(page.locator('.searchMatchActive')).toHaveCount(1);
    } finally {
      await app.close();
    }
  });
});

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 3: command palette', () => {
  test('Ctrl+K with no file open lists real menu actions (read live, not a second list) and activates one', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#welcomeScreen')).toBeVisible();

      await page.keyboard.press('Control+k');
      await expect(page.locator('#paletteOverlay')).toBeVisible();
      // Focus lands directly in the input, ready to type.
      await expect(page.locator('#paletteInput')).toBeFocused();

      await page.locator('#paletteInput').fill('open a claim');
      const openAction = page.locator('.paletteItem', { hasText: 'Open a claim file' });
      await expect(openAction).toHaveCount(1);
      await expect(openAction).toContainText('Ctrl+O');
      await openAction.click();

      await expect(page.locator('#paletteOverlay')).toBeHidden();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('a disabled action (no file open) is listed with its reason, and Enter selects the first ENABLED match instead', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#welcomeScreen')).toBeVisible();

      await page.keyboard.press('Control+k');
      await page.locator('#paletteInput').fill('export');
      const exportAction = page.locator('.paletteItem', { hasText: 'Export PDF' });
      await expect(exportAction).toBeDisabled();
      await expect(exportAction).toContainText('No file open');
    } finally {
      await app.close();
    }
  });

  test('lists open tabs and jumps to one by (partial) filename', async () => {
    const FIXTURE_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);
      // The second file is now active.
      await expect(page.locator('.tab').nth(1)).toHaveAttribute('aria-selected', 'true');

      await page.keyboard.press('Control+k');
      await page.locator('#paletteInput').fill('synthetic-1500');
      const tabItem = page.locator('.paletteItem', { hasText: 'synthetic-1500.json' });
      await expect(tabItem).toHaveCount(1);
      await expect(tabItem).toContainText('Tab');
      await tabItem.click();

      await expect(page.locator('#paletteOverlay')).toBeHidden();
      await expect(page.locator('.tab').first()).toHaveAttribute('aria-selected', 'true');
    } finally {
      await app.close();
    }
  });

  test('in an 837 batch, lists claims by claim id and jumps to one', async () => {
    const FIXTURE_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');

      await page.keyboard.press('Control+k');
      await page.locator('#paletteInput').fill('claim 2 of 2');
      const claimItem = page.locator('.paletteItem', { hasText: 'Claim 2 of 2' });
      await expect(claimItem).toHaveCount(1);
      await claimItem.click();

      await expect(page.locator('#paletteOverlay')).toBeHidden();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 2 of 2');
    } finally {
      await app.close();
    }
  });

  test('Esc closes the palette and restores focus to where Ctrl+K was pressed', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').focus();
      await page.keyboard.press('Control+k');
      await expect(page.locator('#paletteOverlay')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#paletteOverlay')).toBeHidden();
      await expect(page.locator('#welcomeOpenBtn')).toBeFocused();
    } finally {
      await app.close();
    }
  });
});

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 5: deferred-render fast mode', () => {
  test('default (Fast open OFF): opening a claim renders the canvas immediately, same as before this feature', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await waitForFirstRender(page);
      await expect(page.locator('#deferredRenderCard')).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test('Fast open ON: opening a claim populates the inspector but shows the placeholder card instead of rendering, and "Render form" renders it in place', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Enable Fast open from the welcome screen, before opening anything.
      // The menu item's own click handler closes the menu (same as every
      // other [data-action] menu button), so no explicit Escape is needed.
      await page.locator('[data-menu-trigger="view"]').click();
      const fastOpenToggle = page.locator('#fastOpenToggle');
      await expect(fastOpenToggle).toHaveAttribute('aria-checked', 'false');
      await fastOpenToggle.click();
      await expect(fastOpenToggle).toHaveAttribute('aria-checked', 'true');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // The inspector is populated (this is NOT a new state screen)...
      await expect(page.locator('#inspectorBody')).toContainText('Patient');
      // ...but the canvas has never actually been rendered into.
      await expect(page.locator('#pdfCanvas')).toBeHidden();
      expect(await page.locator('#pdfCanvas').evaluate((el) => (el as HTMLCanvasElement).width)).toBe(UNRENDERED_CANVAS_WIDTH);

      const card = page.locator('#deferredRenderCard');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Professional');
      await expect(card).toContainText('service line');

      await page.locator('#deferredRenderBtn').click();

      await expect(card).toBeHidden();
      await waitForFirstRender(page);
      await expect(page.locator('#pdfCanvas')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('Fast open ON: a zoom action (not just the Render form button) resolves the placeholder in place', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('[data-menu-trigger="view"]').click();
      await page.locator('#fastOpenToggle').click();
      await page.keyboard.press('Escape');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#deferredRenderCard')).toBeVisible();

      await page.locator('#zoomInBtn').click();

      await expect(page.locator('#deferredRenderCard')).toBeHidden();
      await waitForFirstRender(page);
      await expect(page.locator('#pdfCanvas')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('Fast open ON: reactivating a background tab returns to the placeholder rather than auto-rendering', async () => {
    const FIXTURE_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('[data-menu-trigger="view"]').click();
      await page.locator('#fastOpenToggle').click();
      await page.keyboard.press('Escape');

      // First tab: render it fully via the placeholder button.
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#deferredRenderBtn').click();
      await waitForFirstRender(page);

      // Second tab opens straight into the placeholder too.
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);
      await expect(page.locator('#deferredRenderCard')).toBeVisible();

      // Back to the first tab (now a BACKGROUND tab reactivating) — even
      // though it was fully rendered before, background release already
      // nulled its pdfDoc, so fast mode shows the placeholder again rather
      // than auto-rendering.
      await page.locator('.tab').first().click();
      await expect(page.locator('#deferredRenderCard')).toBeVisible();
      await expect(page.locator('#pdfCanvas')).toBeHidden();
    } finally {
      await app.close();
    }
  });
});

test.describe('837 Claim Viewer — E2E — ease-of-use + accessibility batch — item 6: high-contrast render mode (view only)', () => {
  test('toggling it on/off from the View menu applies and removes a CSS filter on #pdfCanvas, nothing else', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const filterOf = () => page.locator('#pdfCanvas').evaluate((el) => getComputedStyle(el).filter);
      expect(await filterOf()).toBe('none');

      await page.locator('[data-menu-trigger="view"]').click();
      const toggle = page.locator('#highContrastToggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');

      expect(await filterOf()).not.toBe('none');
      await expect(page.locator('#pdfCanvas')).toHaveClass(/isHighContrast/);

      // Turning it back off restores the canvas exactly.
      await page.locator('[data-menu-trigger="view"]').click();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(await filterOf()).toBe('none');
    } finally {
      await app.close();
    }
  });

  test('adversarial check: toggling high-contrast never changes the underlying PDF bytes (claimApi.getPdf — the exact bytes export also renders from)', async () => {
    // Comparing two full EXPORTED files across two app launches would be
    // contaminated by the unrelated, legitimate provenance footer
    // (electron/main.ts's dialog:exportPdf stamps a real `renderedAt: new
    // Date()`, so two genuinely separate exports of the same claim are
    // NEVER byte-identical regardless of this feature). claimApi.getPdf is
    // the undecorated, deterministic render (no provenance — see that
    // handler's own comment) that both the on-screen preview AND, for a
    // single-claim export, the same renderClaim() call underneath draw
    // from — asserting it is untouched by the renderer-only
    // highContrastEnabled flag is the precise, noise-free version of "this
    // never leaks into export."
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const pdfBytesAsCsv = () =>
        page.evaluate(async () => {
          const sessionId = document.querySelector('.tab.isActive')?.getAttribute('data-tab-session-id') ?? '';
          const claimApi = (window as unknown as { claimApi: { getPdf: (s: string, i: number) => Promise<Uint8Array> } }).claimApi;
          const bytes = await claimApi.getPdf(sessionId, 0);
          return Array.from(bytes).join(',');
        });

      const before = await pdfBytesAsCsv();

      await page.locator('[data-menu-trigger="view"]').click();
      await page.locator('#highContrastToggle').click();
      await expect(page.locator('#pdfCanvas')).toHaveClass(/isHighContrast/);

      const after = await pdfBytesAsCsv();
      expect(after).toBe(before);
    } finally {
      await app.close();
    }
  });
});
