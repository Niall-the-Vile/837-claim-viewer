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
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'dist', 'electron');
const outFile = join(outDir, 'build-info.json');

mkdirSync(outDir, { recursive: true });
const buildInfo = { buildDate: new Date().toISOString() };
writeFileSync(outFile, JSON.stringify(buildInfo, null, 2), 'utf8');

console.log(`[write-build-info] wrote ${outFile} (buildDate: ${buildInfo.buildDate})`);
