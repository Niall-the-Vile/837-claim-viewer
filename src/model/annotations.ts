/**
 * Session-scoped per-service-line annotations (Build 6 — Notes & audit).
 *
 * CRITICAL, non-negotiable constraint (docs/CLAUDE_CODE_NEXT_SESSION.md
 * "Decisions made this session" item 2 — overrides docs/BUILD_QUEUE.md's
 * older Build 5.1, which called for persisting these under `userData`):
 * a `LineAnnotation` lives ONLY in a renderer-side, in-memory `Map`
 * attached to one `TabState` (src/renderer/tabState.ts) — the exact same
 * lifecycle as that object's existing `pdfDoc`/`zoom`/`pageNum` fields.
 * There is no `src/app/persistence/*.ts` module for this data (contrast
 * with the audit log, `src/app/persistence/auditLogStore.ts`, which is a
 * deliberate, separate, metadata-only exception). A `LineAnnotation` never
 * crosses `electron/preload.ts`'s contextBridge — no `claimApi` method
 * anywhere takes or returns one — so it structurally cannot reach the main
 * process, `userData`, or any export path (every export IPC call
 * — `exportPdf`/`exportCsv`/`exportJson`/`exportX12`/`exportBatch` — takes
 * only a `sessionId`/`index`/format options, never annotation data).
 *
 * This module itself is pure and DOM-free (no `document`/`window`
 * reference), like `src/model/editableFields.ts`, so it's directly
 * unit-testable under plain Node (see test/annotations.test.ts) and usable
 * from both `src/renderer/inspector.ts` (DOM-owning) and
 * `src/renderer/clipboardFormat.ts` (also DOM-free) without either pulling
 * in the other's concerns.
 */

export type AnnotationFlag = 'dispute' | 'verify' | 'ok' | null;

export interface LineAnnotation {
  note: string;
  flag: AnnotationFlag;
  checked: boolean;
}

export function emptyAnnotation(): LineAnnotation {
  return { note: '', flag: null, checked: false };
}

/** True when an annotation carries no actual information — used to decide whether a Map entry is worth keeping (see commitAnnotation-style callers) so an untouched line never occupies a Map slot. */
export function isEmptyAnnotation(a: LineAnnotation): boolean {
  return a.note.trim() === '' && a.flag === null && !a.checked;
}

/**
 * Stable per-service-line key — same addressing SPIRIT as
 * src/model/editableFields.ts's `${claimIndex}::${fieldPath}` scheme (see
 * that file's header), so a claim-level annotation Map entry can never be
 * confused with the "same" line index on a different claim within the same
 * multi-claim 837/JSON batch file. Purely an in-memory Map key — never
 * written to disk, never sent across the contextBridge (see this file's
 * header).
 */
export function annotationKey(claimIndex: number, lineIndex: number): string {
  return `${claimIndex}::line[${lineIndex}]`;
}

/** None -> OK -> Verify -> Dispute -> None. One click of the flag control advances one step (docs/BUILD_QUEUE.md §7 / UI_REQUIREMENTS_v3_queued_features.md §7's "triage control"). */
const FLAG_CYCLE: readonly AnnotationFlag[] = [null, 'ok', 'verify', 'dispute'];
export function nextFlag(current: AnnotationFlag): AnnotationFlag {
  const idx = FLAG_CYCLE.indexOf(current);
  return FLAG_CYCLE[(idx + 1) % FLAG_CYCLE.length]!;
}

/**
 * Glyph + explicit word, never colour alone — the same accessibility
 * posture docs/BUILD_QUEUE.md's severity rule already mandates for
 * warnings (§2f item 4), extended here to triage marks for the same
 * colour-blind/low-vision reasons.
 */
export function flagGlyph(flag: AnnotationFlag): string {
  switch (flag) {
    case 'dispute':
      return '⚑';
    case 'verify':
      return '◐';
    case 'ok':
      return '✓';
    case null:
      return '—';
  }
}

export function flagWord(flag: AnnotationFlag): string {
  switch (flag) {
    case 'dispute':
      return 'Dispute';
    case 'verify':
      return 'Verify';
    case 'ok':
      return 'OK';
    case null:
      return 'No flag';
  }
}

export interface AnnotationCounts {
  totalLines: number;
  flaggedCount: number;
  disputedCount: number;
  verifyCount: number;
  okCount: number;
  notedCount: number;
  checkedCount: number;
}

/** Tallies one claim's annotations for the "N of M lines flagged" claim-level summary (docs/UI_REQUIREMENTS_v3_queued_features.md §7). `lineCount` bounds the scan to exactly this claim's own service lines. */
export function summarizeAnnotations(annotations: ReadonlyMap<string, LineAnnotation>, claimIndex: number, lineCount: number): AnnotationCounts {
  const counts: AnnotationCounts = { totalLines: lineCount, flaggedCount: 0, disputedCount: 0, verifyCount: 0, okCount: 0, notedCount: 0, checkedCount: 0 };
  for (let i = 0; i < lineCount; i++) {
    const a = annotations.get(annotationKey(claimIndex, i));
    if (!a) continue;
    if (a.flag) counts.flaggedCount++;
    if (a.flag === 'dispute') counts.disputedCount++;
    if (a.flag === 'verify') counts.verifyCount++;
    if (a.flag === 'ok') counts.okCount++;
    if (a.note.trim() !== '') counts.notedCount++;
    if (a.checked) counts.checkedCount++;
  }
  return counts;
}

/** e.g. "3 of 12 lines flagged · 1 disputed · 2 noted" — the exact claim-level summary string, per docs/UI_REQUIREMENTS_v3_queued_features.md §7 ("3 of 12 lines flagged · 1 disputed"). Trailing clauses only appear when their count is non-zero. */
export function summaryLine(counts: AnnotationCounts): string {
  const parts: string[] = [`${counts.flaggedCount} of ${counts.totalLines} lines flagged`];
  if (counts.disputedCount > 0) parts.push(`${counts.disputedCount} disputed`);
  if (counts.notedCount > 0) parts.push(`${counts.notedCount} noted`);
  if (counts.checkedCount > 0) parts.push(`${counts.checkedCount} checked off`);
  return parts.join(' · ');
}

export type AnnotationFilterMode = 'all' | 'flagged' | 'disputed';

/** Whether a line's (possibly absent) annotation should be visible under `mode` — reused verbatim for both live DOM filtering (inspector.ts) and any future non-DOM test of the same predicate. */
export function annotationMatchesFilter(a: LineAnnotation | undefined, mode: AnnotationFilterMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'disputed') return a?.flag === 'dispute';
  return !!a?.flag; // 'flagged' — any non-null triage mark
}
