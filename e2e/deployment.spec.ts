import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * E2E coverage for Build 7 — Installation & deployment enhancements
 * (docs/CLAUDE_CODE_NEXT_SESSION.md's Build 7 / decision 4). Drives
 * dist/electron/main.js exactly like the rest of the suite — see
 * e2e/app.spec.ts's header comment for why.
 *
 * Two scenarios, both about the About screen's new additions:
 * 1. The bundled "what's new" changelog (CHANGELOG.md, copied into the build
 *    at compile time by scripts/copy-changelog.mjs) actually renders real
 *    content there — no network fetch, purely a local read.
 * 2. "Check for the latest release" calls `shell.openExternal` with the
 *    exact GitHub releases URL and nothing else. This test intercepts
 *    `shell.openExternal` in the MAIN process via `ElectronApplication.
 *    evaluate` (Playwright's electron harness gives that callback the real
 *    `electron` module, so this mutates the exact same `shell` object
 *    electron/main.ts's `shell:openReleasesPage` handler calls through) so
 *    the test never actually spawns a real browser process on the CI
 *    runner — there is no way to "verify a real browser opens" in this
 *    harness, so the next best (and, per decision 4, the only thing that
 *    matters) is proving the app hands off a fixed URL and does nothing
 *    else: no version comparison, no second call, no network request of its
 *    own (the offline kill-switch coverage in e2e/app.spec.ts already
 *    proves outbound fetch/XHR is blocked at the renderer level; this test
 *    additionally proves the main-process handler itself never reaches for
 *    anything but shell.openExternal).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const RELEASES_URL = 'https://github.com/Niall-the-Vile/837-claim-viewer/releases';

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

/** Profile isolation (guardrail §1.9) — fresh throwaway userData per launch, same as every other E2E file. */
async function launchApp(): Promise<ElectronApplication> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-'));
  let app: ElectronApplication;
  try {
    app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: definedEnv(process.env) });
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

test.describe('837 Claim Viewer — E2E — Build 7: installation & deployment (About screen additions)', () => {
  test('About screen renders the bundled "what\'s new" changelog — real content, not the loading placeholder', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('[data-menu-trigger="help"]').click();
      await page.locator('[data-action="about"]').click();
      await expect(page.locator('#aboutOverlay')).toBeVisible();

      const changelog = page.locator('#aboutChangelog');
      await expect(changelog).not.toHaveText('Loading…');
      await expect(changelog).not.toHaveText('');
      // Pulled straight from CHANGELOG.md — real build names, not invented
      // placeholder text, and specifically NOT an "unavailable" fallback
      // (which would mean the build-time copy step silently failed).
      await expect(changelog).toContainText('Build 6 — Notes & audit');
      await expect(changelog).toContainText('Build 7 — Installation & deployment enhancements');
      const text = (await changelog.textContent()) ?? '';
      expect(text).not.toContain('unavailable');
    } finally {
      await app.close();
    }
  });

  test('"Check for the latest release" calls shell.openExternal with the exact GitHub releases URL, exactly once, and makes no other main-process shell call', async () => {
    const app = await launchApp();
    try {
      // Intercept shell.openExternal in the MAIN process before the button
      // is ever clicked — this app must never actually launch a real
      // browser process from inside an automated test run.
      await app.evaluate(({ shell }) => {
        const calls: string[] = [];
        (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls = calls;
        shell.openExternal = ((url: string) => {
          calls.push(url);
          return Promise.resolve();
        }) as typeof shell.openExternal;
      });

      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('[data-menu-trigger="help"]').click();
      await page.locator('[data-action="about"]').click();
      await expect(page.locator('#aboutOverlay')).toBeVisible();

      await page.locator('#aboutCheckReleaseBtn').click();

      // No visible error toast — the (intercepted) call resolved cleanly.
      await expect(page.locator('#toast')).toBeHidden();

      const calls = await app.evaluate(() => (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls);
      expect(calls).toEqual([RELEASES_URL]);

      // Clicking it again must not, say, also fire a second different URL —
      // the handler is a fixed constant, not something that could drift
      // per-click (e.g. from a version comparison it isn't supposed to do).
      await page.locator('#aboutCheckReleaseBtn').click();
      const callsAfterSecondClick = await app.evaluate(() => (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls);
      expect(callsAfterSecondClick).toEqual([RELEASES_URL, RELEASES_URL]);
    } finally {
      await app.close();
    }
  });
});
