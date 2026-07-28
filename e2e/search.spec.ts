import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * E2E coverage for Ctrl+F find/search across the parsed claim (docs/
 * UI_REQUIREMENTS_v3_queued_features.md §1, docs/BUILD_QUEUE.md Build 2.1 —
 * the last piece of Build 2). Drives the real, unpackaged dist/electron/main.js
 * build against the real inspector.ts/features/search.ts DOM, not the pure
 * matching logic (test/searchMatch.test.ts covers that) — see
 * e2e/decode.spec.ts's header comment for why (profile isolation, the
 * CLAIM_VIEWER_E2E_OPEN seam).
 *
 * The critical detail this file exists to prove (docs/AUDIT_BUILD1.md):
 * inspector.ts's groups render COLLAPSED by default — a naive filter reports
 * "N matches in M groups" while showing none of them. Force-opening groups
 * with a match, capturing each group's PRIOR (possibly manually toggled)
 * open state on the first keystroke, and restoring it VERBATIM on Esc/clear
 * is the actual substance of this build; "restores the hardcoded hasWarnings-
 * style hasWarnings-style defaults" would be a false pass here — the second
 * test below manually toggles two groups AWAY from their defaults first, so
 * only a real capture/restore (not "re-render from scratch") can pass it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MAIN_ENTRY = join(repoRoot, 'dist', 'electron', 'main.js');
const FIXTURE_1500 = join(repoRoot, 'test', 'fixtures', 'synthetic-1500.json');
// Two-claim 837I fixture with deliberately distinguishable claim ids/totals
// (756048Q/$89.93 vs 756049Q/$95.50 — see e2e/tabs.spec.ts's header comment)
// — used here for the 837-batch "matches in other claims" coverage.
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

