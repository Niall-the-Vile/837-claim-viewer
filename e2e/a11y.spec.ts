import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Accessibility checklist for the tab strip (docs/TABS_BUILD_PLAN.md §3a /
 * docs/AUDIT_BUILD1.md coverage gap #3: "e2e/a11y.spec.ts does not exist").
 * Scoped to exactly what the audit's MUST FIX items 4-6 fixed plus a general
 * icon-button sanity check, per the fix-pass instructions this file was
 * written under:
 *   1. `#tabStrip` has `role="tablist"`, each `.tab` has `role="tab"` +
 *      `aria-selected`, and Left/Right/Home/End move the roving tabindex
 *      between tabs with exactly ONE tab in the Tab order at a time
 *      (MUST FIX #4/#5).
 *   2. Closing the active tab (by keyboard) moves focus to the tab that
 *      slides into its place; closing the very last tab moves focus to the
 *      welcome screen's primary "Open a claim file…" button (MUST FIX #6).
 *   3. Every `.iconBtn` (and the tab strip's close button / inspector's
 *      per-row copy button, which are icon-only controls even though they
 *      don't carry that exact class) has a non-empty accessible name.
 *
 * The remaining §3a bullets (F6 region cycling including the tab strip,
 * dialog-invoker focus restore) are pre-existing coverage gaps, not among
 * this audit's 10 CONFIRMED MUST FIX findings — left for a later pass, per
 * this fix pass's explicit scope.
 *
 * Drives the real, unpackaged dist/electron/main.js build, same as
 * e2e/app.spec.ts / e2e/tabs.spec.ts — see those files' header comments for
 * why.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
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

/** Profile isolation (docs/TABS_BUILD_PLAN.md §2e / guardrail §1.9) — mirrors e2e/app.spec.ts's launchApp(); see that file's header comment for the full rationale. */
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

test.describe('837 Claim Viewer — E2E — accessibility (tab strip)', () => {
  test('#tabStrip is a role=tablist with role=tab children, aria-selected reflects the active tab, and exactly one tab is in the Tab order', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);

      await expect(page.locator('#tabStrip')).toHaveAttribute('role', 'tablist');

      const tab1 = page.locator('.tab').first();
      const tab2 = page.locator('.tab').nth(1);
      await expect(tab1).toHaveAttribute('role', 'tab');
      await expect(tab2).toHaveAttribute('role', 'tab');
      await expect(tab1).toHaveAttribute('aria-selected', 'false');
      await expect(tab2).toHaveAttribute('aria-selected', 'true');

      // Roving tabindex: exactly one tab is a Tab stop (tabindex="0"); the
      // other is tabindex="-1" — "only one tab in the tab order"
      // (docs/TABS_BUILD_PLAN.md §3a).
      await expect(tab1).toHaveAttribute('tabindex', '-1');
      await expect(tab2).toHaveAttribute('tabindex', '0');

      // Each tab's own close button must NOT be a second Tab stop (MUST FIX
      // #4) — the strip's roving tabindex covers exactly one element per
      // tab, and Delete/Backspace (below/next test) is the only keyboard
      // path to close one.
      await expect(tab1.locator('[data-tab-close]')).toHaveAttribute('tabindex', '-1');
      await expect(tab2.locator('[data-tab-close]')).toHaveAttribute('tabindex', '-1');

      // Focus the active tab directly, then drive every arrow/Home/End key.
      await tab2.focus();
      await expect(tab2).toBeFocused();

      await page.keyboard.press('ArrowLeft'); // wraps to tab 1, activates it
      await expect(tab1).toHaveClass(/isActive/);
      await expect(tab1).toHaveAttribute('aria-selected', 'true');
      await expect(tab1).toHaveAttribute('tabindex', '0');
      await expect(tab2).toHaveAttribute('tabindex', '-1');
      await expect(tab1).toBeFocused();

      await page.keyboard.press('ArrowRight'); // back to tab 2
      await expect(tab2).toHaveClass(/isActive/);
      await expect(tab2).toBeFocused();

      await page.keyboard.press('Home'); // jumps to tab 1
      await expect(tab1).toHaveClass(/isActive/);
      await expect(tab1).toBeFocused();

      await page.keyboard.press('End'); // jumps to tab 2 (the last one)
      await expect(tab2).toHaveClass(/isActive/);
      await expect(tab2).toBeFocused();

      // Enter/Space activate whatever is already focused (idempotent here —
      // tab 2 is already active/focused, so this is a no-op that must not
      // throw or move focus away).
      await page.keyboard.press('Enter');
      await expect(tab2).toHaveClass(/isActive/);
      await expect(tab2).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test('closing the active tab by keyboard (Delete) moves focus to the adjacent tab; closing the last tab moves focus to the welcome screen\'s primary button', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_1500, FIXTURE_837I].join(';') });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await page.locator('#openBtn').click();
      await expect(page.locator('.tab')).toHaveCount(2);

      const tab2 = page.locator('.tab').nth(1);
      await tab2.focus();
      await expect(tab2).toBeFocused();

      // Delete on the focused (active) tab closes it via the strip's own
      // keydown handler (tabs.ts's initTabStrip — the close button itself is
      // tabIndex=-1, so this is the only keyboard path to close a tab).
      await page.keyboard.press('Delete');
      await expect(page.locator('.tab')).toHaveCount(1);
      const remaining = page.locator('.tab').first();
      await expect(remaining).toHaveClass(/isActive/);
      await expect(remaining).toBeFocused();

      // Close the last remaining tab the same way — focus must land on the
      // welcome screen's primary "Open a claim file…" button, never <body>.
      await page.keyboard.press('Delete');
      await expect(page.locator('.tab')).toHaveCount(0);
      await expect(page.locator('#welcomeScreen')).toBeVisible();
      await expect(page.locator('#welcomeOpenBtn')).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test('every icon-only control has a non-empty accessible name', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Every `.iconBtn` currently rendered (toolbar zoom/page/claim
      // steppers, dialog close buttons, toast dismiss, and — new in this
      // build — each tab's close button, tabs.ts's `.tabClose`).
      const iconBtnNames = await page.locator('.iconBtn').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).getAttribute('aria-label') ?? (el as HTMLElement).textContent?.trim() ?? ''),
      );
      expect(iconBtnNames.length).toBeGreaterThan(0);
      for (const name of iconBtnNames) {
        expect(name.length).toBeGreaterThan(0);
      }

      // Explicitly confirm the tab's own close button by name (new in this
      // build) — dynamic per-tab aria-label, "Close <filename>".
      await expect(page.locator('.tab .tabClose').first()).toHaveAttribute('aria-label', /^Close /);

      // Inspector's per-row copy button (icon-only, not `.iconBtn` by class
      // but the same accessibility contract) and the service-lines group's
      // copy-as-TSV button.
      const rowCopyName = await page.locator('.rowCopyBtn').first().getAttribute('aria-label');
      expect(rowCopyName?.length).toBeGreaterThan(0);
      const linesCopyName = await page.locator('.inspGroupCopyBtn').first().getAttribute('aria-label');
      expect(linesCopyName?.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test('F1 / Ctrl+E while another dialog is already open replaces it instead of stacking a second overlay (docs/AUDIT_BUILD1.md MUST FIX #8)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // shortcuts.ts's F1 handler used to run unconditionally, with no
      // anyOverlayOpen() guard (unlike its neighbours) — pressing it while
      // the export dialog was already open left BOTH overlays non-hidden at
      // once, which then broke Escape's fixed-order resolution and left the
      // export dialog's Tab trap live behind the shortcuts sheet.
      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportOverlay')).toBeVisible();
      await page.keyboard.press('F1');
      await expect(page.locator('#shortcutsOverlay')).toBeVisible();
      await expect(page.locator('#exportOverlay')).toBeHidden(); // must be replaced, not stacked

      await page.keyboard.press('Escape');
      await expect(page.locator('#shortcutsOverlay')).toBeHidden();
      await expect(page.locator('#exportOverlay')).toBeHidden();

      // Same bug, opposite direction: shortcuts.ts's Ctrl+E ('e' case in the
      // ctrlOrCmd switch) opened the export dialog with no guard either.
      await page.keyboard.press('F1');
      await expect(page.locator('#shortcutsOverlay')).toBeVisible();
      await page.keyboard.press('Control+e');
      await expect(page.locator('#exportOverlay')).toBeVisible();
      await expect(page.locator('#shortcutsOverlay')).toBeHidden();
    } finally {
      await app.close();
    }
  });
});
