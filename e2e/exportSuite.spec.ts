import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * E2E coverage for Build 4 — export suite (docs/BUILD_QUEUE.md Build 4):
 * batch PDF export (4.1) with the combined-PDF option (4.2), and structured
 * CSV (4.3) / JSON (4.4) export. Drives dist/electron/main.js exactly like
 * e2e/app.spec.ts / e2e/editableFields.spec.ts — see app.spec.ts's header
 * comment for why (real Electron process, real sandboxed renderer, real
 * preload bridge). Playwright can't drive the native folder/save-file
 * dialogs, so this relies on the same guarded, env-gated E2E seams
 * electron/main.ts already uses for dialog:openClaim/dialog:exportPdf,
 * extended for this build: CLAIM_VIEWER_E2E_BATCH_DIR (folder picker),
 * CLAIM_VIEWER_E2E_SAVE_CSV/_JSON (save-file dialogs), and
 * CLAIM_VIEWER_E2E_FAIL_PDF_INDEX (reused from the single-claim preview
 * seam) to force exactly one claim's render to fail deterministically.
 *
 * Required scenarios per this build's task brief:
 * 1. Batch export success (every claim rendered to its own PDF).
 * 2. One bad claim never kills the batch — every OTHER claim still exports,
 *    reported individually.
 * 3. Combined-PDF merge (4.2).
 * 4. CSV export: default PHI-minimal columns, and the identifiers opt-in.
 * 5. JSON export: same.
 * 6. Exporting a claim with active field overrides in each new format
 *    (CSV, JSON, and the combined PDF) carries the mandatory EDITED
 *    marking.
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

/** Same helper shape as e2e/editableFields.spec.ts's pdfText — extracts every page's text, needed to find the EDITED stamp/disclaimer in an exported file. */
async function pdfText(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  const standardFontDataUrl = join(repoRoot, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';
  const doc = await getDocument({ data: new Uint8Array(bytes), standardFontDataUrl }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(...content.items.map((it) => (it as { str: string }).str));
  }
  return { text: parts.join(' '), pageCount: doc.numPages };
}

async function openWorkspace(app: ElectronApplication): ReturnType<ElectronApplication['firstWindow']> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#welcomeOpenBtn').click();
  await expect(page.locator('#workspaceScreen')).toBeVisible();
  return page;
}

