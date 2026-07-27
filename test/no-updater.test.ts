import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Updater-grep gate (BUILD_PLAN.md §6/§8 "No electron-updater, no publish:
 * config... Updates = manual reinstall" / AUDIT_REPORT.md coverage-gap #3):
 * this offline, single-machine viewer must never self-update or phone home
 * for a new version. There is deliberately no runtime code to test here
 * (there's no update feature to exercise) — the guard is static: no source
 * or build output may reference `autoUpdater`, the `electron-updater`
 * package, or CMS's default update-feed host, and package.json must not
 * depend on `electron-updater` or declare a `build.publish` target (the
 * electron-builder auto-update publish config).
 *
 * Scans src/**, electron/**, and, when present, the *shipped* slice of the
 * built dist/** output — dist/electron, dist/renderer, dist/src, exactly
 * the directories package.json's build.files allowlist packages into the
 * asar (dist/test and dist/scripts are tsc's compiled copies of this repo's
 * own test/ and scripts/ trees, never shipped, and dist/test in particular
 * would trip this same grep on itself — this file's own compiled source
 * literally contains the string "autoUpdater" as a regex literal). Built by
 * `npm run build`, which runs after `npm test` in `npm run verify` — see
 * package.json's "verify" script — so dist/ may not exist yet when this
 * runs standalone; when it doesn't, this test still fully covers src/ and
 * electron/, and simply skips the dist/ pass rather than failing on a build
 * order it doesn't control.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const BANNED_PATTERNS: RegExp[] = [
  /autoUpdater/i,
  /electron-updater/i,
  /update\.electronjs\.org/i,
];

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html']);

/** Directory names never worth descending into (nothing under these is ever shipped/authored code). */
const SKIP_DIRS = new Set(['node_modules', '.git']);

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (SCAN_EXTENSIONS.has(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function findBannedReferences(files: string[]): Array<{ file: string; pattern: string }> {
  const hits: Array<{ file: string; pattern: string }> = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(text)) hits.push({ file, pattern: pattern.source });
    }
  }
  return hits;
}

describe('No-updater gate: this app never self-updates', () => {
  it('src/ and electron/ contain no autoUpdater / electron-updater / update-feed reference', () => {
    const files = [...listFilesRecursive(join(repoRoot, 'src')), ...listFilesRecursive(join(repoRoot, 'electron'))];
    expect(files.length).toBeGreaterThan(0); // sanity: the scan actually found source files
    expect(findBannedReferences(files)).toEqual([]);
  });

  it('the shipped dist/ output (dist/electron, dist/renderer, dist/src — the asar contents) contains no autoUpdater / electron-updater / update-feed reference, when a build exists', () => {
    const shippedDirs = ['electron', 'renderer', 'src'].map((name) => join(repoRoot, 'dist', name));
    const existingDirs = shippedDirs.filter((dir) => existsSync(dir));
    if (existingDirs.length === 0) {
      // Not built yet (e.g. `npm test` run standalone, before `npm run
      // build`) — nothing to scan. `npm run verify` always builds before
      // this would matter for a release gate.
      return;
    }
    const files = existingDirs.flatMap((dir) => listFilesRecursive(dir));
    expect(findBannedReferences(files)).toEqual([]);
  });

  it('package.json declares no electron-updater dependency and no build.publish (electron-builder auto-update) config', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build?: { publish?: unknown };
    };
    expect(pkg.dependencies?.['electron-updater']).toBeUndefined();
    expect(pkg.devDependencies?.['electron-updater']).toBeUndefined();
    expect(pkg.build?.publish).toBeUndefined();
  });
});