test.describe('837 Claim Viewer — E2E — Ctrl+F inspector search (docs/BUILD_QUEUE.md Build 2.1)', () => {
  test('Ctrl+F focuses the search field, filters to matching rows, and keeps the match\'s group heading visible while hiding non-matching groups', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.keyboard.press('Control+f');
      await expect(page.locator('#inspectorSearchInput')).toBeFocused();

      // synthetic-1500.json's insured member id ("MEMBER001") appears ONLY
      // in the (normally collapsed) "Insured" group — the "Patient" group
      // shares the same DOB but not the member id.
      await page.locator('#inspectorSearchInput').fill('MEMBER001');

      const insuredGroup = page.locator('details[data-group-id="insured"]');
      const patientGroup = page.locator('details[data-group-id="patient"]');
      await expect(insuredGroup).toBeVisible();
      await expect(insuredGroup).toHaveJSProperty('open', true); // force-opened despite its collapsed-by-default group
      // The group's own heading stays visible even though most of its rows are filtered out.
      await expect(insuredGroup.locator('.inspGroupLabel')).toBeVisible();
      await expect(insuredGroup.locator('.inspGroupLabel')).toHaveText('Insured');
      const memberRow = insuredGroup.locator('.inspRow', { hasText: 'Member ID' });
      await expect(memberRow).toBeVisible();
      // A non-matching row in the SAME group is hidden, not just unstyled.
      const insuredNameRow = insuredGroup.locator('.inspRow').filter({ hasText: /^Name/ });
      await expect(insuredNameRow).toBeHidden();

      // A group with no match at all disappears entirely.
      await expect(patientGroup).toBeHidden();

      await expect(page.locator('#inspectorSearchSummary')).toHaveText('1 match in 1 group');
    } finally {
      await app.close();
    }
  });

  test('matches on both the value and the field label, case- and punctuation-insensitively ($1,204-style amounts and ISO dates)', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      // Value match, bare digits against a formatted dollar amount: the
      // claim's $140.00 total is in Reconciliation's "Σ line charges" and
      // "Claim total" rows — "140" (no $ or decimal point) still finds them.
      await page.keyboard.press('Control+f');
      await page.locator('#inspectorSearchInput').fill('140');
      const reconGroup = page.locator('details[data-group-id="recon"]');
      await expect(reconGroup).toBeVisible();
      await expect(reconGroup.locator('.inspRow', { hasText: 'Σ line charges' })).toBeVisible();
      await expect(reconGroup.locator('.inspRow', { hasText: 'Claim total' })).toBeVisible();

      // Label match, case-insensitive: "billing" (lowercase) finds the
      // "Providers" group's "Billing"/"Billing NPI"/etc. rows by their KEY,
      // not their value.
      await page.locator('#inspectorSearchInput').fill('billing');
      const providersGroup = page.locator('details[data-group-id="providers"]');
      await expect(providersGroup).toBeVisible();
      await expect(providersGroup.locator('.inspRow', { hasText: 'Billing NPI' })).toBeVisible();

      // ISO date value, sliced with the query's own separator: the
      // inspector shows service-line dates as the model's raw
      // "YYYY-MM-DD" ("2026-05-07") — "05/07" (slash-separated) must still
      // find it.
      await page.locator('#inspectorSearchInput').fill('05/07');
      const linesGroup = page.locator('details[data-group-id="lines"]');
      await expect(linesGroup).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test('force-opens a matching group even when the user had manually collapsed it, then restores that MANUAL state verbatim on Esc — not the group\'s hardcoded render default', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      const patientGroup = page.locator('details[data-group-id="patient"]'); // renders OPEN by default (inspector.ts's buildGroup('patient', ..., true))
      const insuredGroup = page.locator('details[data-group-id="insured"]'); // renders COLLAPSED by default, and never matches this query — proves clearFilterVisuals() re-applies the captured map to EVERY group, not only ones force-opened during the search
      await expect(patientGroup).toHaveJSProperty('open', true);
      await expect(insuredGroup).toHaveJSProperty('open', false);

      // Manually invert both away from their defaults — a real user
      // rearranging their inspector layout before searching.
      await patientGroup.locator('summary').click(); // -> closed
      await insuredGroup.locator('summary').click(); // -> open
      await expect(patientGroup).toHaveJSProperty('open', false);
      await expect(insuredGroup).toHaveJSProperty('open', true);

      // "ACCT-0001" (the patient account number, Box 2's PCN) exists ONLY
      // in the Patient group. Patient — now manually CLOSED — must be
      // force-reopened to reveal it: a real, observable false -> true flip
      // that only a correct force-open makes happen. If Esc's restore
      // instead fell back to the group's hardcoded default (also `true`
      // for Patient) rather than the captured manual value, this specific
      // case would happen to look right by accident — which is exactly why
      // the assertion after Esc below checks Patient goes back to CLOSED,
      // the manual value, not open.
      await page.keyboard.press('Control+f');
      await page.locator('#inspectorSearchInput').fill('ACCT-0001');
      await expect(patientGroup).toBeVisible();
      await expect(patientGroup).toHaveJSProperty('open', true); // force-opened
      await expect(patientGroup.locator('.inspRow', { hasText: 'Account no.' })).toBeVisible();
      // Insured has zero matches for this query — hidden entirely, `.open` left untouched.
      await expect(insuredGroup).toBeHidden();

      // "Expand all" is disabled while a query is active.
      await expect(page.locator('#expandAllBtn')).toBeDisabled();

      // Esc clears the query AND restores each group's captured state —
      // Patient back to CLOSED (the manual value; the WRONG "restore to
      // default" behavior would leave it open), Insured back to OPEN (the
      // manual value, applied even though this group was never force-opened).
      await page.keyboard.press('Escape');
      await expect(page.locator('#inspectorSearchInput')).toHaveValue('');
      await expect(patientGroup).toBeVisible();
      await expect(insuredGroup).toBeVisible();
      await expect(patientGroup).toHaveJSProperty('open', false);
      await expect(insuredGroup).toHaveJSProperty('open', true);
      await expect(page.locator('#expandAllBtn')).toBeEnabled();
    } finally {
      await app.close();
    }
  });

  test('Esc returns focus to wherever it was before Ctrl+F, and clears the query', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.locator('#zoomInBtn').focus();
      await expect(page.locator('#zoomInBtn')).toBeFocused();

      await page.keyboard.press('Control+f');
      await expect(page.locator('#inspectorSearchInput')).toBeFocused();
      await page.locator('#inspectorSearchInput').fill('140');
      await expect(page.locator('#inspectorSearchInput')).toHaveValue('140');

      await page.keyboard.press('Escape');
      await expect(page.locator('#inspectorSearchInput')).toHaveValue('');
      await expect(page.locator('#zoomInBtn')).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test('Ctrl+F is a no-op with no file open — it never steals focus', async () => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('#welcomeScreen')).toBeVisible();

      await page.keyboard.press('Control+f');
      const activeId = await page.evaluate(() => document.activeElement?.id ?? '');
      expect(activeId).not.toBe('inspectorSearchInput');
      await expect(page.locator('#inspectorSearchInput')).not.toBeFocused();
    } finally {
      await app.close();
    }
  });

  test('Enter/Shift+Enter step through matches with a persistent (non-fading) outline and an updating "match X of Y" position', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.keyboard.press('Control+f');
      // "SAMPLEPATIENT" -> exactly two matches, one each in Patient's and
      // Insured's "Name" rows (docs/BUILD_QUEUE.md — the fixture's insured
      // is the patient themself). Distinguished below by which GROUP the
      // active match sits in, not the row's key text (both rows are
      // labeled "Name").
      await page.locator('#inspectorSearchInput').fill('SAMPLEPATIENT');
      await expect(page.locator('#inspectorSearchSummary')).toContainText('2 matches in 2 groups');

      const activeMatches = page.locator('.inspRow.searchMatchActive');
      await expect(activeMatches).toHaveCount(0); // no step taken yet

      const activeGroupId = () => activeMatches.first().locator('xpath=ancestor::details[contains(@class,"inspGroup")]').getAttribute('data-group-id');

      await page.keyboard.press('Enter');
      await expect(activeMatches).toHaveCount(1);
      await expect(page.locator('#inspectorSearchSummary')).toContainText('match 1 of 2');
      const firstGroup = await activeGroupId();

      // Persistent, not a flash — still there after a beat with no further input.
      await page.waitForTimeout(400);
      await expect(activeMatches).toHaveCount(1);

      await page.keyboard.press('Enter');
      await expect(activeMatches).toHaveCount(1); // moved, not accumulated
      await expect(page.locator('#inspectorSearchSummary')).toContainText('match 2 of 2');
      const secondGroup = await activeGroupId();
      expect(secondGroup).not.toBe(firstGroup);

      // Shift+Enter steps backward, wrapping to the previous match.
      await page.keyboard.press('Shift+Enter');
      await expect(page.locator('#inspectorSearchSummary')).toContainText('match 1 of 2');
      const backGroup = await activeGroupId();
      expect(backGroup).toBe(firstGroup);
    } finally {
      await app.close();
    }
  });

  test('empty state names the query and, when applicable, that other claims in this file match', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_1500 });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();

      await page.keyboard.press('Control+f');
      await page.locator('#inspectorSearchInput').fill('zzzznomatch');
      await expect(page.locator('#inspectorSearchSummary')).toHaveText("No matches for 'zzzznomatch' in this claim.");
      // Every group is hidden — there's nothing to show.
      await expect(page.locator('details.inspGroup:visible')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('837 batch: reports matches in OTHER claims with a click-to-jump control that switches the active claim and preserves the query', async () => {
    const app = await launchApp({ CLAIM_VIEWER_E2E_OPEN: FIXTURE_837I });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#welcomeOpenBtn').click();
      await expect(page.locator('#workspaceScreen')).toBeVisible();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 1 of 2');

      // Claim 1's id is 756048Q; claim 2's is 756049Q (see this file's
      // header) — searching the SECOND claim's id while claim 1 is active
      // finds nothing locally but should surface it as an other-claims match.
      await page.keyboard.press('Control+f');
      await page.locator('#inspectorSearchInput').fill('756049');

      await expect(page.locator('#inspectorSearchSummary')).toHaveText(
        "No matches for '756049' in this claim — but 1 other claim in this file matches.",
      );
      const jumpBtn = page.locator('#inspectorSearchOtherClaims');
      await expect(jumpBtn).toBeVisible();
      await expect(jumpBtn).toHaveText('1 more match in 1 other claim');

      await jumpBtn.click();
      await expect(page.locator('#claimStepLabel')).toHaveText('Claim 2 of 2');
      // The query itself is preserved across the jump.
      await expect(page.locator('#inspectorSearchInput')).toHaveValue('756049');
      // And now matches locally, in claim 2's own Provenance group.
      const provGroup = page.locator('details[data-group-id="prov"]');
      await expect(provGroup).toBeVisible();
      const claimIdRow = provGroup.locator('.inspRow', { hasText: 'Claim ID' });
      await expect(claimIdRow).toBeVisible();
      await expect(page.locator('#inspectorSearchOtherClaims')).toBeHidden();
    } finally {
      await app.close();
    }
  });
});
