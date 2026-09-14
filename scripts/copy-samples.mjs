#!/usr/bin/env node
/**
 * Copies the bundled synthetic sample-claim fixtures from src/samples/ to
 * dist/src/samples/ — same reasoning as scripts/copy-fonts.mjs: `tsc` only
 * emits .js from .ts and never copies a non-TypeScript asset, so without
 * this step dist/src/samples/ never exists and electron/main.ts's
 * `dialog:openSampleClaim` handler (which resolves a sample id to a path
 * under dist/src/samples/, sibling to dist/electron/) would find nothing.
 * electron-builder's `files` list already includes `dist/src/**\/*`, so no
 * package.json change is needed to ship these a handful of small,
 * already-PHI-free `.dat` fixtures inside the asar (same "Electron's fs
 * reads asar-packed files transparently" note as copy-fonts.mjs).
 *
 * Run as part of `npm run build:app` (see package.json), after `tsc` has
 * created dist/src/.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(repoRoot, 'src', 'samples');
const outDir = join(repoRoot, 'dist', 'src', 'samples');

mkdirSync(outDir, { recursive: true });

const sampleFiles = readdirSync(srcDir).filter((name) => name.endsWith('.dat'));
if (sampleFiles.length === 0) {
  console.error(`[copy-samples] no .dat files found in ${srcDir}`);
  process.exitCode = 1;
}

for (const name of sampleFiles) {
  copyFileSync(join(srcDir, name), join(outDir, name));
}

console.log(`[copy-samples] copied ${sampleFiles.length} sample fixture(s) to ${outDir}`);
