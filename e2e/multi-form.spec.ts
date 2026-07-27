import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Broadens e2e coverage past the single-claim JSON CMS-1500 path
 * (AUDIT_REPORT.md coverage-gap #1 / e2e/app.spec.ts's only fixture is
 * test/fixtures/synthetic-1500.json). Drives the real, unpackaged
 * dist/electron/main.js build through the same CLAIM_VIEWER_E2E_OPEN seam
 * e2e/app.spec.ts already uses — see that file's header comment for why the
 * seam is safe here and provably inert in the real packaged app (gated on
 * !app.isPackaged in electron/main.ts). This file only adds new cases; it
 * never touches e2e/app.spec.ts's existing two tests.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');

// A hand-authored 837I fixture with two CLM (claim) loops under one 2000B
// subscriber HL block — the parser (src/sources/x12/segments.ts's
// splitClaims) starts a new claim at every CLM segment it sees within a
// block, so this is a legitimate multi-claim institutional file, unlike the
// single-claim test/fixtures/x12/837I-all-fields.dat / 837I-minimal.dat
// fixtures already in the repo (verified via loadClaims() while authoring
// this fixture: both existing 837I fixtures parse to exactly 1 claim).
const MULTI_CLAIM_837I = join(repoRoot, 'test', 'fixtures', 'x12', '837I-multi-claim.dat');

// A JSON claim with an unrecognized claim_form (claimService.renderClaim's
// 'unsupported' branch) — same shape the vitest suite already exercises
// directly (test/claimService.test.ts's "renders a %PDF- placeholder"
// case), driven here through the real Electron shell instead.
const UNSUPPORTED_CLAIM = join(repoRoot, 'test', 'fixtures', 'unsupported-claim.json');

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

async function launchApp(env: Record<string, string> = {}): Promise<ElectronApplication> {
  requireBuiltApp();
  return electron.launch({
    args: [MAIN_ENTRY],
    env: { ...definedEnv(process.env), ...env },
  });
}

test.describe('837 Claim Viewer — E2E — multi-claim 837 and unsupported forms', () => {
  test('opening a multi-claim 837I file shows the "Claim in this 837 file" stepper and renders the UB-04 preview', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: MULTI_CLAIM_837I });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // The stepper (src/renderer/index.html's #claimGroup, "Claim in this
      // 837 file") is hidden for single-claim files (main.ts:278 — hidden
      // whenever state.summaries.length <= 1) and shown for a multi-claim
      // 837 batch. Two CLM loops in the fixture -> "Claim 1 of 2".
      await expect(page.locator('#claimGroup')).toBeVisible();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');

      // UB-04 preview: the pdf.js canvas actually has pixels.
      const canvasSize = await page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
      expect(canvasSize.width).toBeGreaterThan(0);
      expect(canvasSize.height).toBeGreaterThan(0);

      // Stepping to the second claim updates the label and keeps rendering.
      await page.locator('#nextClaimBtn').click();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 2 of 2');
      const canvasSizeAfterStep = await page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
      expect(canvasSizeAfterStep.width).toBeGreaterThan(0);
      expect(canvasSizeAfterStep.height).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test('opening a claim with an unrecognized form type shows the placeholder note and still populates the inspector', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: UNSUPPORTED_CLAIM });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // src/renderer/index.html's #unsupportedNote ("We can't show this
      // claim as its real paper form...") — shown only when
      // formType === 'unsupported' (main.ts:723).
      await expect(page.locator('#unsupportedNote')).toBeVisible();

      // The placeholder page itself still rendered to the canvas (a real
      // PDF page, not a blank/broken preview).
      const canvasSize = await page.locator('#pdfCanvas').evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
      expect(canvasSize.width).toBeGreaterThan(0);
      expect(canvasSize.height).toBeGreaterThan(0);

      // Inspector still populates from the parsed data (UI req: "its data
      // is still available in the inspector" — claimService.ts's own
      // renderUnsupportedPlaceholder doc comment says the same). Read via
      // textContent rather than an rendered-text assertion because the
      // <details> group may be collapsed by default; textContent reads the
      // DOM regardless of the disclosure widget's open/closed state.
      const patientGroupText = await page.locator('details[data-group-id="patient"]').textContent();
      expect(patientGroupText).toContain('UNSUPPORTEDPATIENT');

      const provenanceText = await page.locator('details[data-group-id="prov"]').textContent();
      expect(provenanceText).toContain('900000099');
    } finally {
      await app.close();
    }
  });
});
