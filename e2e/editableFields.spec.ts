import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * E2E coverage for the editable-fields feature (docs/EDITABLE_FIELDS_DESIGN.md).
 * Drives dist/electron/main.js exactly like e2e/app.spec.ts / e2e/copy.spec.ts
 * — see app.spec.ts's header comment for why (real Electron process, real
 * sandboxed renderer, real preload bridge, the CLAIM_VIEWER_E2E_OPEN/SAVE
 * seams for the native dialogs Playwright can't drive).
 *
 * Covers, per the task's required scenarios:
 * 1. Entering edit mode without breaking click-to-copy.
 * 2. Editing a field and seeing it visually marked.
 * 3. Reverting a field.
 * 4. Exporting a claim with overrides and confirming the mandatory EDITED
 *    stamp is present in the rendered PDF output.
 * 5. Re-opening the same file (same userData, same source path) reloads the
 *    saved corrected-claim artifact automatically.
 * 6. Staleness: if the source file changes after edits were saved, the next
 *    open surfaces the stale-overrides banner instead of silently applying
 *    (or silently dropping) the saved edits.
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
  const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-'));
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

/** Two-launch variant (same `userData` dir across both) — mirrors e2e/app.spec.ts's launchAppWithUserData; the caller owns the directory's lifecycle. */
async function launchAppWithUserData(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: { ...definedEnv(process.env), ...env } });
}

