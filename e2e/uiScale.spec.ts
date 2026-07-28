import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * View menu's "UI text scale" (docs/UI_REQUIREMENTS_v3_queued_features.md §9
 * / docs/BUILD_QUEUE.md Build 2.0). Filed *critical* by the low-vision
 * reviewer (Windows display scaling at 175% breaks this app's layout).
 *
 * Covers exactly the DoD's four asks:
 *  1. The setting applies (cycles 100 -> 125 -> 150 -> 175 -> 100, chrome
 *     visibly resizes, the menu's value label reflects it).
 *  2. It persists across a relaunch (session.json's `uiScale`, via the SAME
 *     two-launch `launchAppWithUserData` pattern e2e/session-restore.spec.ts
 *     uses — see that file's header comment for why this is the one file
 *     allowed to reuse a userData dir across two launches).
 *  3. Layout survives 175% — verified PROGRAMMATICALLY (real
 *     `scrollWidth`/`clientWidth`/`getBoundingClientRect` reads against the
 *     actual built app), never by eyeballing a screenshot: no chrome
 *     container overflows itself, no two toolbar controls' bounding boxes
 *     intersect, and the export dialog stays fully inside the real window.
 *  4. Per-tab PDF zoom is completely independent of UI scale in both
 *     directions: cycling UI scale never changes `#zoomLabel` (nor the
 *     `#pdfCanvas` pixel buffer, i.e. it never gets silently re-rendered),
 *     and zooming the PDF never changes `--ui-scale`/the menu's value label.
 *
 * Drives the real, unpackaged dist/electron/main.js build, same as every
 * other E2E file — see e2e/app.spec.ts's header comment for why.
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

/** Profile isolation (docs/TABS_BUILD_PLAN.md §2e / guardrail §1.9) — mirrors e2e/app.spec.ts's launchApp(). */
async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-uiscale-userdata-'));
  let app: ElectronApplication;
  try {
    app = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: { ...definedEnv(process.env), ...env } });
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

/** Mirrors e2e/session-restore.spec.ts's helper of the same name — the caller owns userDataDir's full lifecycle since the point is it survives between two launches. */
async function launchAppWithUserData(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: { ...definedEnv(process.env), ...env } });
}

/** Opens the View menu and clicks the "UI text scale" action once — one step of the 100 -> 125 -> 150 -> 175 -> 100 cycle. */
async function clickCycleUiScale(page: Page): Promise<void> {
  await page.locator('[data-menu-trigger="view"]').click();
  await page.locator('[data-action="cycleUiScale"]').click();
}

async function currentUiScaleVar(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());
}

