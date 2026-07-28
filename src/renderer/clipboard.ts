import { showToast } from './overlays.js';

/**
 * The one shared clipboard-write helper (docs/TABS_BUILD_PLAN.md §2f):
 * factored out of the pre-existing error-details copy site
 * (previously inline in main.ts's errorCopyBtn handler) so it, plus the new
 * service-lines-TSV / per-field / claim-summary / warnings-and-
 * reconciliation copy actions, all go through one call.
 *
 * Uses `navigator.clipboard.writeText` — the same browser API the
 * error-details copy button already used. Deliberately NOT Electron's
 * `clipboard` module: the renderer runs with `sandbox: true` +
 * `contextIsolation: true` (electron/main.ts), so `require('electron')`
 * inside this file would throw at load time — see
 * docs/TABS_BUILD_PLAN.md §2f's explicit warning about this exact wrong
 * turn. No new preload/contextBridge key is added for clipboard access;
 * `navigator.clipboard` is a standard, sandbox-safe web API.
 *
 * Clipboard copies put PHI on the clipboard — the same exposure class as
 * the on-screen data already is (no disk write, no network call), so this
 * doesn't change the app's offline/PHI posture. It must never be extended
 * to writing files.
 */
export function copyToClipboard(text: string, successMsg: string): void {
  void navigator.clipboard.writeText(text).then(
    () => showToast(successMsg, false),
    () => showToast('Could not copy to the clipboard.', true),
  );
}
