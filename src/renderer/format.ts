import type { FormType, WarningSeverity } from '../model/claim.js';

/**
 * Small, pure text-formatting helpers with NO DOM dependency — deliberately
 * split out of inspector.ts (docs/TABS_BUILD_PLAN.md §2f) so the clipboard
 * formatters in clipboardFormat.ts can import them without dragging in
 * dom.ts/tabs.ts's module-level `document.getElementById`/pdf.js side
 * effects, which would blow up under vitest's Node (non-DOM) test
 * environment. inspector.ts re-exports formatMoney/formTypeText from here so
 * main.ts/overlays.ts's existing imports don't need to change.
 */

export function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function formTypeText(formType: FormType): string {
  switch (formType) {
    case 'cms1500':
      return 'Professional — CMS-1500';
    case 'ub04':
      return 'Institutional — UB-04';
    case 'dental':
      return 'Dental — ADA';
    case 'unsupported':
      return 'Unsupported form';
  }
}

/**
 * The literal word for each of the two WarningSeverity values
 * (src/model/claim.ts — 'info' | 'warning', no third tier), per
 * docs/TABS_BUILD_PLAN.md §2f item 4: `warning` reads as "Warning",
 * `info` reads as "Note" (deliberately not "Info" — "Note" reads less like
 * a third severity and more like "this is FYI, not a problem").
 */
export function severityWord(severity: WarningSeverity): 'Warning' | 'Note' {
  return severity === 'warning' ? 'Warning' : 'Note';
}
