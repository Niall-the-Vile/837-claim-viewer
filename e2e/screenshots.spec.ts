import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Screenshot suite (docs/TABS_BUILD_PLAN.md §3b) — the visual record nobody
 * can see during an unattended run. ONE ElectronApplication, launched once in
 * `beforeAll` and reused for every shot: theme and tab count are toggled
 * in-page rather than relaunching, which would be slow and flaky (many
 * Electron process starts back-to-back on one machine).
 *
 * Deliberately excluded from `npm run verify` / `npx playwright test`
 * (see playwright.config.ts's `testIgnore`) and run only via
 * `npm run screenshots` — a screenshot failure must never break the build
 * gate. This file makes no correctness assertions beyond the minimum needed
 * to know a screen actually reached the state being photographed; it is not
 * a substitute for e2e/app.spec.ts / tabs.spec.ts / copy.spec.ts etc.
 *
 * Uses ONLY the synthetic fixtures already committed under test/fixtures/ —
 * never a real claim file, so a screenshot can never put PHI in the repo.
 * The "trigger overflow" tab count is reached by writing N copies of
 * test/fixtures/synthetic-1500.json into a temp dir at test time (distinct
 * paths, identical synthetic content) rather than committing N fixtures.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const SCREENSHOTS_DIR = join(repoRoot, 'docs', 'screenshots');

const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
const FIXTURE_837I_MULTI = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');
const FIXTURE_UNSUPPORTED = join(repoRoot, 'test', 'fixtures', 'unsupported-claim.json');
const FIXTURE_MANY_WARNINGS = join(repoRoot, 'test', 'fixtures', '837P-many-warnings.json');

const OVERFLOW_TAB_COUNT = 12;

function requireBuiltApp(): void {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`Built app not found at "${MAIN_ENTRY}". Run "npm run build" before the screenshots suite.`);
  }
}

function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Gives this file its own throwaway userData profile, exactly like every other e2e/*.spec.ts (docs/TABS_BUILD_PLAN.md §2e prerequisite / guardrail §1.9) — see e2e/app.spec.ts's launchApp() header comment for the full rationale. Only one launch happens in this whole file (beforeAll), reused by every test. */
async function launchApp(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; userDataDir: string }> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-screenshots-userdata-'));
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...definedEnv(process.env), ...env },
  });
  return { app, userDataDir };
}

