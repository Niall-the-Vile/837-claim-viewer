import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Session restore + recent files (docs/TABS_BUILD_PLAN.md §2e — an APPROVED
 * deliberate policy change): open tabs' file paths + order + which was
 * active persist to `session.json` under `app.getPath('userData')`, are
 * restored on the NEXT launch, and lazily loaded (only the active tab is
 * parsed/rendered immediately; the rest stay `'unloaded'` until clicked).
 *
 * This is the one E2E file in the suite that launches the SAME
 * `userData` directory twice (`launchAppWithUserData`, mirroring
 * e2e/app.spec.ts's helper of the same name/behavior) — every other E2E
 * file gets a fresh throwaway profile per launch (guardrail §1.9 / this
 * feature's own hard prerequisite) specifically so a restored tab never
 * leaks into an unrelated test's assertions; this file is the deliberate,
 * scoped exception, and owns its own directory's full lifecycle (mkdtemp
 * before the first launch, rmSync after the last close).
 *
 * Drives the real feature end-to-end with NO E2E-seam involved on the
 * second launch — restore is driven purely by `session.json` +
 * `session:getRestoreState`, not by `CLAIM_VIEWER_E2E_OPEN`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
/** The app's real version, read from package.json — the value About must display (see the About assertion below). */
const APP_VERSION = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
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

/** Mirrors e2e/app.spec.ts's `launchAppWithUserData` — the caller owns `userDataDir`'s full lifecycle (create before the first launch, remove after the last close), since the whole point here is that the directory survives between two launches. */
async function launchAppWithUserData(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...definedEnv(process.env), ...env },
  });
}

