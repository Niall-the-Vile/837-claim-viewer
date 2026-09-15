#!/usr/bin/env node
/**
 * Copies the repo-root CHANGELOG.md to dist/electron/CHANGELOG.md — same
 * reasoning as scripts/write-build-info.mjs: the consumer is the MAIN
 * process (electron/main.ts's `app:getChangelog` IPC handler, read as a
 * same-directory sibling of build-info.json via `join(__dirname,
 * 'CHANGELOG.md')`), and package.json's `files` allowlist already includes
 * `dist/electron/**\/*`, so this ships inside the asar for free with no
 * separate packaging step (Build 7 — Installation & deployment
 * enhancements, "bundled what's new changelog" item — a build-time local
 * file, never a network fetch).
 *
 * Run as part of `npm run build:app` (see package.json), after `tsc` has
 * created dist/electron/.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(repoRoot, 'CHANGELOG.md');
const outDir = join(repoRoot, 'dist', 'electron');
const outFile = join(outDir, 'CHANGELOG.md');

mkdirSync(outDir, { recursive: true });
copyFileSync(src, outFile);

console.log(`[copy-changelog] copied ${src} to ${outFile}`);
