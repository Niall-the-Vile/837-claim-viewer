import { defineConfig } from '@playwright/test';

/**
 * Dedicated config for `npm run screenshots` (docs/TABS_BUILD_PLAN.md §3b).
 *
 * Why this file exists rather than just running
 * `playwright test e2e/screenshots.spec.ts` against the main
 * playwright.config.ts: Playwright's `testIgnore` filters which files are
 * discovered in the first place, and a file positional argument only
 * narrows an already-discovered set — it cannot "un-ignore" a file that
 * `testIgnore` excluded at discovery time. Since playwright.config.ts's
 * `testIgnore: ['**\/screenshots.spec.ts']` is exactly what keeps
 * e2e/screenshots.spec.ts out of `npm run verify` / a bare
 * `npx playwright test` (so a screenshot failure can never break the build
 * gate), this second config is required to run it at all. Everything else
 * (timeouts, workers:1 — one Electron process at a time, same reasoning as
 * playwright.config.ts) mirrors the main config.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/screenshots.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
