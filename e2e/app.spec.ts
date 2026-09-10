import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { renderedCanvasSize, UNRENDERED_CANVAS_WIDTH } from './support/canvas.js';

/**
 * End-to-end test of the actual packaged behavior: a real Electron process,
 * a real (sandboxed, contextIsolation:true) renderer, a real preload
 * bridge, and the real offline kill-switch — none of that is exercised by
 * the vitest unit/invariant suites, which only ever call the renderer
 * functions and IPC handler logic directly in Node.
 *
 * Drives dist/electron/main.js (the `npm run build` output), NOT the
 * electron-builder --dir package under release/ — same code, same
 * BrowserWindow/webPreferences/CSP/kill-switch setup (see
 * electron/main.ts's IS_DEV check, which is keyed off
 * dist/renderer/index.html existing, exactly what `npm run build` produces)
 * but without paying for a full asar pack on every run. `npm run verify`
 * runs `npm run build` immediately before `playwright test` for this
 * reason — see package.json.
 *
 * Never drives the native OS open/save file dialogs (Playwright can't).
 * Instead this relies on the guarded, env-gated E2E seam already in
 * electron/main.ts's `dialog:openClaim` / `dialog:exportPdf` handlers:
 * CLAIM_VIEWER_E2E_OPEN / CLAIM_VIEWER_E2E_SAVE substitute a fixed path for
 * the dialog result, but every line of code after that point (readFile,
 * loadClaims, renderClaim, writeFileAtomic) is the exact same path a real
 * user's Open/Export click runs. Both env vars are `undefined` unless a
 * test explicitly sets them, so the seam is provably inert for a normal
 * launch (see the "welcome screen" test below, which launches with neither
 * set).
 *
 * STATE-SCREEN VISIBILITY (was a known failure, now fixed): the
 * `expect(await visibleStateScreens(page)).toEqual([...])` checks below
 * assert that exactly one `.stateScreen` is laid out at a time. They used to
 * fail — confirmed via `getComputedStyle` in the live built app — because
 * src/renderer/index.html's 4 `.stateScreen` elements
 * (#welcomeScreen/#loadingScreen/#errorScreen/#workspaceScreen) each had
 * their own ID-selector rule in src/renderer/style.css
 * (`#welcomeScreen { display: flex; ... }`, etc.) which, because an ID
 * selector always outweighs a class+attribute selector in CSS specificity,
 * beat `.stateScreen[hidden] { display: none; }` regardless of source order.
 * The practical effect: setting `.hidden = true` (what
 * src/renderer/main.ts's showScreen() does) never actually hid a state
 * screen; all 4 stayed laid out (stacked vertically inside #previewPane) at
 * once. Fixed in src/renderer/style.css by a global
 * `[hidden] { display: none !important; }` reset that makes the attribute's
 * semantic win over any author `display` rule (this also cured the sibling
 * bug where the File/View/Help `.menuPanel` dropdowns stayed hit-testable
 * while `hidden` and intercepted toolbar clicks). These are now plain
 * `expect()` and pass; do not loosen them — a regression would re-stack the
 * screens and this harness exists to catch exactly that.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const OPEN_FIXTURE = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');

function requireBuiltApp(): void {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`Built app not found at "${MAIN_ENTRY}". Run "npm run build" before the e2e suite (npm run verify does this for you).`);
  }
}

/** `process.env`'s values are `string | undefined` (a var can be declared-but-unset); Playwright's `env` option requires plain strings, so undefined entries are dropped rather than passed through. */
function definedEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * PROFILE ISOLATION (docs/TABS_BUILD_PLAN.md §2e's hard prerequisite / guardrail
 * §1.9): every E2E launch must get its own throwaway `userData` directory, never
 * the developer's real `%APPDATA%` profile. Once session-restore starts writing
 * `session.json` there, a second launch against the real profile would restore a
 * previously-open tab and break this file's `visibleStateScreens` assertions
 * (which assert exactly `['welcomeScreen']` on a fresh launch) — for a
 * test-harness reason, not a real defect. `launchApp()` therefore creates a fresh
 * `mkdtempSync` directory per call, passes it via `--user-data-dir=<dir>`
 * (Electron's own CLI switch — see `app.getPath('userData')` in
 * electron/main.ts, which resolves relative to it), and removes it once the
 * caller closes the returned `ElectronApplication` (wrapping `.close()` in a
 * try/finally so callers don't need to change their own `finally { await
 * app.close(); }` blocks to get the cleanup). No test in this file (or any
 * other `e2e/*.spec.ts`) may bypass this and launch with only `[MAIN_ENTRY]`.
 */
