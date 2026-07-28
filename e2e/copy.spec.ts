import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * E2E coverage for the clipboard/copy suite (docs/TABS_BUILD_PLAN.md §2f
 * items 1-4): the real, sandboxed renderer's `navigator.clipboard` calls,
 * not just the pure formatters (see test/clipboardFormat.test.ts for
 * those). Drives dist/electron/main.js exactly like e2e/app.spec.ts /
 * e2e/tabs.spec.ts — see app.spec.ts's header comment for why.
 *
 * Clipboard verification: `page.evaluate(() => navigator.clipboard.readText())`
 * works against this Electron build (verified empirically while writing
 * this file — no `session.setPermissionRequestHandler` is registered in
 * electron/main.ts, so Electron's default-allow applies to both
 * clipboard-write and clipboard-read for the app's own BrowserWindow). Every
 * test below reads the clipboard back and asserts its exact/contained text,
 * rather than falling back to a DOM/toast proxy.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
const FIXTURE_MANY_WARNINGS = join(repoRoot, 'test', 'fixtures', '837P-many-warnings.json');

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

/** The OS clipboard on Windows normalizes `\n` to `\r\n` on write (confirmed empirically while writing this file — the formatters themselves join with plain `\n`, see clipboardFormat.ts); normalize back before comparing so this file's expectations match the formatter's actual `\n`-joined output regardless of platform. */
function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n/g, '\n');
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

test.describe('837 Claim Viewer — E2E — clipboard/copy suite', () => {
  test('copy service lines as TSV: inspector button and Ctrl+Shift+C both put the same TSV on the clipboard', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Button on the service-lines group header (visible even collapsed —
      // it lives in <summary>, not the collapsible body).
      await page.locator('.inspGroupCopyBtn').click();
      const viaButton = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      const expectedTsv = [
        'Line\tDOS\tPOS/Rev\tCPT/HCPCS\tModifiers\tUnits\tCharge\tDx Pointers\tRendering NPI',
        '1\t2026-05-07\t11\t99213\t\t1\t100.00\tA\t1234567893',
        '2\t2026-05-07\t11\t73721\t26\t1\t40.00\tAB\t1234567893',
      ].join('\n');
      expect(viaButton).toBe(expectedTsv);
      await expect(page.locator('#toastMessage')).toHaveText('Service lines copied to the clipboard.');

      // Clear the clipboard, then prove Ctrl+Shift+C (shortcuts.ts) reaches
      // the exact same formatter/clipboard path.
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press('Control+Shift+C');
      const viaShortcut = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(viaShortcut).toBe(expectedTsv);
    } finally {
      await app.close();
    }
  });

  test('click-to-copy on an inspector field row copies its raw value, and Ctrl+C does the same for the focused row', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Patient group is open by default (inspector.ts's renderInspector) —
      // find its "Account no." row and click its hover/focus copy icon.
      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await expect(accountRow).toBeVisible();
      await accountRow.locator('.rowCopyBtn').click();
      const viaClick = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(viaClick).toBe('ACCT-0001');
      await expect(page.locator('#toastMessage')).toHaveText('Account no. copied to the clipboard.');

      // Keyboard path: focus the row directly (roving tabindex — the row
      // itself is the tab stop, docs/TABS_BUILD_PLAN.md §2f item 2 / §3a)
      // and press Ctrl+C.
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await accountRow.focus();
      await page.keyboard.press('Control+c');
      const viaKeyboard = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(viaKeyboard).toBe('ACCT-0001');
    } finally {
      await app.close();
    }
  });

  test('Ctrl+Shift+C with focus on an inspector row copies the service-lines TSV exactly once, not the row\'s own value (docs/AUDIT_BUILD1.md MUST FIX #7)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // inspector.ts's row-level keydown handler used to match Ctrl+C AND
      // Ctrl+Shift+C (no `!event.shiftKey` guard) with no stopPropagation,
      // so this chord fired the row's own single-value copy here, THEN
      // bubbled to the window dispatcher (shortcuts.ts), which copied the
      // whole service-lines TSV on top of it — two clipboard writes and two
      // toasts for one keypress. e2e/copy.spec.ts's existing Ctrl+Shift+C
      // test missed this because it presses the chord with focus on a
      // <summary>-hosted button, where closest('.inspRow') is null.
      //
      // Checking only the FINAL clipboard/toast state doesn't reliably catch
      // this: both writeText() calls fire synchronously in the same bubble
      // dispatch and (empirically) resolve in call order, so the second
      // (correct) TSV write happens to overwrite the first every time in
      // this environment — the audit's own "ordering-dependent" caveat.
      // Counting actual navigator.clipboard.writeText() invocations is the
      // only reliable signal that it fired once, not twice.
      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await accountRow.focus();
      await page.evaluate(() => {
        const original = navigator.clipboard.writeText.bind(navigator.clipboard);
        (window as unknown as { __writeCount: number }).__writeCount = 0;
        navigator.clipboard.writeText = (text: string) => {
          (window as unknown as { __writeCount: number }).__writeCount += 1;
          return original(text);
        };
      });

      await page.keyboard.press('Control+Shift+C');

      const clipboard = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(clipboard).not.toBe('ACCT-0001'); // must not be the focused row's own copy
      expect(clipboard).toContain('Line\tDOS\tPOS/Rev\tCPT/HCPCS'); // must be the TSV
      await expect(page.locator('#toastMessage')).toHaveText('Service lines copied to the clipboard.');
      const writeCount = await page.evaluate(() => (window as unknown as { __writeCount: number }).__writeCount);
      expect(writeCount).toBe(1); // the discriminating assertion: exactly one copy for one keypress
    } finally {
      await app.close();
    }
  });

  test('copy claim summary and copy warnings+reconciliation put the expected plain text on the clipboard', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.locator('#copySummaryBtn').click();
      const summary = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(summary).toContain('Claim summary');
      expect(summary).toContain('Patient account: ACCT-0001');
      expect(summary).toContain('Billing provider: SAMPLE CLINIC (NPI 1234567893)');
      expect(summary).toContain('Form type: Professional — CMS-1500');
      expect(summary).toContain('Service lines: 2');
      expect(summary).toContain('Total charge: $140.00');
      await expect(page.locator('#toastMessage')).toHaveText('Claim summary copied to the clipboard.');
    } finally {
      await app.close();
    }
  });

  test('warnings banner: severity glyph + explicit word, plain-English explanation, and the copy-warnings button', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_MANY_WARNINGS });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#warnBanner')).toBeVisible();

      // §2f item 4: the accessible name of a shown warning item must
      // literally contain its severity word ("Warning" or "Note") — never
      // colour alone.
      const firstItem = page.locator('.warnItem').first();
      await expect(firstItem).toHaveAccessibleName(/Warning|Note/);

      // §2f item 6: a plain-English explanation line under each warning in
      // the inspector's "Data warnings" group (open by default when there
      // are warnings — renderInspector's `hasWarnings` defaultOpen).
      await expect(page.locator('.inspRowExplain').first()).toBeVisible();

      // §2f item 3: "copy warnings + reconciliation" from the banner button.
      await page.locator('#warnCopyBtn').click();
      const text = normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()));
      expect(text).toContain('Warnings & reconciliation');
      expect(text).toContain('Reconciliation:');
      expect(text).toMatch(/Verdict: (Balanced|Lines (fall short|exceed total) by \$[\d.]+)/);
      await expect(page.locator('#toastMessage')).toHaveText('Warnings and reconciliation copied to the clipboard.');
    } finally {
      await app.close();
    }
  });
});
