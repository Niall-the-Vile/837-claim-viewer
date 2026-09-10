/**
 * Small inline-SVG markup strings shared by inspector.ts (per-row copy
 * button, warning-row severity glyph) and main.ts (warnings-banner severity
 * glyph, "copy summary"/"copy warnings" buttons) — kept as plain strings
 * (not DOM-building code) so this file has zero DOM dependency and stays
 * safe to import from anywhere, including test code.
 *
 * Severity glyphs (docs/TABS_BUILD_PLAN.md §2f item 4 — filed as *critical*
 * by the colour-blind reviewer): a filled triangle for `warning`, an
 * outlined circle for `info`/"Note" — a distinct SHAPE per severity, not
 * just colour, so the two are still distinguishable without colour vision.
 */

export const ICON_SEVERITY_WARNING =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 1.3 15.2 14H0.8Z" /></svg>';

export const ICON_SEVERITY_NOTE =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.3" /></svg>';

export const ICON_COPY =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="4.5" width="9" height="9" rx="1.2" /><path d="M2.5 10V2.7a1.2 1.2 0 0 1 1.2-1.2H10" /></svg>';

/**
 * Editable-fields feature (docs/EDITABLE_FIELDS_DESIGN.md §3): the pencil
 * affordance shown next to the copy icon on an editable inspector row while
 * Edit mode is on, and on the toolbar's Edit-mode toggle button.
 */
export const ICON_EDIT =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5.6 12.2 2.5 13l0.8-3.1Z" /></svg>';

/** Revert-one-field icon (a counter-clockwise arrow) — shown on an edited row so a user can put that one field back to its originally-parsed value without needing to know the artifact file format. */
export const ICON_REVERT =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 1 1.6 3.7" /><path d="M3 4.5V8h3.5" /></svg>';