/** Small settle delay after a state change (theme toggle, overlay open, tab switch) so an enter-animation (guardrail §1.6/§1.7) is fully finished before the pixels are captured. Screenshot-only concern — no correctness assertion depends on this. */
async function settle(page: Page, ms = 350): Promise<void> {
  await page.waitForTimeout(ms);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}.png`) });
}

/**
 * Reads the live theme off <html data-theme> and toggles it only if it isn't
 * already the requested one — avoids an unnecessary extra animation/paint
 * per shot. Uses the Ctrl+Shift+L shortcut rather than clicking
 * #themeToggleBtn: that button lives in the toolbar, which sits BEHIND any
 * open modal overlay (export/about/etc.) — a real click there would be
 * blocked by the overlay intercepting pointer events, exactly what several
 * of this file's shots need to toggle while a dialog is open. The shortcut
 * (src/renderer/shortcuts.ts) is deliberately not gated by
 * `anyOverlayOpen()`, unlike most other shortcuts, so it works in both
 * states.
 */
async function ensureTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const current = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (current === theme) return;
  await page.keyboard.press('Control+Shift+L');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
  await settle(page);
}

/**
 * Closes exactly `count` open tabs (via each tab's own close button, always
 * the current first tab) until the app is back on the welcome screen. Takes
 * an explicit count rather than looping on a live `.tab` count check: tab
 * close isn't necessarily reflected in the DOM in the same tick the click()
 * promise resolves (main-process IPC round-trip to drop the session, see
 * docs/TABS_BUILD_PLAN.md §2's setActivePdfDoc/session-close plumbing), so a
 * `while (count() > 0)` loop can read a stale count between the last click
 * and the DOM settling and then hang waiting for a tab that will never
 * reappear. Every call site here knows exactly how many tabs it opened.
 */
async function closeAllTabs(page: Page, count: number): Promise<void> {
  for (let remaining = count; remaining >= 1; remaining--) {
    await page.locator('.tab').first().locator('[data-tab-close]').click();
    await expect(page.locator('.tab')).toHaveCount(remaining - 1);
  }
  await expect(page.locator('#welcomeScreen')).toBeVisible();
}

/** Opens the next queued fixture (CLAIM_VIEWER_E2E_OPEN) as a new tab: the welcome screen's button when there are no tabs yet, the toolbar's Open button otherwise. Waits for the tab count to reach `expectedCount`. */
async function openNextQueuedFile(page: Page, expectedCount: number): Promise<void> {
  const noTabsYet = (await page.locator('.tab').count()) === 0;
  await page.locator(noTabsYet ? '#welcomeOpenBtn' : '#openBtn').click();
  await expect(page.locator('.tab')).toHaveCount(expectedCount);
}

test.describe.configure({ mode: 'serial' });

test.describe('837 Claim Viewer — screenshots (docs/TABS_BUILD_PLAN.md §3b)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  let overflowFixturesDir: string;
  let saveDir: string;

  test.beforeAll(async () => {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    // 12 distinct copies of the synthetic CMS-1500 fixture, written once
    // up front so their paths can be queued at launch time (the
    // CLAIM_VIEWER_E2E_OPEN seam is a fixed, launch-time env var — it can't
    // be changed mid-run). Never committed to the repo; pure synthetic
    // content copied byte-for-byte from test/fixtures/synthetic-1500.json.
    overflowFixturesDir = mkdtempSync(join(tmpdir(), 'claim-viewer-overflow-fixtures-'));
    const overflowFixturePaths: string[] = [];
    for (let i = 1; i <= OVERFLOW_TAB_COUNT; i++) {
      const dest = join(overflowFixturesDir, `overflow-copy-${String(i).padStart(2, '0')}.json`);
      cpSync(FIXTURE_1500, dest);
      overflowFixturePaths.push(dest);
    }

    saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-screenshots-export-'));
    const exportSavePath = join(saveDir, 'toast-export-demo.pdf');

    // The full open-queue, in the exact order this file's tests consume it:
    // 3 distinct real fixtures (1 tab, then 3 tabs) -> 12 overflow copies ->
    // FIXTURE_1500 again (clean single tab for workspace/about/export/toast)
    // -> FIXTURE_MANY_WARNINGS (warnings banner + inspector explanation) ->
    // FIXTURE_1500 once more (Ctrl+F inspector search, docs/BUILD_QUEUE.md
    // Build 2.1).
    const queue = [FIXTURE_1500, FIXTURE_837I_MULTI, FIXTURE_UNSUPPORTED, ...overflowFixturePaths, FIXTURE_1500, FIXTURE_MANY_WARNINGS, FIXTURE_1500];

    const launched = await launchApp({
      CLAIM_VIEWER_E2E_OPEN: queue.join(';'),
      CLAIM_VIEWER_E2E_SAVE: exportSavePath,
    });
    app = launched.app;
    userDataDir = launched.userDataDir;
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await ensureTheme(page, 'light');
  });

  test.afterAll(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(overflowFixturesDir, { recursive: true, force: true });
    rmSync(saveDir, { recursive: true, force: true });
  });

  test('tab strip: 1 tab, light + dark', async () => {
    await openNextQueuedFile(page, 1); // FIXTURE_1500
    await expect(page.locator('#workspaceScreen')).toBeVisible();
    await ensureTheme(page, 'light');
    await shot(page, 'tabs-1-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'tabs-1-dark');
    await ensureTheme(page, 'light');
  });

  test('tab strip: 3 tabs, light + dark', async () => {
    await openNextQueuedFile(page, 2); // FIXTURE_837I_MULTI
    await openNextQueuedFile(page, 3); // FIXTURE_UNSUPPORTED
    await ensureTheme(page, 'light');
    await shot(page, 'tabs-3-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'tabs-3-dark');
    await ensureTheme(page, 'light');
    await closeAllTabs(page, 3);
  });

  test('tab strip: overflow (~12 tabs), light + dark', async () => {
    for (let i = 1; i <= OVERFLOW_TAB_COUNT; i++) {
      await openNextQueuedFile(page, i);
    }
    await ensureTheme(page, 'light');
    await shot(page, 'overflow-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'overflow-dark');
    await ensureTheme(page, 'light');
    await closeAllTabs(page, OVERFLOW_TAB_COUNT);
  });

  test('workspace with claim rendered + inspector open, light + dark', async () => {
    await openNextQueuedFile(page, 1); // FIXTURE_1500, clean single tab
    await expect(page.locator('#workspaceScreen')).toBeVisible();
    await expect(page.locator('#inspector')).not.toHaveClass(/collapsed/); // inspectorOpen defaults true
    const canvasSize = await page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
    expect(canvasSize.width).toBeGreaterThan(0);
    expect(canvasSize.height).toBeGreaterThan(0);
    await ensureTheme(page, 'light');
    await shot(page, 'workspace-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'workspace-dark');
    await ensureTheme(page, 'light');
  });

  test('About screen: version/build stamp, light + dark', async () => {
    await page.locator('[data-menu-trigger="help"]').click();
    await page.locator('[data-action="about"]').click();
    await expect(page.locator('#aboutOverlay')).toBeVisible();
    await expect(page.locator('#aboutVersion')).not.toHaveText('');
    await expect(page.locator('#aboutBuildDate')).not.toHaveText('');
    await ensureTheme(page, 'light');
    await shot(page, 'about-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'about-dark');
    await ensureTheme(page, 'light');
    await page.locator('#aboutOverlay [data-close="about"]').first().click();
    await expect(page.locator('#aboutOverlay')).toBeHidden();
  });

  test('export dialog, light + dark, then export -> toast (§3c backslash screenshot)', async () => {
    await page.locator('#exportBtn').click();
    await expect(page.locator('#exportOverlay')).toBeVisible();
    await ensureTheme(page, 'light');
    await shot(page, 'export-dialog-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'export-dialog-dark');
    await ensureTheme(page, 'light');

    // §3c: capture the export-success toast (message set via `textContent`,
    // see src/renderer/overlays.ts's showToast) so the rendered backslash
    // glyphs in the saved Windows path can be visually inspected. The
    // string-level proof that the backslashes are actually present in the
    // DOM (textContent cannot strip characters) lives in e2e/app.spec.ts,
    // not here — this file is screenshots only.
    await page.locator('#exportConfirmBtn').click();
    await expect(page.locator('#exportOverlay')).toBeHidden();
    await expect(page.locator('#toast')).toBeVisible();
    await shot(page, 'toast-export');

    // Dismiss explicitly rather than letting the 15s auto-dismiss timer run
    // out — the toast is global chrome (not tied to a tab), so without this
    // it would still be up and bleed into the next test's shots.
    await page.locator('#toastCloseBtn').click();
    await expect(page.locator('#toast')).toBeHidden();

    await closeAllTabs(page, 1);
  });

  test('warnings banner + inspector "Data warnings" explanation, light + dark', async () => {
    await openNextQueuedFile(page, 1); // FIXTURE_MANY_WARNINGS
    await expect(page.locator('#warnBanner')).toBeVisible();
    await expect(page.locator('.inspRowExplain').first()).toBeVisible();
    await ensureTheme(page, 'light');
    await shot(page, 'warnings-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'warnings-dark');
    await ensureTheme(page, 'light');
    await closeAllTabs(page, 1);
  });

  test('Ctrl+F inspector search: filtered fields + stepped-to match outline, light + dark (docs/BUILD_QUEUE.md Build 2.1)', async () => {
    await openNextQueuedFile(page, 1); // FIXTURE_1500
    await expect(page.locator('#workspaceScreen')).toBeVisible();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#inspectorSearchInput')).toBeFocused();
    // "SAMPLEPATIENT" -> matches in both Patient and Insured (see
    // e2e/search.spec.ts's header comment for why this fixture value is
    // safe from the accidental cross-field digit collisions a bare numeric
    // query can hit once punctuation is stripped).
    await page.locator('#inspectorSearchInput').fill('SAMPLEPATIENT');
    await expect(page.locator('#inspectorSearchSummary')).toContainText('2 matches in 2 groups');
    await page.keyboard.press('Enter'); // stepped-to match gets the persistent outline
    await expect(page.locator('.inspRow.searchMatchActive')).toHaveCount(1);
    await ensureTheme(page, 'light');
    await shot(page, 'search-light');
    await ensureTheme(page, 'dark');
    await shot(page, 'search-dark');
    await ensureTheme(page, 'light');
    await page.keyboard.press('Escape');
    await closeAllTabs(page, 1);
  });
});
