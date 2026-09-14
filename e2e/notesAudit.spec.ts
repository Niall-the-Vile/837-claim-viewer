import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * E2E coverage for Build 6 — Notes & audit
 * (docs/CLAUDE_CODE_NEXT_SESSION.md's Build 6 / docs/BUILD_QUEUE.md's
 * older Build 5, read WITH the session-only override applied). Drives
 * dist/electron/main.js exactly like the rest of the suite — see
 * e2e/app.spec.ts's header comment for why.
 *
 * Required scenarios per this build's task brief:
 * 1. Adding a note/flag persists across a claim step within the same tab,
 *    but disappears once the tab is closed.
 * 2. It ALSO never survives an app relaunch, even against the SAME
 *    userData profile that session-restore/recent-files DO survive in
 *    (proving annotations never touch session.json or any other disk
 *    artifact — the hard "session-only" constraint this build is built
 *    around).
 * 3. Annotations are excluded from all four export formats, with the
 *    on-screen "N session notes — not included in export" indicator
 *    present beforehand.
 * 4. The "Copy annotations worksheet" action, and that it stays a
 *    separate, clearly-labeled action from "Copy claim summary".
 * 5. The audit log is viewable from About and records real actions with
 *    no claim content visible in the table.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
const FIXTURE_837I_MULTI = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');

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

/** Profile isolation (guardrail §1.9) — fresh throwaway userData per launch, mirroring every other E2E file except session-restore.spec.ts's deliberate exception. */
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