async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-'));
  // eslint-disable-next-line no-console -- deliberate: makes per-launch profile isolation observable in `npx playwright test` output (proof step for TABS_BUILD_PLAN.md §2e's prerequisite), not left-over debugging.
  console.log(`[e2e profile isolation] launching with fresh userData dir: ${userDataDir}`);

  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
      // Merge onto the real process.env (Playwright replaces it outright if
      // given a partial object) — the app still needs PATH/TEMP/etc. to run
      // normally; only CLAIM_VIEWER_E2E_OPEN/SAVE are ever added on top.
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

/**
 * Variant of `launchApp()` for tests that need TWO launches to share ONE
 * `userData` directory — e.g. a future session-restore test: open a file,
 * close the app, relaunch against the same directory, and assert the tab
 * comes back. Unlike `launchApp()`, this does not create or remove the
 * directory itself — the CALLER owns that directory's full lifecycle
 * (typically `mkdtempSync` before the first launch, `rmSync` in a `finally`
 * after the last `app.close()`), since the whole point is that the directory
 * survives between the two launches.
 */
async function launchAppWithUserData(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env: { ...definedEnv(process.env), ...env },
  });
}

/** The 4 `.stateScreen` ids in src/renderer/index.html's #previewPane. */
const STATE_SCREEN_IDS = ['welcomeScreen', 'loadingScreen', 'errorScreen', 'workspaceScreen'] as const;

/** Reads which of the 4 state screens are actually visible right now (via the same `[hidden]` attribute src/renderer/main.ts's showScreen() toggles), for an exact "only these are shown" assertion rather than checking each one individually and hoping nothing else slipped through. */
async function visibleStateScreens(page: Page): Promise<string[]> {
  const visible: string[] = [];
  for (const id of STATE_SCREEN_IDS) {
    if (await page.locator(`#${id}`).isVisible()) visible.push(id);
  }
  return visible;
}

