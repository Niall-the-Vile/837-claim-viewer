import type { TabState } from './tabState.js';
import { isEmptyAnnotation, type LineAnnotation } from '../model/annotations.js';

/**
 * Renderer-side helper over `TabState.annotations` (Build 6 — Notes &
 * audit). Kept separate from `src/model/annotations.ts` (which is pure/
 * DOM-free) purely because this one imports the `TabState` type — see that
 * file's header for the full "never persisted, never crosses the
 * contextBridge" constraint, which this module inherits unchanged: nothing
 * here ever calls a `claimApi.*` method.
 */

/**
 * Count of service lines carrying an active (non-empty) annotation, for the
 * export dialog's "N session notes — not included in export" indicator
 * (6.3 — annotations stay OUT of every export by default). `scope: 'claim'`
 * counts only the CURRENTLY ACTIVE claim's lines (matching
 * `annotationKey`'s `${tab.currentIndex}::` prefix); `'all'` sums every
 * claim in this tab's file. This never reads `tab.detail`/line counts —
 * it walks whatever is actually IN the Map, so it stays correct even if
 * called before a claim's detail has loaded.
 */
export function countActiveAnnotations(tab: TabState, scope: 'claim' | 'all'): number {
  let count = 0;
  const prefix = `${tab.currentIndex}::`;
  for (const [key, value] of tab.annotations) {
    if (isEmptyAnnotation(value)) continue;
    if (scope === 'all' || key.startsWith(prefix)) count++;
  }
  return count;
}

/**
 * Re-keys `tab.annotations` down to `lineIndex -> LineAnnotation` for ONE
 * claim (dropping the `${claimIndex}::` prefix) — the shape
 * `clipboardFormat.ts`'s `formatServiceLinesTsv`/the annotations-worksheet
 * caller need, since both work with a single already-claim-scoped
 * `ClaimDetailDto.serviceLines` array and have no reason to know about
 * `annotationKey`'s claim-index prefix at all.
 */
export function annotationsForClaimByLineIndex(tab: TabState, claimIndex: number): Map<number, LineAnnotation> {
  const prefix = `${claimIndex}::`;
  const result = new Map<number, LineAnnotation>();
  for (const [key, value] of tab.annotations) {
    if (!key.startsWith(prefix)) continue;
    const match = /^line\[(\d+)\]$/.exec(key.slice(prefix.length));
    if (!match) continue;
    result.set(Number(match[1]), value);
  }
  return result;
}
