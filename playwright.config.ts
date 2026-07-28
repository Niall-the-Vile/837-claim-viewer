import { defineConfig } from '@playwright/test';

/**
 * E2E config for the Electron app (e2e/app.spec.ts). There's no `use:
 * {browserName}` project here on purpose — these specs drive the app via
 * Playwright's `_electron.launch()` directly (see e2e/app.spec.ts), not the
 * standard browser-project mechanism, so this file only needs the
 * test-runner-level settings (where the specs live, timeouts, how many run
 * at once).
 *
 * `workers: 1` / `fullyParallel: false`: each spec launches its own
 * Electron process (a real window, a real IPC main process, its own
 * offline-kill-switch session) — running more than one at a time buys
 * nothing on a single-machine offline viewer and only risks port/profile
 * contention between two Electron instances.
 */
export default defineConfig({
  testDir: './e2e',
  // e2e/screenshots.spec.ts (docs/TABS_BUILD_PLAN.md §3b) is a visual record,
  // not a correctness gate — it must never be able to fail `npm run verify` /
  // a plain `npx playwright test`. It has its own script, `npm run
  // screenshots`, which runs it via playwright.screenshots.config.ts (a
  // testIgnore only filters discovery, so a same-config file argument can't
  // "un-ignore" it — see that file's header comment).
  testIgnore: ['**/screenshots.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
