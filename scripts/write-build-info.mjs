#!/usr/bin/env node
/**
 * Writes dist/electron/build-info.json — `{ "buildDate": "<ISO 8601 UTC>" }`
 * — read by electron/main.ts's `app:getInfo` IPC handler to back the
 * About screen's version + build-date stamp (docs/TABS_BUILD_PLAN.md §2c).
 *
 * A plain build-time write rather than a Vite `define`, because the
 * consumer is the MAIN process (electron/main.ts, compiled by plain `tsc`,
 * never touched by Vite — vite.config.ts only builds src/renderer) and it
 * must also work in the packaged app: electron-builder's `files` allowlist
 * in package.json already includes everything under dist/electron/, so this
 * file ships inside the asar for free, no separate packaging step needed
 * (same reasoning as scripts/copy-fonts.mjs's header comment).
 *
 * Run as part of `npm run build:app`, after `tsc` has created
 * dist/electron/ (see package.json's "build:app" script) — this only
 * WRITES a new file there, it never depends on tsc's own output.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'dist', 'electron');
const outFile = join(outDir, 'build-info.json');

/*
 * The VERSION is stamped here too, not read from `app.getVersion()` at
 * runtime. `app.getVersion()` only returns this app's version when Electron
 * can find the app's own package.json — which it can't when launched via a
 * bare script path (`electron dist/electron/main.js`), the way `npm start`
 * and every Playwright E2E launches it. In that case it silently falls back
 * to ELECTRON's version, so the About screen read "Version 43.2.0" instead
 * of 0.0.1. Stamping it at build time is correct in dev, E2E and packaged
 * alike.
 */
const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

mkdirSync(outDir, { recursive: true });
const buildInfo = { version, buildDate: new Date().toISOString() };
writeFileSync(outFile, JSON.stringify(buildInfo, null, 2), 'utf8');

console.log(`[write-build-info] wrote ${outFile} (version: ${version}, buildDate: ${buildInfo.buildDate})`);
