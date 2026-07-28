import { uiScaleValueLabelEl } from '../dom.js';

/**
 * View menu's "UI text scale" (docs/UI_REQUIREMENTS_v3_queued_features.md §9
 * / docs/BUILD_QUEUE.md Build 2.0). Filed *critical* by the low-vision
 * reviewer (Windows display scaling at 175% breaks this app's layout today)
 * — this is the mechanism that fixes it, and per §9 it's the stated
 * acceptance criterion (survive 175%) every surface Builds 2-5 add is
 * measured against, so it had to land first.
 *
 * MECHANISM (the part §9 says was previously unspecified and where "the
 * obvious choices are all wrong"):
 * - A `--ui-scale` CSS custom property (a plain multiplier: 1 / 1.25 / 1.5 /
 *   1.75), set on `documentElement` here, consumed by style.css as CSS
 *   `zoom` on the app CHROME ONLY — #titlebar, #menubar, #tabStrip,
 *   #toolbar, .warnBanner, #inspector, #statusBar, .dialog, #toast — each
 *   zoomed as its own INDEPENDENT subtree (see style.css's `--ui-scale`
 *   comment for the full architecture and why that avoids the
 *   compounding-zoom trap the spec warns about).
 * - Explicitly NEVER `webFrame.setZoomFactor`/`webContents.setZoomFactor` —
 *   forbidden by §9: those scale the pdf.js canvas too (breaking the
 *   independent per-tab PDF zoom control, preview.ts) and change
 *   `devicePixelRatio` (corrupting `#pdfCanvas` width/height assertions in
 *   e2e/app.spec.ts).
 * - `#pdfScroll`/`#pdfCanvas` are never touched by any of this — see
 *   preview.ts's `availableViewport()` doc comment for why its
 *   `getBoundingClientRect()` reads stay accurate at every scale without
 *   needing a correction.
 *
 * Persisted inside the EXISTING `session.json` (src/app/persistence/
 * sessionStore.ts's `saveUiScale`/`SessionData.uiScale`, surfaced over the
 * bridge as `claimApi.saveUiScale`/`getSessionRestoreState().uiScale`) —
 * never a second userData file (docs/BUILD_QUEUE.md rule 12).
 */

/** The only four values the View menu ever cycles through — structurally identical to src/app/persistence/sessionStore.ts's UI_SCALE_VALUES and electron/preload.ts's UI_SCALE_VALUES (each declared independently for the same "no cross-process import" reason every other DTO in this app is). */
export const UI_SCALE_STEPS = [100, 125, 150, 175] as const;
export type UiScalePercent = (typeof UI_SCALE_STEPS)[number];

function isUiScalePercent(value: number): value is UiScalePercent {
  return (UI_SCALE_STEPS as readonly number[]).includes(value);
}

let currentPercent: UiScalePercent = 100;

/**
 * The current scale as a plain multiplier (1 / 1.25 / 1.5 / 1.75) — exposed
 * for any future feature that needs it. Nothing in THIS build reads it:
 * preview.ts's fit-page/fit-width/zoom-at-pointer math deliberately does
 * NOT divide by it (see that file's `availableViewport` doc comment for
 * why doing so would be a bug, not the "mandatory correction" it might look
 * like at first read of §9).
 */
export function getUiScale(): number {
  return currentPercent / 100;
}

/** The current scale as the percent shown in the View menu (100/125/150/175). */
export function getUiScalePercent(): UiScalePercent {
  return currentPercent;
}

function applyScale(percent: UiScalePercent): void {
  currentPercent = percent;
  document.documentElement.style.setProperty('--ui-scale', String(percent / 100));
  uiScaleValueLabelEl.textContent = `${percent}%`;
}

/**
 * Startup: applies the persisted scale (session.json's `uiScale`, read via
 * the same `claimApi.getSessionRestoreState()` round trip main.ts's
 * `initSessionRestore` makes for tabs — see that call site). Never fails
 * startup on a read error, same "never fail startup on it" posture as every
 * other session.json consumer in this app — the default (100%) just stays
 * in effect.
 */
export async function initUiScale(): Promise<void> {
  let percent: UiScalePercent = 100;
  try {
    const restoreState = await window.claimApi.getSessionRestoreState();
    if (isUiScalePercent(restoreState.uiScale)) percent = restoreState.uiScale;
  } catch {
    // Best-effort — see doc comment above.
  }
  applyScale(percent);
}

/**
 * View menu's "UI text scale" action: cycles 100 -> 125 -> 150 -> 175 -> 100,
 * matching the design's single cycling affordance (docs/design/
 * ClaimViewer_v2.dc.html's `cycleUiScale`/command-palette entry — "UI scale
 * — cycle 100/125/150/175%"), not four separate menu items. Applies
 * immediately; persists best-effort (a failed write here must never disturb
 * the UI, same posture as main.ts's persistSession for tabs).
 */
export function cycleUiScale(): void {
  const idx = UI_SCALE_STEPS.indexOf(currentPercent);
  const next = UI_SCALE_STEPS[(idx + 1) % UI_SCALE_STEPS.length]!;
  applyScale(next);
  window.claimApi.saveUiScale(next).catch(() => {
    // Best-effort — see doc comment above.
  });
}