test.describe('837 Claim Viewer — E2E', () => {
  test('launches to the welcome screen, shows the offline indicator, exposes exactly the frozen claimApi surface, and blocks outbound network requests', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Initial launch: exactly #welcomeScreen, nothing else. See this
      // file's header comment for the state-screen visibility bug this
      // guards (fixed in src/renderer/style.css).
      await expect(page.locator('#welcomeScreen')).toBeVisible();
      expect(await visibleStateScreens(page)).toEqual(['welcomeScreen']);

      // Offline indicator (status bar, always shown regardless of screen).
      await expect(page.locator('.offlineIndicator')).toBeVisible();
      await expect(page.locator('.offlineIndicator')).toContainText('Offline');

      // The frozen contextBridge surface — exactly these functions, see
      // electron/preload.ts's `claimApi`. Anything more would be a bridge
      // leak; anything less would break the renderer. (getPathForFile drives
      // drag-and-drop; openExport opens the exported file's folder/PDF;
      // closeSession drops a tab's parsed claims from main-process memory —
      // added in the tabs build, docs/TABS_BUILD_PLAN.md §2 / rule 7b.
      // getAppInfo/getSessionRestoreState/saveSession/forgetSession added by
      // §2c's version/build stamp and §2e's session restore + recent files.
      // saveUiScale added by Build 2.0's UI text scale, docs/UI_REQUIREMENTS_v3_queued_features.md §9.
      // setFieldOverride/revertFieldOverride/clearOverridesForClaim/
      // discardStaleOverrides added by the editable-fields feature,
      // docs/EDITABLE_FIELDS_DESIGN.md.)
      const apiKeys = await page.evaluate(() => Object.keys((window as unknown as { claimApi: object }).claimApi).sort());
      expect(apiKeys).toEqual([
        'clearOverridesForClaim',
        'closeSession',
        'discardStaleOverrides',
        'exportPdf',
        'forgetSession',
        'getAppInfo',
        'getDetail',
        'getPathForFile',
        'getPdf',
        'getSessionRestoreState',
        'openClaim',
        'openExport',
        'revertFieldOverride',
        'saveSession',
        'saveUiScale',
        'setFieldOverride',
      ]);

      // Offline kill-switch (electron/main.ts's installOfflineKillSwitch):
      // an outbound fetch to a real external host must never resolve.
      const fetchOutcome = await page.evaluate(async () => {
        try {
          await fetch('http://example.com');
          return 'resolved';
        } catch {
          return 'blocked';
        }
      });
      expect(fetchOutcome).toBe('blocked');
    } finally {
      await app.close();
    }
  });

  test('open -> preview -> export: exactly one state screen is visible after loading a claim, the canvas renders, and the exported file is a real PDF', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-'));
    const savePath = join(saveDir, 'export.pdf');

    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: OPEN_FIXTURE, CLAIM_VIEWER_E2E_SAVE: savePath });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Sanity: still starts on the welcome screen — setting the env vars
      // alone must not auto-open anything (the seam only fires once the
      // renderer actually calls claimApi.openClaim()). See this file's
      // header comment for the state-screen visibility bug this guards
      // (fixed in src/renderer/style.css).
      expect(await visibleStateScreens(page)).toEqual(['welcomeScreen']);

      await page.locator('#welcomeOpenBtn').click();

      // After the E2E-seam "open" resolves: exactly #workspaceScreen, and
      // specifically NOT #welcomeScreen/#loadingScreen/#errorScreen.
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      expect(await visibleStateScreens(page)).toEqual(['workspaceScreen']);

      // Preview: the pdf.js canvas actually has pixels (a real render, not
      // just an empty <canvas>). `> 0` used to be the assertion here, which
      // an UNrendered canvas satisfies — it reports the 300x150 HTML default,
      // not 0x0 (docs/AUDIT_BUILD2.md).
      const canvasSize = await renderedCanvasSize(page);
      expect(canvasSize.width).not.toBe(UNRENDERED_CANVAS_WIDTH);
      expect(canvasSize.height).toBeGreaterThan(0);

      // Export: opens the dialog, confirms, and the E2E-seam "save" path
      // (electron/main.ts's dialog:exportPdf handler) writes straight to
      // savePath instead of showing a native save dialog.
      //
      // A real Playwright .click() here (mouse-event hit-testing, exactly
      // like a user's click) doubles as regression coverage for the sibling
      // `.menuPanel` bug: those File/View/Help dropdown panels used to stay
      // laid out and hit-testable even while `hidden` (their `display: flex`
      // rule had no `[hidden]` override), so they sat over part of the
      // toolbar and Playwright refused this click with "intercepts pointer
      // events" at #exportBtn's coordinates. The global
      // `[hidden] { display: none !important; }` reset in
      // src/renderer/style.css removed them from layout, so an unobstructed
      // real click now lands on #exportBtn — if this ever regresses to the
      // old `.evaluate(el => el.click())` workaround being necessary, the
      // menuPanel hiding has broken again.
      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportOverlay')).toBeVisible();
      await page.locator('#exportConfirmBtn').click();
      // confirmExport() closes the overlay itself once claimApi.exportPdf resolves.
      await expect(page.locator('#exportOverlay')).toBeHidden();

      // docs/TABS_BUILD_PLAN.md §3c ("the toast backslash question"): a
      // screenshot once showed the export-success toast rendering the saved
      // path without backslashes (`C:UsersNiall Yoder...`). The message is
      // built as `Exported to ${path}` (src/renderer/overlays.ts's
      // confirmExport) and assigned via `toastMessageEl.textContent =
      // message`, which cannot strip or re-encode characters — so if the
      // backslashes are genuinely missing anywhere along the way (IPC
      // round-trip, template literal, DOM assignment), this exact-string
      // assertion catches it. It doesn't pass: this is proof the string
      // itself is intact end-to-end; whether the GLYPHS render is a font/
      // display question, verified separately via
      // docs/screenshots/toast-export.png (e2e/screenshots.spec.ts).
      await expect(page.locator('#toast')).toBeVisible();
      const toastText = await page.locator('#toastMessage').textContent();
      expect(toastText).toContain('\\');
      expect(toastText).toBe(`Exported to ${savePath}`);

      await expect.poll(() => existsSync(savePath), { message: `expected a PDF at ${savePath}` }).toBe(true);
      const exported = readFileSync(savePath);
      expect(exported.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });
});
