#!/usr/bin/env node
/**
 * Dev orchestrator for `npm run dev`.
 *
 * Builds preload.cjs once (esbuild, CJS — see the note below), then starts
 * the Vite renderer dev server and a `tsc --watch` build of electron/main.ts
 * side by side, waits for both to produce their first output, then launches
 * Electron pointed at the dev server (via the ELECTRON_RENDERER_URL env
 * var, read by electron/main.ts).
 *
 * Deliberately dependency-free (no concurrently/wait-on/cross-env): plain
 * node:child_process/net/fs, so it's cross-platform without extra
 * dev-only packages — matches the task brief's "simple manual Vite+Electron
 * wiring" option instead of pulling in vite-plugin-electron.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const MAIN_JS = 'dist/electron/main.js';
const PRELOAD_CJS = 'dist/electron/preload.cjs';
const BUILT_RENDERER_DIR = 'dist/renderer';

// electron/main.ts decides dev-vs-built purely by whether
// dist/renderer/index.html exists. A stale build left over from a previous
// `npm run build` would make it load that instead of the live dev server —
// clear it so `npm run dev` always talks to Vite.
if (existsSync(BUILT_RENDERER_DIR)) {
  rmSync(BUILT_RENDERER_DIR, { recursive: true, force: true });
}

// The preload script MUST be CommonJS (sandbox:true preload scripts can't
// use ESM `import` — see electron/main.ts's comment on webPreferences.preload),
// so `tsc --watch` below (which emits ESM, per this project's
// "type":"module") can't produce it. A one-shot esbuild bundle to CJS does,
// same as the "build:preload" step in `npm run build`. Not watched: rerun
// `npm run dev` after editing electron/preload.ts.
console.log('[dev] building preload.cjs...');
const preloadBuild = spawnSync('npm', ['run', 'build:preload'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (preloadBuild.status !== 0) {
  console.error('[dev] preload build failed');
  process.exit(preloadBuild.status ?? 1);
}

// About screen's build-date stamp (docs/TABS_BUILD_PLAN.md §2c) — a
// one-shot write, same as the preload build above; not watched, so it
// reflects "when npm run dev was started" rather than every edit, which is
// fine for a dev-only build tag.
console.log('[dev] writing build-info.json...');
spawnSync('node', ['scripts/write-build-info.mjs'], { stdio: 'inherit', shell: process.platform === 'win32' });

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code ?? 0;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** @param {string} cmd @param {string[]} args @param {{env?: NodeJS.ProcessEnv, onExit?: (code: number|null) => void}} [opts] */
function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: opts.env ?? process.env,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (opts.onExit) opts.onExit(code);
    else if (code !== 0 && code !== null && !shuttingDown) shutdown(code);
  });
  return child;
}

function waitForPort(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const socket = net.createConnection(port, 'localhost');
      socket.once('connect', () => {
        socket.end();
        resolve(undefined);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for port ${port}`));
        else setTimeout(attempt, 250);
      });
    })();
  });
}

function waitForFiles(paths, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      if (paths.every((p) => existsSync(p))) return resolve(undefined);
      if (Date.now() - start > timeoutMs) return reject(new Error(`Timed out waiting for ${paths.join(', ')}`));
      setTimeout(attempt, 250);
    })();
  });
}

console.log('[dev] starting Vite dev server + tsc --watch (electron main/preload)...');
run('npx', ['vite']);
run('npx', ['tsc', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput']);

try {
  await Promise.all([waitForPort(DEV_SERVER_PORT, 30000), waitForFiles([MAIN_JS, PRELOAD_CJS], 30000)]);
} catch (err) {
  console.error('[dev]', err instanceof Error ? err.message : err);
  shutdown(1);
  process.exit(process.exitCode ?? 1);
}

console.log('[dev] launching Electron...');
run('npx', ['electron', MAIN_JS], {
  env: { ...process.env, ELECTRON_RENDERER_URL: DEV_SERVER_URL },
  // Electron exiting (window closed) ends the whole dev session, whatever
  // its exit code — it's the user-facing process here.
  onExit: (code) => shutdown(code ?? 0),
});