test.describe('837 Claim Viewer — E2E — session restore', () => {
  test('open two files, close, relaunch against the same profile: tabs come back in order with the right active tab, and only the active one is loaded', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-restore-userdata-'));
    try {
      // --- First launch: open two files, then close. ---------------------
      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
      const page1 = await app1.firstWindow();
      await page1.waitForLoadState('domcontentloaded');

      await page1.locator('#welcomeOpenBtn').click(); // tab 1: synthetic-1500.json
      await expect(page1.locator('.tab')).toHaveCount(1);
      await page1.locator('#openBtn').click(); // tab 2: 837I-multi-claim.dat, becomes active
      await expect(page1.locator('.tab')).toHaveCount(2);
      await expect(page1.locator('.tab').nth(1)).toHaveClass(/isActive/);
      await expect(page1.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');

      // persistSession()'s claimApi.saveSession IPC round-trip happens
      // AFTER the UI above already reflects tab 2 loaded (it's the last
      // step of activateTabById) — poll the actual session.json on disk
      // (this test process has plain Node fs access to userDataDir) rather
      // than racing app1.close() against an in-flight write.
      const sessionFile = join(userDataDir, 'session.json');
      await expect
        .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { tabs: unknown[] }).tabs.length : 0), {
          message: 'expected session.json to record 2 open tabs before closing',
        })
        .toBe(2);

      await app1.close();

      // --- Second launch: SAME userData dir, no E2E-seam. -----------------
      const app2 = await launchAppWithUserData(userDataDir);
      try {
        const page2 = await app2.firstWindow();
        await page2.waitForLoadState('domcontentloaded');

        // Both tabs restored, in the same order, workspace visible (the
        // active one loaded immediately).
        await expect(page2.locator('#tabStrip')).toBeVisible();
        await expect(page2.locator('.tab')).toHaveCount(2);
        await expect(page2.locator('#workspaceScreen')).toBeVisible();

        // Tab 2 (837I, last active before close) is the active one.
        const tab1 = page2.locator('.tab').first();
        const tab2 = page2.locator('.tab').nth(1);
        await expect(tab1).not.toHaveClass(/isActive/);
        await expect(tab2).toHaveClass(/isActive/);
        await expect(tab1).toHaveAttribute('data-tab-status', 'unloaded'); // lazy: not loaded yet
        await expect(tab2).toHaveAttribute('data-tab-status', 'ready'); // the active one WAS loaded

        // The active tab's content genuinely loaded (not just a CSS flag):
        // the 837I's 2-claim stepper and a real rendered canvas.
        await expect(page2.locator('#claimGroup')).toBeVisible();
        await expect(page2.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');
        const canvas2 = await page2.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
        expect(canvas2.width).toBeGreaterThan(0);
        expect(canvas2.height).toBeGreaterThan(0);

        // Activating the lazy tab loads it on demand.
        await tab1.click();
        await expect(tab1).toHaveClass(/isActive/);
        await expect(tab1).toHaveAttribute('data-tab-status', 'ready');
        await expect(page2.locator('#claimGroup')).toBeHidden(); // single-claim JSON
        await expect(page2.locator('#provenanceChipText')).toContainText('JSON');
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('reopening a restored-but-unloaded tab\'s path does not create a duplicate tab or a shared session (docs/AUDIT_BUILD1.md MUST FIX #3)', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-restore-dedupe-userdata-'));
    try {
      // --- First launch: open two files, tab 2 (837I) active, then close. --
      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
      const page1 = await app1.firstWindow();
      await page1.waitForLoadState('domcontentloaded');
      await page1.locator('#welcomeOpenBtn').click(); // tab 1: synthetic-1500.json
      await page1.locator('#openBtn').click(); // tab 2: 837I-multi-claim.dat, becomes active
      await expect(page1.locator('.tab')).toHaveCount(2);

      const sessionFile = join(userDataDir, 'session.json');
      await expect
        .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { tabs: unknown[] }).tabs.length : 0))
        .toBe(2);
      await app1.close();

      // --- Second launch: SAME profile, tab 1 (1500) restores 'unloaded' —
      // never clicked, so it never got its own session. Reopen ITS SAME
      // path via the E2E open seam, exactly as if the user picked it again
      // from the Open dialog or a Recent Files entry, before ever clicking
      // the restored tab itself.
      const app2 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
      try {
        const page2 = await app2.firstWindow();
        await page2.waitForLoadState('domcontentloaded');
        await expect(page2.locator('.tab')).toHaveCount(2);
        const tab1 = page2.locator('.tab').first();
        const tab2 = page2.locator('.tab').nth(1);
        await expect(tab1).toHaveAttribute('data-tab-status', 'unloaded');
        await expect(tab2).toHaveAttribute('data-tab-status', 'ready');

        await page2.locator('#openBtn').click(); // reopens FIXTURE_1500 via the seam

        // Must still be exactly 2 tabs — filling in the existing 'unloaded'
        // placeholder, not minting a THIRD tab with a brand-new session for
        // the same path.
        await expect(page2.locator('.tab')).toHaveCount(2);
        await expect(tab1).toHaveClass(/isActive/);
        await expect(tab1).toHaveAttribute('data-tab-status', 'ready');
        const tab1Session = await tab1.getAttribute('data-tab-session-id');
        const tab2Session = await tab2.getAttribute('data-tab-session-id');
        expect(tab1Session).toBeTruthy();
        expect(tab2Session).toBeTruthy();
        expect(tab1Session).not.toBe(tab2Session); // no shared main-process session

        // Closing tab 1 must NOT take tab 2's session down with it (the
        // shared-sessionId bug's exact failure surface: closeSession has no
        // refcount, so two tabs sharing one id meant closing either killed
        // both).
        await tab1.locator('[data-tab-close]').click();
        await expect(page2.locator('.tab')).toHaveCount(1);
        await expect(page2.locator('.tab').first()).toHaveClass(/isActive/);
        await expect(page2.locator('#claimGroup')).toBeVisible(); // tab 2 (837I) still fully functional
        await expect(page2.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');
        const canvas = await page2.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('a missing/deleted stored path is skipped quietly without breaking startup', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-restore-missing-userdata-'));
    const sourceDir = mkdtempSync(join(tmpdir(), 'claim-viewer-restore-missing-source-'));
    try {
      const willBeDeleted = join(sourceDir, 'will-be-deleted.json');
      cpSync(FIXTURE_1500, willBeDeleted);

      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: willBeDeleted });
      const page1 = await app1.firstWindow();
      await page1.waitForLoadState('domcontentloaded');
      await page1.locator('#welcomeOpenBtn').click();
      await expect(page1.locator('#workspaceScreen')).toBeVisible();
      await expect(page1.locator('.tab')).toHaveCount(1);

      const sessionFile = join(userDataDir, 'session.json');
      await expect
        .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { tabs: unknown[] }).tabs.length : 0), {
          message: 'expected session.json to record 1 open tab before closing',
        })
        .toBe(1);

      await app1.close();

      // The stored path now points at a file that no longer exists.
      unlinkSync(willBeDeleted);

      const app2 = await launchAppWithUserData(userDataDir); // no E2E seam this time
      try {
        const page2 = await app2.firstWindow();
        await page2.waitForLoadState('domcontentloaded');

        // Startup must not fail/hang — the missing stored tab is dropped
        // and the app falls back to the welcome screen (no valid tabs left
        // to restore), never an error screen.
        await expect(page2.locator('#welcomeScreen')).toBeVisible();
        await expect(page2.locator('#errorScreen')).toBeHidden();
        await expect(page2.locator('#tabStrip')).toBeHidden();
        await expect(page2.locator('.tab')).toHaveCount(0);
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  test('About screen shows a real version + build date, File menu surfaces the recent file, and Forget clears session.json + the recent list', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-restore-about-userdata-'));
    try {
      const app = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
      try {
        const page = await app.firstWindow();
        await page.waitForLoadState('domcontentloaded');

        // --- About screen (§2c: version + build stamp) --------------------
        await page.locator('[data-menu-trigger="help"]').click();
        await page.locator('[data-action="about"]').click();
        await expect(page.locator('#aboutOverlay')).toBeVisible();
        // Assert the ACTUAL version from package.json, not merely "non-empty".
        // A non-empty check passed happily while About displayed Electron's
        // own version (43.2.0) instead of the app's — `app.getVersion()`
        // falls back to Electron's package.json when launched via a bare
        // script path, which is how every E2E launches it. The version is now
        // stamped at build time (scripts/write-build-info.mjs); this pins it.
        await expect(page.locator('#aboutVersion')).toContainText(APP_VERSION);
        await expect(page.locator('#aboutBuildDate')).not.toHaveText('Loading…');
        await expect(page.locator('#aboutBuildDate')).not.toHaveText('');
        // §2e: the About screen's own wording must be honest about what's
        // now persisted (README.md carries the same claim).
        await expect(page.locator('#aboutOverlay')).toContainText('file paths');
        await page.locator('#aboutOverlay [data-close="about"]').first().click();
        await expect(page.locator('#aboutOverlay')).toBeHidden();

        // --- Open a file, then confirm it shows up in File -> Recent files
        await page.locator('#welcomeOpenBtn').click();
        await expect(page.locator('#workspaceScreen')).toBeVisible();

        await page.locator('[data-menu-trigger="file"]').click();
        await expect(page.locator('#recentFilesList button.recentFileItem')).toHaveCount(1);
        await expect(page.locator('#recentFilesList button.recentFileItem').first()).toContainText('synthetic-1500.json');
        await page.keyboard.press('Escape'); // close the menu without acting on it

        // --- Forget: confirm dialog, then the store is actually cleared ---
        const sessionFile = join(userDataDir, 'session.json');
        await expect
          .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { recentFiles: unknown[] }).recentFiles.length : 0))
          .toBe(1);

        await page.locator('[data-menu-trigger="file"]').click();
        await page.locator('[data-action="openForgetDialog"]').click();
        await expect(page.locator('#forgetOverlay')).toBeVisible();
        await page.locator('#forgetConfirmBtn').click();
        await expect(page.locator('#forgetOverlay')).toBeHidden();

        await expect
          .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { recentFiles: unknown[] }).recentFiles.length : -1))
          .toBe(0);

        // The still-open tab is untouched by Forget (only the persisted
        // trail is cleared, not the live session).
        await expect(page.locator('.tab')).toHaveCount(1);
        await expect(page.locator('#workspaceScreen')).toBeVisible();

        // File menu's recent list reflects the clear immediately too.
        await page.locator('[data-menu-trigger="file"]').click();
        await expect(page.locator('#recentFilesList button.recentFileItem')).toHaveCount(0);
        await expect(page.locator('#recentFilesEmpty')).toBeVisible();
      } finally {
        await app.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