test.describe('837 Claim Viewer — E2E — export suite (docs/BUILD_QUEUE.md Build 4)', () => {
  test('batch export: renders every claim to its own PDF and reports an accurate summary', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-batch-'));
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MULTI, CLAIM_VIEWER_E2E_BATCH_DIR: destDir });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportOverlay')).toBeVisible();
      // >1 claim in this file — the scope selector must be visible.
      await expect(page.locator('#exportScopeGroup')).toBeVisible();
      await page.locator('#exportScopeAll').click();
      await expect(page.locator('#exportScopeAllLabel')).toHaveText('All 2 claims in this file');

      await page.locator('#exportConfirmBtn').click();
      await expect(page.locator('#exportBatchSummary')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#batchSummaryText')).toHaveText('Exported 2 of 2 claims.');
      await expect(page.locator('#batchSummaryFailures li')).toHaveCount(0);

      const files = readdirSync(destDir).filter((f) => f.endsWith('.pdf'));
      expect(files).toHaveLength(2);
      // Batch filename convention (docs/BUILD_QUEUE.md Build 4.1): ordinal
      // suffix, zero-padded to the claim count's digit width (2 claims -> 1 digit).
      expect(files.some((f) => / - 1\.pdf$/.test(f))).toBe(true);
      expect(files.some((f) => / - 2\.pdf$/.test(f))).toBe(true);

      // No override was made on either claim — no EDITED stamp anywhere.
      for (const f of files) {
        const { text } = await pdfText(readFileSync(join(destDir, f)));
        expect(text).not.toContain('EDITED');
      }

      await page.locator('#exportGhostBtn').click();
      await expect(page.locator('#exportOverlay')).toBeHidden();
    } finally {
      await app.close();
      rmSync(destDir, { recursive: true, force: true });
    }
  });

  test('one bad claim never kills the batch — every other claim still exports, and the failure is reported individually', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-batch-fail-'));
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MULTI, CLAIM_VIEWER_E2E_BATCH_DIR: destDir, CLAIM_VIEWER_E2E_FAIL_PDF_INDEX: '1' });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await page.locator('#exportScopeAll').click();
      await page.locator('#exportConfirmBtn').click();

      await expect(page.locator('#exportBatchSummary')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#batchSummaryText')).toContainText('Exported 1 of 2 claims.');
      await expect(page.locator('#batchSummaryText')).toContainText('1 claim could not be rendered.');
      await expect(page.locator('#batchSummaryFailures li')).toHaveCount(1);
      await expect(page.locator('#batchSummaryFailures li')).toContainText('Simulated PDF render failure');

      // The claim that DIDN'T fail was still written to disk.
      const files = readdirSync(destDir).filter((f) => f.endsWith('.pdf'));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/ - 1\.pdf$/);
    } finally {
      await app.close();
      rmSync(destDir, { recursive: true, force: true });
    }
  });

  test('combined-PDF option (4.2) merges every successfully-rendered claim into one additional PDF, alongside the per-claim files', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-batch-combined-'));
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MULTI, CLAIM_VIEWER_E2E_BATCH_DIR: destDir });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await page.locator('#exportScopeAll').click();
      await expect(page.locator('#exportCombinePdfRow')).toBeVisible();
      await page.locator('#exportCombinePdfCheckbox').check();
      await page.locator('#exportConfirmBtn').click();

      await expect(page.locator('#exportBatchSummary')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#batchSummaryText')).toContainText('Combined PDF: combined.pdf.');

      const files = readdirSync(destDir);
      expect(files.filter((f) => f.endsWith('.pdf') && f !== 'combined.pdf')).toHaveLength(2); // one-file-per-claim is ALWAYS still produced
      expect(files).toContain('combined.pdf');

      const perClaimPageCounts = await Promise.all(
        files
          .filter((f) => f.endsWith('.pdf') && f !== 'combined.pdf')
          .map(async (f) => (await pdfText(readFileSync(join(destDir, f)))).pageCount),
      );
      const combined = await pdfText(readFileSync(join(destDir, 'combined.pdf')));
      expect(combined.pageCount).toBe(perClaimPageCounts.reduce((a, b) => a + b, 0));

      await expect(page.locator('#batchSummaryOpenFolderBtn')).toBeVisible();
    } finally {
      await app.close();
      rmSync(destDir, { recursive: true, force: true });
    }
  });

  test('CSV export: PHI-minimal columns by default, patient identifiers only with the explicit opt-in', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-csv-'));
    const defaultPath = join(saveDir, 'default.csv');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_CSV: defaultPath });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportScopeGroup')).toBeHidden(); // single-claim file — no scope choice
      await page.locator('#exportFormatCsv').click();
      await expect(page.locator('#exportIdentifiersGroup')).toBeVisible();
      // Never pre-checked — PHI-minimal is the default every time (spec §5).
      await expect(page.locator('#exportIncludeIdentifiersCheckbox')).not.toBeChecked();
      await page.locator('#exportConfirmBtn').click();
      await expect(page.locator('#exportOverlay')).toBeHidden();
      await expect.poll(() => existsSync(defaultPath)).toBe(true);

      const defaultCsv = readFileSync(defaultPath, 'utf8');
      const header = defaultCsv.split('\r\n')[0];
      expect(header).toBe(
        [
          'claimId',
          'formType',
          'patientAccountNumber',
          'billingProviderName',
          'billingProviderNpi',
          'totalCharge',
          'claimEdited',
          'editedFieldLabels',
          'lineNumber',
          'lineEdited',
          'serviceDateFrom',
          'serviceDateThru',
          'placeOfServiceOrRevenueCode',
          'procCode',
          'modifiers',
          'units',
          'charge',
          'diagPointers',
        ].join(','),
      );
      expect(defaultCsv).toContain('900000001'); // claim id
      expect(defaultCsv).toContain('ACCT-0001'); // patient account number — not an "identifier" for this build's purposes
      expect(defaultCsv).not.toContain('SAMPLEPATIENT'); // patient name
      expect(defaultCsv).not.toContain('1980-01-15'); // DOB
      expect(defaultCsv).not.toContain('MEMBER001'); // full member ID
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('CSV export: the identifiers opt-in adds patient/insured identifying columns', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-csv-ids-'));
    const withIdsPath = join(saveDir, 'with-identifiers.csv');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_CSV: withIdsPath });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatCsv').click();
      await page.locator('#exportIncludeIdentifiersCheckbox').check();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(withIdsPath)).toBe(true);

      const csv = readFileSync(withIdsPath, 'utf8');
      expect(csv.split('\r\n')[0]).toContain('patientName,patientDob,patientAddress,patientPhone,insuredName,insuredMemberId,insuredDob,insuredAddress');
      expect(csv).toContain('SAMPLEPATIENT');
      expect(csv).toContain('1980-01-15');
      expect(csv).toContain('MEMBER001');

      // Spec §5: "never silently change the user's last-used profile; default
      // to the safe one each time" — even within the SAME running app,
      // reopening the dialog after an opt-in export must NOT remember it.
      // confirmExport already closed the dialog on success (existing
      // behavior, unchanged by this build); just reopen it.
      await expect(page.locator('#exportOverlay')).toBeHidden();
      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportFormatPdf')).toBeChecked(); // format itself resets too
      await page.locator('#exportFormatCsv').click();
      await expect(page.locator('#exportIncludeIdentifiersCheckbox')).not.toBeChecked();
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('JSON export: PHI-minimal (redacted identifiers) by default, real values with the opt-in', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-json-'));
    const defaultPath = join(saveDir, 'default.json');
    const withIdsPath = join(saveDir, 'with-identifiers.json');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_JSON: defaultPath });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatJson').click();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(defaultPath)).toBe(true);

      const defaultDoc = JSON.parse(readFileSync(defaultPath, 'utf8'));
      expect(defaultDoc.identifiersIncluded).toBe(false);
      expect(defaultDoc.claims).toHaveLength(1);
      expect(defaultDoc.claims[0].claimId).toBe('900000001');
      expect(defaultDoc.claims[0].patient.accountNumber).toBe('ACCT-0001');
      expect(defaultDoc.claims[0].patient.name).toBe('[not included — identifiers opt-in]');
      expect(defaultDoc.claims[0].patient.dob).toBe('[not included — identifiers opt-in]');
      expect(defaultDoc.claims[0].insured.memberId).toBe('[not included — identifiers opt-in]');
      expect(JSON.stringify(defaultDoc)).not.toContain('SAMPLEPATIENT');
    } finally {
      await app.close();
    }

    // Second launch: the opt-in.
    const app2 = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_JSON: withIdsPath });
    try {
      const page = await openWorkspace(app2);
      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatJson').click();
      await page.locator('#exportIncludeIdentifiersCheckbox').check();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(withIdsPath)).toBe(true);

      const withIdsDoc = JSON.parse(readFileSync(withIdsPath, 'utf8'));
      expect(withIdsDoc.identifiersIncluded).toBe(true);
      expect(withIdsDoc.claims[0].patient.name).toBe('SAMPLEPATIENT, PAT Q');
      expect(withIdsDoc.claims[0].insured.memberId).toBe('MEMBER001');
    } finally {
      await app2.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('exporting a claim with an active field override carries the mandatory EDITED marking in CSV and JSON', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-edited-structured-'));
    const csvPath = join(saveDir, 'edited.csv');
    const jsonPath = join(saveDir, 'edited.json');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_CSV: csvPath, CLAIM_VIEWER_E2E_SAVE_JSON: jsonPath });
    try {
      const page = await openWorkspace(app);
      await page.locator('#editModeToggleBtn').click();
      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await accountRow.locator('.rowEditBtn').click();
      await accountRow.locator('.inspRowEditInput').fill('ACCT-EDITED-EXPORT');
      await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();
      await expect(page.locator('.inspRow', { hasText: 'ACCT-EDITED-EXPORT' }).locator('.editedBadge')).toBeVisible();

      // CSV
      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatCsv').click();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(csvPath)).toBe(true);
      const csvLines = readFileSync(csvPath, 'utf8').split('\r\n');
      const csvRow = csvLines[1]!.split(',');
      expect(csvRow[6]).toBe('true'); // claimEdited
      expect(csvRow[7]).toBe('Patient account number'); // editedFieldLabels
      expect(csvRow[2]).toBe('ACCT-EDITED-EXPORT'); // patientAccountNumber reflects the EFFECTIVE value

      // JSON
      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatJson').click();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(jsonPath)).toBe(true);
      const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
      expect(doc.claims[0].edited).toBe(true);
      expect(doc.claims[0].editedFieldCount).toBe(1);
      expect(doc.claims[0].edits).toEqual([{ fieldPath: 'patient.accountNumber', label: 'Patient account number', originalValue: 'ACCT-0001', currentValue: 'ACCT-EDITED-EXPORT' }]);
      expect(doc.claims[0].patient.accountNumber).toBe('ACCT-EDITED-EXPORT');
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('exporting a batch with an active field override carries the mandatory EDITED stamp in the combined PDF', async () => {
    const destDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-batch-edited-'));
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I_MULTI, CLAIM_VIEWER_E2E_BATCH_DIR: destDir });
    try {
      const page = await openWorkspace(app);
      await page.locator('#editModeToggleBtn').click();
      // FIXTURE_837I_MULTI's first claim carries a patient DOB (DMG*D8*19261111 -> 1926-11-11) — edit it.
      const dobRow = page.locator('.inspRow', { hasText: '1926-11-11' }).first();
      await dobRow.locator('.rowEditBtn').click();
      await dobRow.locator('.inspRowEditInput').fill('1926-11-12');
      await dobRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();
      await expect(page.locator('.inspRow', { hasText: '1926-11-12' }).locator('.editedBadge')).toBeVisible();

      await page.locator('#exportBtn').click();
      await page.locator('#exportScopeAll').click();
      await page.locator('#exportCombinePdfCheckbox').check();
      await page.locator('#exportConfirmBtn').click();
      await expect(page.locator('#exportBatchSummary')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#batchSummaryText')).toContainText('Exported 2 of 2 claims.');

      const files = readdirSync(destDir);
      const perClaimFile = files.find((f) => f.endsWith('.pdf') && f !== 'combined.pdf' && f.includes(' - 1.'));
      expect(perClaimFile).toBeDefined();
      const editedClaimText = (await pdfText(readFileSync(join(destDir, perClaimFile!)))).text;
      expect(editedClaimText).toContain('EDITED');
      expect(editedClaimText).toContain('1 field modified by user');

      const combinedText = (await pdfText(readFileSync(join(destDir, 'combined.pdf')))).text;
      expect(combinedText).toContain('EDITED'); // the merged document inherits the per-claim page's own stamp
    } finally {
      await app.close();
      rmSync(destDir, { recursive: true, force: true });
    }
  });

  // --- Build 5: X12 837 export (docs/BUILD_LOG.md Build 5 section) --------
  test('X12 837 export: writes a well-formed .837 file for the current claim', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-x12-'));
    const x12Path = join(saveDir, 'export.837');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_X12: x12Path });
    try {
      const page = await openWorkspace(app);

      await page.locator('#exportBtn').click();
      await expect(page.locator('#exportIdentifiersGroup')).toBeHidden(); // PDF is the default format — no identifiers toggle yet
      await page.locator('#exportFormatX12').click();
      await expect(page.locator('#exportIdentifiersGroup')).toBeHidden(); // X12 never gets the identifiers opt-in either — see preload.ts's exportX12 doc comment
      await page.locator('#exportConfirmBtn').click();
      await expect(page.locator('#exportOverlay')).toBeHidden();
      await expect.poll(() => existsSync(x12Path)).toBe(true);

      const edi = readFileSync(x12Path, 'utf8');
      expect(edi.startsWith('ISA')).toBe(true);
      expect(edi).toContain('GS*HC*');
      expect(edi).toContain('ST*837*');
      expect(edi).toContain('SE*');
      expect(edi).toContain('IEA*1*');
      // With NO override active, CLM01 (Patient Control Number) carries the
      // claim's real claimId, not patient.accountNumber — see
      // x12ClaimSerializer.ts's clmSegment doc comment (an unedited
      // JSON-sourced claim can legitimately have the two differ).
      expect(edi).toContain('CLM*900000001*');
      expect(edi).not.toContain('MODIFIED FROM THE ORIGINAL SOURCE'); // no overrides active — no EDITED marker
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });

  test('exporting an edited claim as X12 837 carries the EDI-native EDITED-equivalent K3 marker', async () => {
    const saveDir = mkdtempSync(join(tmpdir(), 'claim-viewer-e2e-x12-edited-'));
    const x12Path = join(saveDir, 'edited.837');
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500, CLAIM_VIEWER_E2E_SAVE_X12: x12Path });
    try {
      const page = await openWorkspace(app);
      await page.locator('#editModeToggleBtn').click();
      const accountRow = page.locator('.inspRow', { hasText: 'ACCT-0001' });
      await accountRow.locator('.rowEditBtn').click();
      await accountRow.locator('.inspRowEditInput').fill('ACCT-EDITED-X12');
      await accountRow.locator('.inspRowEditForm button', { hasText: 'Save' }).click();
      await expect(page.locator('.inspRow', { hasText: 'ACCT-EDITED-X12' }).locator('.editedBadge')).toBeVisible();

      await page.locator('#exportBtn').click();
      await page.locator('#exportFormatX12').click();
      await page.locator('#exportConfirmBtn').click();
      await expect.poll(() => existsSync(x12Path)).toBe(true);

      const edi = readFileSync(x12Path, 'utf8');
      expect(edi).toContain('K3*THIS CLAIM DATA WAS MODIFIED FROM THE ORIGINAL SOURCE FILE BY 837 CLAIM VIEWER');
      expect(edi).toContain('MODIFIED FIELDS');
      expect(edi).toContain('Patient account number');
      // patient.accountNumber and CLM01 are the same wire position in X12
      // (see x12ClaimSerializer.ts's clmSegment doc comment) — the override
      // shows up as the claim's own control number too, not just in a note.
      expect(edi).toContain('CLM*ACCT-EDITED-X12*');
    } finally {
      await app.close();
      rmSync(saveDir, { recursive: true, force: true });
    }
  });
});