/** Mirrors session-restore.spec.ts's launchAppWithUserData — the caller owns userDataDir's lifecycle across two launches. */
async function launchAppWithUserData(userDataDir: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`], env: { ...definedEnv(process.env), ...env } });
}

async function openWorkspace(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#welcomeOpenBtn').click();
  await expect(page.locator('#workspaceScreen')).toBeVisible();
  return page;
}

/** Opens the "Notes & flags" inspector group (closed by default) — clicks the label rather than the whole <summary> so a wide/overlapping copy-worksheet button never eats the click. */
async function openAnnotationsGroup(page: Page): Promise<void> {
  const group = page.locator('details[data-group-id="annotations"]');
  if (!(await group.getAttribute('open'))) {
    await group.locator('.inspGroupLabel').click();
  }
  await expect(group).toHaveAttribute('open', '');
}

function annoRow(page: Page, lineIndex: number) {
  return page.locator(`.annoRow[data-anno-line="${lineIndex}"]`);
}

/** Cycles a line's flag button and blurs a note into it — the same two actions a real reviewer takes, kept together since most scenarios below need both. */
async function setNoteAndFlag(page: Page, lineIndex: number, note: string): Promise<void> {
  const row = annoRow(page, lineIndex);
  await row.locator('.annoFlagBtn').click(); // None -> OK
  await row.locator('.annoNoteToggle').click(); // expand the textarea
  await row.locator('.annoNoteText').fill(note);
  // Blur by clicking a plain, non-interactive element elsewhere in the group — commits the note (autosave-on-blur).
  await page.locator('.annoSessionNote').click();
}

test.describe('837 Claim Viewer — E2E — session-scoped notes & flags and the audit log (Build 6)', () => {
  test('a note/flag persists across a claim step within the same tab, but is gone once the tab closes', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: [FIXTURE_837I_MULTI, FIXTURE_837I_MULTI].join(';') });
    try {
      const page = await openWorkspace(app);
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');

      await openAnnotationsGroup(page);
      await setNoteAndFlag(page, 0, 'line 1 upcoded, ask for chart notes');

      const row0 = annoRow(page, 0);
      await expect(row0.locator('.annoFlagBtn')).toHaveAttribute('data-flag', 'ok');
      await expect(row0.locator('.annoNoteToggle')).toHaveText('Note •');
      await expect(page.locator('.annoSummaryLine')).toHaveText('1 of 2 lines flagged · 1 noted');

      // --- Step to claim 2: a DIFFERENT claim index — must start fresh. ----
      await page.locator('#nextClaimBtn').click();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 2 of 2');
      await openAnnotationsGroup(page); // renderInspector rebuilt the group's DOM on the claim step
      await expect(annoRow(page, 0).locator('.annoFlagBtn')).toHaveAttribute('data-flag', 'none');
      await expect(annoRow(page, 0).locator('.annoNoteToggle')).toHaveText('Note');

      // --- Step back to claim 1: the SAME TabState — must still be there. -
      await page.locator('#prevClaimBtn').click();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');
      await openAnnotationsGroup(page);
      await expect(annoRow(page, 0).locator('.annoFlagBtn')).toHaveAttribute('data-flag', 'ok');
      await expect(annoRow(page, 0).locator('.annoNoteToggle')).toHaveText('Note •');

      // --- Close the tab, reopen the SAME file: a brand-new TabState/session
      // (the old one was dropped on close — see tabs.ts's closeTab/
      // claimApi.closeSession) — annotations must NOT survive this either.
      await page.keyboard.press('Control+w');
      await expect(page.locator('.tab')).toHaveCount(0);
      await page.locator('#openBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await openAnnotationsGroup(page);
      await expect(annoRow(page, 0).locator('.annoFlagBtn')).toHaveAttribute('data-flag', 'none');
      await expect(annoRow(page, 0).locator('.annoNoteToggle')).toHaveText('Note');
    } finally {
      await app.close();
    }
  });

  test('never survives an app relaunch — even against the SAME userData profile that session-restore itself DOES survive in', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'claim-viewer-notes-restore-userdata-'));
    try {
      const app1 = await launchAppWithUserData(userDataDir, { CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
      const page1 = await openWorkspace(app1);
      await openAnnotationsGroup(page1);
      await setNoteAndFlag(page1, 0, 'verify this modifier before the appeal deadline');
      await expect(annoRow(page1, 0).locator('.annoFlagBtn')).toHaveAttribute('data-flag', 'ok');

      // session:save (persistSession()) fires as part of the open itself,
      // not on quit — poll the real session.json on disk (mirrors
      // session-restore.spec.ts's own pattern) rather than racing app1.close()
      // against an in-flight write.
      const sessionFile = join(userDataDir, 'session.json');
      await expect
        .poll(() => (existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as { tabs: unknown[] }).tabs.length : 0))
        .toBe(1);

      await app1.close(); // annotations touch NOTHING on disk — only the file path above does

      // --- Relaunch against the SAME profile: no CLAIM_VIEWER_E2E_OPEN this
      // time — the tab comes back purely from session.json's restore path.
      const app2 = await launchAppWithUserData(userDataDir);
      try {
        const page2 = await app2.firstWindow();
        await page2.waitForLoadState('domcontentloaded');
        await expect(page2.locator('#workspaceScreen')).toBeVisible(); // proves the FILE restored...
        await openAnnotationsGroup(page2);
        // ...but the annotation on it did NOT.
        await expect(annoRow(page2, 0).locator('.annoFlagBtn')).toHaveAttribute('data-flag', 'none');
        await expect(annoRow(page2, 0).locator('.annoNoteToggle')).toHaveText('Note');
        await expect(page2.locator('.annoSummaryLine')).toHaveText('0 of 2 lines flagged');
      } finally {
        await app2.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('annotations are excluded from all four export formats, with the "not included in export" notice shown beforehand', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-annoexport-'));
    const pdfPath = join(saveDir, 'export.pdf');
    const csvPath = join(saveDir, 'export.csv');
    const jsonPath = join(saveDir, 'export.json');
    const x12Path = join(saveDir, 'export.837');
    const app = await launchApp({
      CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500,
      CLAIM_VIEWER_E2E_SAVE: pdfPath,
      CLAIM_VIEWER_E2E_SAVE_CSV: csvPath,
      CLAIM_VIEWER_E2E_SAVE_JSON: jsonPath,
      CLAIM_VIEWER_E2E_SAVE_X12: x12Path,
    });
    try {
      const page = await openWorkspace(app);
      await openAnnotationsGroup(page);
      const NOTE_TEXT = 'reviewer scratch note — upcoded, dispute this line';
      await setNoteAndFlag(page, 0, NOTE_TEXT);

      await page.locator('#exportBtn').click();
      for (const [formatId, path] of [
        ['exportFormatPdf', pdfPath],
        ['exportFormatCsv', csvPath],
        ['exportFormatJson', jsonPath],
        ['exportFormatX12', x12Path],
      ] as const) {
        await page.locator(`#${formatId}`).click();
        // 6.3 — the on-screen heads-up, present for every format (annotations
        // stay out of the PDF facsimile just as much as the structured ones).
        await expect(page.locator('#exportAnnotationsNotice')).toBeVisible();
        await expect(page.locator('#exportAnnotationsNotice')).toHaveText('1 session note — not included in export.');
        await page.locator('#exportConfirmBtn').click();
        await expect(page.locator('#exportOverlay')).toBeHidden();
        await expect.poll(() => existsSync(path)).toBe(true);
        // Reopen the dialog for the next format in the loop.
        if (path !== x12Path) await page.locator('#exportBtn').click();
      }

      // --- The adversarial check: read every exported file's raw bytes/text
      // and assert the note text and the "Dispute" flag word NEVER appear,
      // in ANY of the four formats.
      const pdfText = readFileSync(pdfPath, 'latin1'); // PDFs aren't valid utf8; a raw scan is enough to rule out plain-text leakage of the note string
      const csvText = readFileSync(csvPath, 'utf8');
      const jsonText = readFileSync(jsonPath, 'utf8');
      const x12Text = readFileSync(x12Path, 'utf8');
      for (const content of [pdfText, csvText, jsonText, x12Text]) {
        expect(content.includes(NOTE_TEXT)).toBe(false);
        expect(content.includes('Dispute')).toBe(false);
      }
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('"Copy annotations worksheet" is a separate, clearly-labeled action from "Copy claim summary"', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await openWorkspace(app);
      await openAnnotationsGroup(page);
      await setNoteAndFlag(page, 0, 'ask the provider to correct this');

      await page.locator('.annoGroupCopyBtn').click();
      const worksheet = await page.evaluate(() => navigator.clipboard.readText());
      expect(worksheet.replace(/\r\n/g, '\n')).toBe(
        ['Session notes & flags (not saved — cleared when this tab closes)', '', 'Line\tFlag\tChecked\tNote', '1\tOK\tNo\task the provider to correct this'].join('\n'),
      );

      // Copy claim summary afterward — must NEVER fold the reviewer's note
      // into what's supposed to represent the parsed claim.
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.locator('#copySummaryBtn').click();
      const summary = await page.evaluate(() => navigator.clipboard.readText());
      expect(summary).not.toContain('ask the provider to correct this');
      expect(summary).toContain('Claim summary');
    } finally {
      await app.close();
    }
  });

  test('the audit log records real actions, is viewable from About, and shows no claim content', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-auditlog-'));
    const csvPath = join(saveDir, 'export.csv');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_CSV: csvPath });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatCsv').click();
      await page.locator('#exportConfirmBtn').click();
      await expect(page.locator('#exportOverlay')).toBeHidden();
      await expect.poll(() => existsSync(csvPath)).toBe(true);

      await page.locator('[data-menu-trigger="help"]').click();
      await page.locator('[data-action="about"]').click();
      await expect(page.locator('#aboutOverlay')).toBeVisible();
      await page.locator('#aboutViewAuditLogBtn').click();
      await expect(page.locator('#auditLogOverlay')).toBeVisible();

      const rows = page.locator('#auditLogTableBody tr');
      await expect(rows).toHaveCount(2); // "opened claim" then "exported CSV" — newest first
      await expect(rows.nth(0)).toContainText('exported CSV');
      await expect(rows.nth(1)).toContainText('opened claim');
      await expect(page.locator('#auditLogTableBody')).toContainText('synthetic-1500.json'); // source file name — already-disclosed, not claim content

      // --- No claim content anywhere in the visible table. ------------------
      const tableText = (await page.locator('#auditLogTableBody').innerText()).toLowerCase();
      expect(tableText).not.toContain('samplepatient'); // patient name
      expect(tableText).not.toContain('member001'); // member id
      expect(tableText).not.toContain('99213'); // procedure code
      expect(tableText).not.toContain('900000001'); // the claim's own plain-text claim id — only its HASH may appear
      // The hashed claim id column IS present, just truncated + not the raw id.
      await expect(rows.nth(0).locator('td').nth(5)).not.toHaveText('');

      // "Copy visible rows" — a second, independent proof the same "no claim
      // content" guarantee holds off-screen too (the clipboard payload, not
      // just what's rendered).
      await page.locator('#auditLogCopyBtn').click();
      const copied = (await page.evaluate(() => navigator.clipboard.readText())).toLowerCase();
      expect(copied).not.toContain('samplepatient');
      expect(copied).not.toContain('900000001');
      expect(copied).toContain('exported csv');
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });
});