/** Extracts all text from a rendered PDF's pages — same helper shape as test/provenance.test.ts's textOf, needed here to inspect an EXPORTED file's actual content rather than trusting the toast alone. */
async function pdfText(bytes: Buffer): Promise<string> {
  const standardFontDataUrl = join(repoRoot, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';
  const doc = await getDocument({ data: new Uint8Array(bytes), standardFontDataUrl }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(...content.items.map((it) => (it as { str: string }).str));
  }
  return parts.join(' ');
}

test.describe('837 Claim Viewer — E2E — editable fields (docs/EDITABLE_FIELDS_DESIGN.md)', () => {
  test('entering Edit mode does not break click-to-copy', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Off by default.
      await expect(page.locator('#editModeToggleBtn')).toHaveAttribute('aria-pressed', 'false');

      await page.locator('#editModeToggleBtn').click();
      await expect(page.locator('#editModeToggleBtn')).toHaveAttribute('aria-pressed', 'true');

      // The pencil now appears on an editable row...
      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await expect(accountRow.locator('.rowEditBtn')).toBeAttached();

      // ...but a plain click on the existing copy icon still just copies —
      // Edit mode changes nothing about that interaction (invariant 7).
      await accountRow.locator('.rowCopyBtn').click();
      await expect(page.locator('#toastMessage')).toHaveText('Account no. copied to the clipboard.');
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied.replace(/\r\n/g, '\n')).toBe('ACCT-0001');
    } finally {
      await app.close();
    }
  });

  test('editing a field updates its value and shows the always-visible Edited badge', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await page.locator('#editModeToggleBtn').click();

      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await accountRow.locator('.rowEditBtn').click();

      const input = accountRow.locator('.inspRowEditInput');
      await expect(input).toHaveValue('ACCT-0001');
      await input.fill('ACCT-CORRECTED');
      await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();

      // A full inspector re-render replaces the row entirely — re-locate it
      // by its NEW value.
      const editedRow = page.locator('.inspRow', { hasText: 'ACCT-CORRECTED' });
      await expect(editedRow).toBeVisible();
      await expect(editedRow.locator('.editedBadge')).toHaveText('Edited');
      // Invariant 5: the original value must still be reachable (a tooltip here).
      await expect(editedRow.locator('.editedBadge')).toHaveAttribute('title', 'Original value: ACCT-0001');

      // The badge stays visible even with Edit mode turned back OFF
      // (invariant 5: "always" distinguishable, not just while editing).
      await page.locator('#editModeToggleBtn').click();
      await expect(page.locator('.inspRow', { hasText: 'ACCT-CORRECTED' }).locator('.editedBadge')).toBeVisible();

      // And the warnings group carries the "reflects original data" note.
      await expect(page.locator('.inspRow', { hasText: 'warnings above reflect the original parsed data' })).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('reverting a field restores the original value and removes the Edited badge', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await page.locator('#editModeToggleBtn').click();

      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await accountRow.locator('.rowEditBtn').click();
      await accountRow.locator('.inspRowEditInput').fill('ACCT-TEMP');
      await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();

      const editedRow = page.locator('.inspRow', { hasText: 'ACCT-TEMP' });
      await expect(editedRow.locator('.editedBadge')).toBeVisible();
      await editedRow.locator('.rowRevertBtn').click();

      const revertedRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await expect(revertedRow).toBeVisible();
      await expect(revertedRow.locator('.editedBadge')).toHaveCount(0);
      await expect(page.locator('.inspRow', { hasText: 'ACCT-TEMP' })).toHaveCount(0);
      // "Revert all edits" disappears once there's nothing left to revert.
      await expect(page.locator('#clearOverridesBtn')).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test('exporting a claim with an active override carries the mandatory EDITED stamp, alongside the facsimile disclaimer', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-edited-'));
    const savePath = join(saveDir, 'export.pdf');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE: savePath });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await page.locator('#editModeToggleBtn').click();

      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await accountRow.locator('.rowEditBtn').click();
      await accountRow.locator('.inspRowEditInput').fill('ACCT-EXPORT-TEST');
      await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();
      await expect(page.locator('.inspRow', { hasText: 'ACCT-EXPORT-TEST' }).locator('.editedBadge')).toBeVisible();

      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportOverlay')).toBeVisible();
      await page.locator('#exportConfirmBtn').click();
      await expect(page.locator('#exportOverlay')).toBeHidden();
      await expect.poll(() => existsSync(savePath)).toBe(true);

      const text = await pdfText(readFileSync(savePath));
      expect(text).toContain('EDITED');
      expect(text).toContain('1 field modified by user'); // singular wording for exactly one edit
      // Both stamps present together — one never replaces the other (invariant 6).
      expect(text).toContain('UNVERIFIED FACSIMILE');
      expect(text).toContain('NOT AN OFFICIAL FORM');
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('exporting a claim with NO overrides carries no EDITED stamp', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-unedited-'));
    const savePath = join(saveDir, 'export.pdf');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE: savePath });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.locator('#exportBtn').click();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(savePath)).toBe(true);

      const text = await pdfText(readFileSync(savePath));
      expect(text).not.toContain('EDITED');
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('reopening the same file (same userData) reloads the saved corrected-claim artifact automatically', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-editfields-'));
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claim-viewer-editfields-fixture-'));
    const fixturePath = join(fixtureDir, 'editable-fixture.json');
    writeFileSync(fixturePath, readFileSync(FIXTURE_1500, 'utf8'), 'utf8');
    try {
      // --- Launch 1: open, edit, save, close ---
      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: fixturePath });
      try {
        const page = await app1.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        await page.locator('#welcomeOpenBtn').click();
        await expect(page.locator('#workspaceScreen')).toBeVisible();
        await page.locator('#editModeToggleBtn').click();

        const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
        await accountRow.locator('.rowEditBtn').click();
        await accountRow.locator('.inspRowEditInput').fill('ACCT-PERSISTED');
        await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();
        await expect(page.locator('.inspRow', { hasText: 'ACCT-PERSISTED' }).locator('.editedBadge')).toBeVisible();
      } finally {
        await app1.close();
      }

      // --- Launch 2: same userData, same (unchanged) source file. Session
      // restore (docs/TABS_BUILD_PLAN.md §2e) reopens the tab from Launch 1
      // automatically — no welcomeOpenBtn click, no CLAIM_VIEWER_E2E_OPEN
      // consumption needed; it's only set above so a fresh/failed restore
      // would still have a fallback.
      const app2 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: fixturePath });
      try {
        const page = await app2.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#workspaceScreen')).toBeVisible();

        // Applied automatically — no re-editing needed, and no stale banner
        // (the file is byte-identical to when the edit was saved).
        await expect(page.locator('#staleOverridesBanner')).toBeHidden();
        await expect(page.locator('.inspRow', { hasText: 'ACCT-PERSISTED' }).locator('.editedBadge')).toBeVisible();
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  test('staleness: a changed source file surfaces the stale-overrides banner instead of silently applying (or dropping) saved edits, and Discard clears it', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-userdata-stale-'));
    const fixtureDir = mkdtempSync(join(tmpdir(), 'claim-viewer-stale-fixture-'));
    const fixturePath = join(fixtureDir, 'stale-fixture.json');
    const original = JSON.parse(readFileSync(FIXTURE_1500, 'utf8')) as Record<string, unknown>;
    writeFileSync(fixturePath, JSON.stringify(original), 'utf8');
    try {
      // --- Launch 1: open, edit, save, close ---
      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: fixturePath });
      try {
        const page = await app1.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        await page.locator('#welcomeOpenBtn').click();
        await expect(page.locator('#workspaceScreen')).toBeVisible();
        await page.locator('#editModeToggleBtn').click();
        const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
        await accountRow.locator('.rowEditBtn').click();
        await accountRow.locator('.inspRowEditInput').fill('ACCT-WILL-GO-STALE');
        await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();
        await expect(page.locator('.inspRow', { hasText: 'ACCT-WILL-GO-STALE' }).locator('.editedBadge')).toBeVisible();
      } finally {
        await app1.close();
      }

      // Change the SOURCE FILE's bytes (a different patient account number
      // in the raw JSON) so its sha256 no longer matches what the saved
      // artifact was hashed against.
      const changed = { ...original, pcn: 'ACCT-CHANGED-ON-DISK' };
      writeFileSync(fixturePath, JSON.stringify(changed), 'utf8');

      // --- Launch 2: same userData (so the same tab is session-restored —
      // see the previous test), CHANGED source file ---
      const app2 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: fixturePath });
      try {
        const page = await app2.firstWindow();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#workspaceScreen')).toBeVisible();

        // Never applied silently: the field shows the NEW file's real value
        // (ACCT-CHANGED-ON-DISK), not the stale override.
        await expect(page.locator('#staleOverridesBanner')).toBeVisible();
        await expect(page.locator('.inspRow', { hasText: 'ACCT-CHANGED-ON-DISK' })).toBeVisible();
        await expect(page.locator('.editedBadge')).toHaveCount(0);

        await page.locator('#staleOverridesDiscardBtn').click();
        await expect(page.locator('#staleOverridesBanner')).toBeHidden();
        await expect(page.locator('#toastMessage')).toHaveText('Saved edits for the old version of this file were discarded.');
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