test.describe('837 Claim Viewer — E2E — UI text scale (docs/UI_REQUIREMENTS_v3_queued_features.md §9)', () => {
  test('cycles 100% -> 125% -> 150% -> 175% -> 100% via the View menu, updating the menu label and --ui-scale each step', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      expect(await currentUiScaleVar(page)).toBe('1');

      const steps: Array<{ label: string; cssVar: string }> = [
        { label: '125%', cssVar: '1.25' },
        { label: '150%', cssVar: '1.5' },
        { label: '175%', cssVar: '1.75' },
        { label: '100%', cssVar: '1' },
      ];
      for (const step of steps) {
        await clickCycleUiScale(page);
        await expect(page.locator('#uiScaleValueLabel')).toHaveText(step.label);
        expect(await currentUiScaleVar(page)).toBe(step.cssVar);
      }
    } finally {
      await app.close();
    }
  });

  test('persists across a relaunch: cycled to 175% in one launch, still 175% (no E2E seam) in the next', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-uiscale-restore-userdata-'));
    try {
      const app1 = await launchAppWithUserData(userDataDir);
      const page1 = await app1.firstWindow();
      await page1.waitForLoadState('domcontentloaded');

      await clickCycleUiScale(page1); // 125
      await clickCycleUiScale(page1); // 150
      await clickCycleUiScale(page1); // 175
      await expect(page1.locator('#uiScaleValueLabel')).toHaveText('175%');

      // settings:saveUiScale's IPC round trip happens after the label already
      // reflects it — poll session.json on disk rather than racing app1.close()
      // against an in-flight write (same discipline as e2e/session-restore.spec.ts).
      const sessionFile = join(userDataDir, 'session.json');
      await expect
        .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { uiScale?: number }).uiScale : undefined), {
          message: 'expected session.json to record uiScale:175 before closing',
        })
        .toBe(175);

      await app1.close();

      // --- Second launch: SAME profile, no E2E seam — restore is driven
      // purely by session:getRestoreState, exactly like session-restore.spec.ts.
      const app2 = await launchAppWithUserData(userDataDir);
      try {
        const page2 = await app2.firstWindow();
        await page2.waitForLoadState('domcontentloaded');

        await expect(page2.locator('#uiScaleValueLabel')).toHaveText('175%');
        expect(await currentUiScaleVar(page2)).toBe('1.75');

        // One more cycle from a restored 175% wraps back to 100%, proving the
        // restored value is the SAME live state cycleUiScale operates on, not
        // just a display artifact.
        await clickCycleUiScale(page2);
        await expect(page2.locator('#uiScaleValueLabel')).toHaveText('100%');
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('175% layout survives: no chrome container overflows itself, no toolbar controls overlap, key controls and the export dialog stay inside the real window', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#workspaceScreen').waitFor({ state: 'visible' });

      await clickCycleUiScale(page); // 125
      await clickCycleUiScale(page); // 150
      await clickCycleUiScale(page); // 175
      await expect(page.locator('#uiScaleValueLabel')).toHaveText('175%');

      // --- No text-bearing chrome container clips its own content. A
      // tolerance of 1px absorbs float rounding from `zoom`'s own internal
      // pixel snapping (see style.css's --ui-scale comment) — never a
      // license to actually clip.
      const overflowIds = ['inspector', 'inspectorBody', 'toolbar', 'menubar', 'titlebar', 'statusBar', 'tabStrip'];
      for (const id of overflowIds) {
        const overflow = await page.locator(`#${id}`).evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(overflow.scrollWidth, `#${id} must not overflow horizontally at 175%`).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }

      // --- No two toolbar controls' bounding boxes intersect (the DoD's
      // literal "no two sibling control bounding boxes intersect" check).
      const toolbarBoxes = await page.evaluate(() => {
        const toolbar = document.getElementById('toolbar')!;
        const controls = Array.from(toolbar.querySelectorAll<HTMLElement>('button, .navValue, .groupLabel'));
        return controls.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.id || el.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        });
      });
      function intersects(a: { x: number; y: number; right: number; bottom: number }, b: { x: number; y: number; right: number; bottom: number }): boolean {
        return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
      }
      for (let i = 0; i < toolbarBoxes.length; i++) {
        for (let j = i + 1; j < toolbarBoxes.length; j++) {
          const a = toolbarBoxes[i]!;
          const b = toolbarBoxes[j]!;
          expect(intersects(a, b), `toolbar controls "${a.id}" and "${b.id}" must not overlap at 175% (${JSON.stringify(a)} vs ${JSON.stringify(b)})`).toBe(false);
        }
      }

      // --- Key controls remain fully within the actual window viewport —
      // not just "not overlapping", genuinely reachable/clickable on screen.
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      for (const selector of ['#openBtn', '#exportBtn', '#themeToggleBtn', '#inspectorToggleBtn']) {
        const rect = await page.locator(selector).evaluate((el) => el.getBoundingClientRect());
        expect(rect.x, `${selector} left edge inside the window at 175%`).toBeGreaterThanOrEqual(0);
        expect(rect.right, `${selector} right edge inside the window at 175%`).toBeLessThanOrEqual(viewport.width + 1);
      }

      // --- Dialogs: the export dialog stays fully inside the real window
      // and doesn't clip its own content, at 175%.
      await page.locator('[data-menu-trigger="file"]').click();
      await page.locator('[data-action="export"]').click();
      await page.locator('#exportOverlay').waitFor({ state: 'visible' });
      const dialogInfo = await page.evaluate(() => {
        const dialog = document.querySelector('#exportOverlay .dialog')!;
        const rect = dialog.getBoundingClientRect();
        return { rect, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, windowW: window.innerWidth, windowH: window.innerHeight };
      });
      expect(dialogInfo.scrollWidth, 'export dialog must not clip its own content at 175%').toBeLessThanOrEqual(dialogInfo.clientWidth + 1);
      expect(dialogInfo.rect.x, 'export dialog left edge inside the window at 175%').toBeGreaterThanOrEqual(0);
      expect(dialogInfo.rect.right, 'export dialog right edge inside the window at 175%').toBeLessThanOrEqual(dialogInfo.windowW + 1);
      expect(dialogInfo.rect.y, 'export dialog top edge inside the window at 175%').toBeGreaterThanOrEqual(0);
      expect(dialogInfo.rect.bottom, 'export dialog bottom edge inside the window at 175%').toBeLessThanOrEqual(dialogInfo.windowH + 1);
      await page.keyboard.press('Escape');
      await page.locator('#exportOverlay').waitFor({ state: 'hidden' });

      // --- The TALLER dialogs, which the export dialog (the shortest one)
      // never exercised. The keyboard-shortcuts sheet is 22 rows over 4
      // groups and at 175% measures taller than the window: Build 2 gave
      // .dialog a scale-aware max-width but no max-height, inside a
      // non-scrolling overlay under `#app { overflow: hidden }`, so it
      // overflowed symmetrically and put its own titlebar — carrying the
      // only close button — above y=0 with no scrollbar (docs/AUDIT_BUILD2.md).
      const tallDialogs: Array<{ overlayId: string; action: string; name: string }> = [
        { overlayId: '#shortcutsOverlay', action: 'shortcuts', name: 'shortcuts' },
        { overlayId: '#aboutOverlay', action: 'about', name: 'about' },
      ];
      for (const { overlayId, action, name } of tallDialogs) {
        await page.locator('[data-menu-trigger="help"]').click();
        await page.locator(`[data-action="${action}"]`).click();
        await page.locator(overlayId).waitFor({ state: 'visible' });

        const info = await page.evaluate((sel) => {
          const dialog = document.querySelector(`${sel} .dialog`)!;
          const rect = dialog.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, windowW: window.innerWidth, windowH: window.innerHeight };
        }, overlayId);

        expect(info.top, `${name} dialog top edge inside the window at 175%`).toBeGreaterThanOrEqual(-1);
        expect(info.bottom, `${name} dialog bottom edge inside the window at 175%`).toBeLessThanOrEqual(info.windowH + 1);
        expect(info.left, `${name} dialog left edge inside the window at 175%`).toBeGreaterThanOrEqual(-1);
        expect(info.right, `${name} dialog right edge inside the window at 175%`).toBeLessThanOrEqual(info.windowW + 1);

        // The close button must be on screen — Esc alone is not an
        // acceptable sole means of dismissal.
        const closeRect = await page.locator(`${overlayId} .dialogTitlebar button`).first().evaluate((el) => el.getBoundingClientRect());
        expect(closeRect.top, `${name} dialog close button must be visible at 175%`).toBeGreaterThanOrEqual(-1);
        expect(closeRect.bottom, `${name} dialog close button must be within the window at 175%`).toBeLessThanOrEqual(info.windowH + 1);

        await page.keyboard.press('Escape');
        await page.locator(overlayId).waitFor({ state: 'hidden' });
      }
    } finally {
      await app.close();
    }
  });

  test('175%: the preview-pane state screens scale too', async () => {
    // Build 2 applied `zoom: var(--ui-scale)` to the nine chrome regions §9
    // enumerates and to nothing else, so #welcomeScreen, #loadingScreen,
    // #errorScreen and #chipRow rendered byte-identically at 100% and 175%.
    // The app's first screen and every parse-error message are precisely the
    // text the feature exists to enlarge (docs/AUDIT_BUILD2.md).
    const app = await launchApp({});
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeScreen').waitFor({ state: 'visible' });

      const titleAt100 = await page.locator('.welcomeTitle').evaluate((el) => el.getBoundingClientRect().height);

      await clickCycleUiScale(page); // 125
      await clickCycleUiScale(page); // 150
      await clickCycleUiScale(page); // 175
      await expect(page.locator('#uiScaleValueLabel')).toHaveText('175%');

      const titleAt175 = await page.locator('.welcomeTitle').evaluate((el) => el.getBoundingClientRect().height);
      expect(titleAt175, 'the welcome title must actually grow at 175%').toBeGreaterThan(titleAt100 * 1.5);

      // ...and must still fit the window it just grew inside of.
      const box = await page.evaluate(() => {
        const card = document.querySelector('.welcomeCard')!;
        const r = card.getBoundingClientRect();
        return { left: r.left, right: r.right, windowW: window.innerWidth };
      });
      expect(box.left, 'welcome card left edge inside the window at 175%').toBeGreaterThanOrEqual(-1);
      expect(box.right, 'welcome card right edge inside the window at 175%').toBeLessThanOrEqual(box.windowW + 1);

      const welcomeOverflow = await page.locator('#welcomeScreen').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(welcomeOverflow.scrollWidth, '#welcomeScreen must not overflow horizontally at 175%').toBeLessThanOrEqual(welcomeOverflow.clientWidth + 1);
    } finally {
      await app.close();
    }
  });

  test('fitWidth yields the same PDF zoom% at 175% as at 100% (proves the fit math needs no scale correction — docs/UI_REQUIREMENTS_v3_queued_features.md §9 mandatory sub-task 2)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#workspaceScreen').waitFor({ state: 'visible' });

      // Collapse the inspector so #previewPane (and #pdfScroll within it) is
      // the ONLY #body child at both scales — otherwise the inspector's own
      // (correct, intended) growth at 175% would change #pdfScroll's
      // available WIDTH too, confounding this specific isolated check. That
      // interaction is exercised deliberately in the layout-survival test
      // above; this test isolates just the fit-math invariant.
      await page.locator('#inspectorToggleBtn').click();
      await expect(page.locator('#inspector')).toHaveClass(/collapsed/);
      // #inspector's width collapse is an animated CSS transition (style.css:
      // `transition: width 200ms ease-out, …`), not instant — wait for it to
      // finish before measuring, rather than racing it (an earlier version
      // of this test measured mid-transition and got a flaky, wrong fitWidth
      // result because #pdfScroll's available width hadn't settled yet).
      await expect
        .poll(async () => page.locator('#inspector').evaluate((el) => getComputedStyle(el).width))
        .toBe('0px');

      await page.locator('#fitWidthBtn').click();
      const zoomAt100 = await page.locator('#zoomLabel').textContent();

      await clickCycleUiScale(page); // 125
      await clickCycleUiScale(page); // 150
      await clickCycleUiScale(page); // 175
      await expect(page.locator('#uiScaleValueLabel')).toHaveText('175%');

      // Re-issuing fitWidth (a manual user action) at the new scale must
      // land on the exact same zoom% — #pdfScroll's real available width is
      // unchanged (inspector stays collapsed, window size unchanged, and
      // #pdfScroll/#pdfCanvas are never zoomed — see preview.ts's
      // availableViewport doc comment), so the fit ratio the SAME math
      // produces must be identical too.
      await page.locator('#fitWidthBtn').click();
      const zoomAt175 = await page.locator('#zoomLabel').textContent();
      expect(zoomAt175).toBe(zoomAt100);
    } finally {
      await app.close();
    }
  });

  test('per-tab PDF zoom and UI scale are completely independent, in both directions', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#workspaceScreen').waitFor({ state: 'visible' });

      // --- Direction 1: cycling UI scale must not touch the PDF's zoom%,
      // its canvas pixel buffer (i.e. it's never silently re-rendered), or
      // its zoom mode.
      const before = await page.evaluate(() => {
        const canvas = document.getElementById('pdfCanvas') as HTMLCanvasElement;
        return { zoomLabel: document.getElementById('zoomLabel')!.textContent, canvasW: canvas.width, canvasH: canvas.height };
      });

      await clickCycleUiScale(page); // 125
      await clickCycleUiScale(page); // 150
      await clickCycleUiScale(page); // 175
      await expect(page.locator('#uiScaleValueLabel')).toHaveText('175%');

      const after = await page.evaluate(() => {
        const canvas = document.getElementById('pdfCanvas') as HTMLCanvasElement;
        return { zoomLabel: document.getElementById('zoomLabel')!.textContent, canvasW: canvas.width, canvasH: canvas.height };
      });
      expect(after.zoomLabel, 'PDF zoom% must be unaffected by a UI scale change').toBe(before.zoomLabel);
      expect(after.canvasW, "#pdfCanvas pixel buffer width must be unaffected by a UI scale change (it wasn't re-rendered)").toBe(before.canvasW);
      expect(after.canvasH, "#pdfCanvas pixel buffer height must be unaffected by a UI scale change (it wasn't re-rendered)").toBe(before.canvasH);

      // --- Direction 2: zooming the PDF must not touch --ui-scale / the
      // View menu's value label.
      expect(await currentUiScaleVar(page)).toBe('1.75');
      await page.locator('#zoomInBtn').click();
      await page.locator('#zoomInBtn').click();
      expect(await currentUiScaleVar(page), 'UI scale must be unaffected by a PDF zoom change').toBe('1.75');
      await expect(page.locator('#uiScaleValueLabel')).toHaveText('175%');
    } finally {
      await app.close();
    }
  });
});
