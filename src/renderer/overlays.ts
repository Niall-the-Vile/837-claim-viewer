import {
  exportBtn,
  exportOverlayEl,
  exportIntroEl,
  manifestFormEl,
  manifestLinesEl,
  manifestTotalEl,
  manifestWarningsEl,
  exportConfirmBtn,
  shortcutsOverlayEl,
  aboutOverlayEl,
  forgetOverlayEl,
  toastEl,
  toastMessageEl,
  toastActionsEl,
  toastOpenFolderBtn,
  toastOpenPdfBtn,
  toastCloseBtn,
} from './dom.js';
import { activeTab } from './tabs.js';
import { formatMoney, formTypeText } from './inspector.js';

/**
 * Export dialog, shortcuts sheet's generic overlay mechanics (open/close/
 * focus-trap), and the toast. Pure-moved out of main.ts — see
 * docs/TABS_BUILD_PLAN.md §2 Item 0.
 */

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Motion: prefers-reduced-motion (only consumed by the overlay/toast close
// delays below — see main.ts for the loading-screen floor's own use of the
// same OS setting, which stays there since it isn't an overlay concern).
// ---------------------------------------------------------------------------

/**
 * Read once via matchMedia rather than inferring it from CSS, so the two
 * JS-driven timing decisions below (the toast/dialog close delay) can honor
 * the same preference style.css's `@media (prefers-reduced-motion: reduce)`
 * block already collapses every animation/transition under — a user who
 * asked the OS for reduced motion shouldn't still sit through a close
 * delay whose animation became invisible but whose timer didn't.
 */
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

// ---------------------------------------------------------------------------
// Export dialog
// ---------------------------------------------------------------------------

/**
 * Modal dialog focus management (WCAG-AA — spec §2): on open, focus moves
 * into the dialog; Tab/Shift+Tab is trapped inside it (see
 * trapTabInOverlay(), wired from the keydown handler below) so
 * behind-the-scrim controls are never Tab-reachable while a dialog is open;
 * on close, focus is restored to whatever control invoked the dialog.
 *
 * Keyed by OverlayId (docs/AUDIT_BUILD1.md MUST FIX #8 — matches
 * overlayCloseTimers' existing per-id pattern below) rather than a single
 * module-level variable: openOverlay() below now force-closes any OTHER
 * open overlay before opening a new one, so at most one entry in this
 * record is ever non-null at a time, but keying it by id keeps that
 * invariant explicit rather than relying on one shared variable never being
 * clobbered by the wrong caller.
 */
const lastFocusedBeforeOverlay: Record<OverlayId, HTMLElement | null> = { export: null, shortcuts: null, about: null, forget: null };

/**
 * The scrim + dialog fade/scale out on close (spec requirement 4) rather
 * than vanishing on the spot like every other `hidden`-driven element in
 * this file — see style.css's `.overlay.isClosing` comment for why a
 * dialog close can afford the brief, deliberate delay that a hot-path
 * element (menu dropdown, state screen) can't. Keyed by overlay id so
 * opening one overlay can never cancel an in-flight close of the other.
 */
const OVERLAY_EXIT_MS = 150; // keep in sync with .overlay.isClosing / .dialog's exit-animation duration in style.css

/**
 * The four modal overlays this app has (docs/TABS_BUILD_PLAN.md §2c/§2e
 * added 'about'/'forget' to the original 'export'/'shortcuts' pair) — every
 * open/close/focus-trap/Escape function below is generic over this list
 * rather than special-casing each id, so a future 5th overlay is a
 * one-line addition to OVERLAY_IDS/overlayElFor instead of touching every
 * function in this file.
 */
export type OverlayId = 'export' | 'shortcuts' | 'about' | 'forget';
const OVERLAY_IDS: OverlayId[] = ['export', 'shortcuts', 'about', 'forget'];
const overlayCloseTimers: Record<OverlayId, number | undefined> = { export: undefined, shortcuts: undefined, about: undefined, forget: undefined };

function overlayElFor(id: OverlayId): HTMLDivElement {
  switch (id) {
    case 'export':
      return exportOverlayEl;
    case 'shortcuts':
      return shortcutsOverlayEl;
    case 'about':
      return aboutOverlayEl;
    case 'forget':
      return forgetOverlayEl;
  }
}

/** All focusable elements within `container`, in DOM order — used both to find the dialog's first control on open and to compute the Tab-trap boundary. */
export function focusableEls(container: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

export function openOverlay(id: OverlayId): void {
  // docs/AUDIT_BUILD1.md MUST FIX #8: F1 (opens 'shortcuts') and Ctrl+E
  // (opens 'export') used to have no anyOverlayOpen() guard, unlike every
  // other entry point in this app — so pressing one while the other's
  // dialog was already open stacked a SECOND non-hidden overlay. Rather
  // than adding a guard at every current (and future) call site, make
  // openOverlay itself the single choke point: opening any overlay first
  // force-closes whichever OTHER one is currently open, instantly (no exit
  // animation — this is a programmatic replace, not a user-dismissed
  // close, and there is no invoking control to restore focus to for the one
  // being displaced). This also makes Escape's fixed-order resolution
  // (OVERLAY_IDS, openOverlayId() below) moot in practice: at most one
  // overlay is ever open at a time now, so there is never an ambiguous
  // "which one does Escape mean" case.
  for (const otherId of OVERLAY_IDS) {
    if (otherId === id) continue;
    const other = overlayElFor(otherId);
    if (other.hidden) continue;
    const otherTimer = overlayCloseTimers[otherId];
    if (otherTimer !== undefined) {
      window.clearTimeout(otherTimer);
      overlayCloseTimers[otherId] = undefined;
    }
    other.hidden = true;
    other.classList.remove('isClosing');
    lastFocusedBeforeOverlay[otherId] = null;
  }

  // Reopening while a previous close is still fading out (fast double-toggle)
  // must win outright: drop the pending hide so it can't fire mid-reopen.
  const pendingClose = overlayCloseTimers[id];
  if (pendingClose !== undefined) {
    window.clearTimeout(pendingClose);
    overlayCloseTimers[id] = undefined;
  }
  const overlay = overlayElFor(id);
  overlay.classList.remove('isClosing');

  lastFocusedBeforeOverlay[id] = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay.hidden = false;
  const dialog = overlay.querySelector<HTMLElement>('.dialog');
  if (!dialog) return;
  // Focus the dialog container itself (its accessible name comes from
  // aria-labelledby -> the title span), rather than guessing which inner
  // control counts as "first" — this reads the title to screen-reader users
  // immediately on open and is a well-established APG pattern for dialogs
  // that don't have one obvious initial control.
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  dialog.focus();
}

export function closeOverlay(id: OverlayId): void {
  const overlay = overlayElFor(id);
  if (overlay.hidden || overlay.classList.contains('isClosing')) return; // already closed, or already closing
  const restore = lastFocusedBeforeOverlay[id];
  lastFocusedBeforeOverlay[id] = null;

  const finish = (): void => {
    overlay.hidden = true;
    overlay.classList.remove('isClosing');
    overlayCloseTimers[id] = undefined;
    restore?.focus();
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }
  overlay.classList.add('isClosing');
  overlayCloseTimers[id] = window.setTimeout(finish, OVERLAY_EXIT_MS);
}

export function anyOverlayOpen(): boolean {
  return OVERLAY_IDS.some((id) => !overlayElFor(id).hidden);
}

/** The currently-open overlay's id, or null if none is open — used by the Escape handler (shortcuts.ts) to close only the one that's actually open, and internally by trapTabInOverlay below. */
export function openOverlayId(): OverlayId | null {
  return OVERLAY_IDS.find((id) => !overlayElFor(id).hidden) ?? null;
}

/** Tab/Shift+Tab trap for whichever overlay is currently open — called from the keydown handler (shortcuts.ts) whenever anyOverlayOpen() and the key is Tab. */
export function trapTabInOverlay(event: KeyboardEvent): void {
  const openId = openOverlayId();
  const activeOverlay = openId ? overlayElFor(openId) : null;
  if (!activeOverlay) return;
  const dialog = activeOverlay.querySelector<HTMLElement>('.dialog');
  if (!dialog) return;

  const focusables = focusableEls(dialog);
  if (focusables.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const current = document.activeElement;
  const insideDialog = current instanceof Node && dialog.contains(current);

  if (event.shiftKey) {
    if (!insideDialog || current === first || current === dialog) {
      event.preventDefault();
      last.focus();
    }
  } else if (!insideDialog || current === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openExportDialog(): void {
  if (exportBtn.disabled) return;
  const tab = activeTab();
  if (!tab) return;
  const summary = tab.summaries[tab.currentIndex];
  const detail = tab.detail;
  if (!summary || !detail) return;

  exportIntroEl.textContent = `Export this claim (${summary.claimId || 'claim'}) as a PDF.`;
  manifestFormEl.textContent = formTypeText(summary.formType);
  manifestLinesEl.textContent = String(detail.serviceLines.length);
  manifestTotalEl.textContent = formatMoney(detail.totals.totalCharge);
  manifestWarningsEl.textContent = detail.warnings.length === 0 ? 'None' : `${detail.warnings.length} noted in the inspector`;

  exportConfirmBtn.disabled = false;
  exportConfirmBtn.textContent = 'Export';
  openOverlay('export');
}

export async function confirmExport(): Promise<void> {
  const tab = activeTab();
  if (!tab || !tab.sessionId) return;
  exportConfirmBtn.disabled = true;
  exportConfirmBtn.textContent = 'Exporting…';
  try {
    // claimApi.exportPdf opens its own native save-file dialog (with a
    // PHI-free default name) and writes the PDF; it resolves the saved
    // path, or null if the user cancels that dialog.
    const path = await window.claimApi.exportPdf(tab.sessionId, tab.currentIndex);
    closeOverlay('export');
    // The export "done" state (Open containing folder / Open PDF, design
    // ClaimViewer_v2.dc.html:776-777 / spec §7) lives in the toast rather
    // than as a second screen inside the export dialog itself, so
    // confirming export still closes the dialog immediately — exactly what
    // it did before these actions existed.
    if (path) showToast(`Exported to ${path}`, false, true);
  } catch (err) {
    closeOverlay('export');
    showToast(errorMessage(err), true);
  } finally {
    exportConfirmBtn.disabled = false;
    exportConfirmBtn.textContent = 'Export';
  }
}

/** Ctrl+Shift+E ("export this claim, skip the confirmation dialog"): calls claimApi.exportPdf directly — the user still sees the native OS save dialog (there's no way around that), only the app's own manifest/PHI-notice confirmation step is skipped. */
export async function exportCurrentClaimSkipDialog(): Promise<void> {
  if (exportBtn.disabled) return;
  if (anyOverlayOpen()) return;
  const tab = activeTab();
  if (!tab || !tab.sessionId) return;
  try {
    const path = await window.claimApi.exportPdf(tab.sessionId, tab.currentIndex);
    if (path) showToast(`Exported to ${path}`, false, true);
  } catch (err) {
    showToast(errorMessage(err), true);
  }
}

for (const id of OVERLAY_IDS) {
  const el = overlayElFor(id);
  el.addEventListener('click', (event) => {
    if (event.target === el) closeOverlay(id);
  });
}
function isOverlayId(value: string | undefined): value is OverlayId {
  return value === 'export' || value === 'shortcuts' || value === 'about' || value === 'forget';
}
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset['close'];
    if (isOverlayId(id)) closeOverlay(id);
  });
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastAutoDismissTimer: number | undefined;
let toastHideTimer: number | undefined;

const TOAST_EXIT_MS = 150; // keep in sync with .toast.isClosing's exit-animation duration in style.css

/** Fades the toast out (spec requirement 3) and only then hides it — same close-is-a-deliberate-action reasoning, and the same pattern, as closeOverlay() above. Safe to call while the toast is already hidden or already closing (both no-op). */
function dismissToast(): void {
  if (toastEl.hidden || toastEl.classList.contains('isClosing')) return;
  if (toastAutoDismissTimer !== undefined) {
    window.clearTimeout(toastAutoDismissTimer);
    toastAutoDismissTimer = undefined;
  }

  const finish = (): void => {
    toastEl.hidden = true;
    toastEl.classList.remove('isClosing');
    toastHideTimer = undefined;
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }
  toastEl.classList.add('isClosing');
  toastHideTimer = window.setTimeout(finish, TOAST_EXIT_MS);
}

/** `withActions`: shows the "Open containing folder" / "Open PDF" export-done actions (spec §7) alongside the message, and stays up longer so there's time to click one. */
export function showToast(message: string, isError: boolean, withActions = false): void {
  if (toastAutoDismissTimer !== undefined) window.clearTimeout(toastAutoDismissTimer);
  if (toastHideTimer !== undefined) window.clearTimeout(toastHideTimer);
  toastEl.classList.remove('isClosing');
  toastMessageEl.textContent = message;
  toastEl.classList.toggle('isError', isError);
  toastActionsEl.hidden = !withActions;
  toastEl.hidden = false;
  toastAutoDismissTimer = window.setTimeout(dismissToast, withActions ? 15000 : 6000);
}

toastCloseBtn.addEventListener('click', dismissToast);

toastOpenFolderBtn.addEventListener('click', () => {
  void window.claimApi.openExport('folder').catch((err) => showToast(errorMessage(err), true));
});
toastOpenPdfBtn.addEventListener('click', () => {
  void window.claimApi.openExport('file').catch((err) => showToast(errorMessage(err), true));
});
