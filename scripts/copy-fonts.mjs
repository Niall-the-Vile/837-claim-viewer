#!/usr/bin/env node
/**
 * Copies the bundled Unicode TTFs from src/render/fonts/ to dist/src/render/fonts/.
 *
 * `tsc` only emits .js from .ts — it never copies non-TypeScript assets, so
 * without this step dist/src/render/fonts/ never exists and
 * embedUnicodeFonts() (src/render/text.ts) silently falls back to the
 * base-14 StandardFonts on every build. text.ts resolves its font directory
 * relative to its own compiled location (`dirname(fileURLToPath(import.meta.url))`),
 * so once these files are copied next to dist/src/render/text.js this works
 * unchanged both for the dev/build dist tree and inside the electron-builder
 * asar (Electron's fs reads asar-packed files transparently, so no
 * extraResources/unpacked step is needed for a handful of small font files).
 *
 * Run as part of `npm run build` (see package.json), after `tsc` has created
 * dist/src/render/.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(repoRoot, 'src', 'render', 'fonts');
const outDir = join(repoRoot, 'dist', 'src', 'render', 'fonts');

mkdirSync(outDir, { recursive: true });

const fontFiles = readdirSync(srcDir).filter((name) => name.endsWith('.ttf'));
if (fontFiles.length === 0) {
  console.error(`[copy-fonts] no .ttf files found in ${srcDir}`);
  process.exitCode = 1;
}

for (const name of fontFiles) {
  copyFileSync(join(srcDir, name), join(outDir, name));
}

console.log(`[copy-fonts] copied ${fontFiles.length} font file(s) to ${outDir}`);
