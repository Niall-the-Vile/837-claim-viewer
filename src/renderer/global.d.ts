import type { ClaimApi } from '../../electron/preload.js';

/**
 * Types the `window.claimApi` bridge exposed by electron/preload.ts's
 * `contextBridge.exposeInMainWorld`. Type-only — imports nothing at
 * runtime, so this has no effect on the renderer bundle.
 */
declare global {
  interface Window {
    claimApi: ClaimApi;
  }
}

export {};
