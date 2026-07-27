import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Builds the renderer only (src/renderer -> dist/renderer). Electron's main
 * and preload processes are compiled separately by `tsc` (see package.json
 * "build"/"dev" scripts) — this project deliberately keeps the two build
 * paths distinct rather than pulling in vite-plugin-electron, per the task
 * brief's "simple manual Vite+Electron wiring" option.
 *
 * `base: './'` matters: the built app is loaded via `win.loadFile()`
 * (a file:// URL), so all asset references must be relative, never
 * root-absolute ('/...'), or they'd fail to resolve.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
