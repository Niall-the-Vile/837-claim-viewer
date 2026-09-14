import { describe, it, expect } from 'vitest';
import {
  emptyAnnotation,
  isEmptyAnnotation,
  annotationKey,
  nextFlag,
  flagGlyph,
  flagWord,
  summarizeAnnotations,
  summaryLine,
  annotationMatchesFilter,
  type LineAnnotation,
} from '../src/model/annotations.js';

/**
 * Unit tests for the pure, DOM-free session-scoped-annotation model (Build
 * 6, 6.1). This module has NO persistence and NO IPC surface by design —
 * see its header — so these tests only ever exercise plain function
 * in/out behavior, exactly like test/editableFields.test.ts does for its
 * sibling module.
 */

describe('emptyAnnotation / isEmptyAnnotation', () => {
  it('emptyAnnotation() is itself empty', () => {
    expect(isEmptyAnnotation(emptyAnnotation())).toBe(true);
  });

  it('a note makes it non-empty', () => {
    expect(isEmptyAnnotation({ note: 'ask for chart notes', flag: null, checked: false })).toBe(false);
  });

  it('whitespace-only note still counts as empty (trimmed)', () => {
    expect(isEmptyAnnotation({ note: '   ', flag: null, checked: false })).toBe(true);
  });

  it('a flag makes it non-empty', () => {
    expect(isEmptyAnnotation({ note: '', flag: 'ok', checked: false })).toBe(false);
  });

  it('checked makes it non-empty', () => {
    expect(isEmptyAnnotation({ note: '', flag: null, checked: true })).toBe(false);
  });
});

describe('annotationKey', () => {
  it('combines claim index and line index, mirroring editableFields.ts\'s addressing spirit', () => {
    expect(annotationKey(0, 3)).toBe('0::line[3]');
    expect(annotationKey(2, 0)).toBe('2::line[0]');
  });

  it('never collides across different claim indices for the SAME line index', () => {
    expect(annotationKey(0, 5)).not.toBe(annotationKey(1, 5));
  });
});

describe('nextFlag', () => {
  it('cycles None -> OK -> Verify -> Dispute -> None', () => {
    expect(nextFlag(null)).toBe('ok');
    expect(nextFlag('ok')).toBe('verify');
    expect(nextFlag('verify')).toBe('dispute');
    expect(nextFlag('dispute')).toBe(null);
  });
});

describe('flagGlyph / flagWord', () => {
  it('every flag value (including null) has both a glyph and an explicit word — never colour alone', () => {
    for (const flag of [null, 'ok', 'verify', 'dispute'] as const) {
      expect(flagGlyph(flag)).toBeTruthy();
      expect(flagWord(flag)).toBeTruthy();
    }
  });

  it('words are exact and distinct', () => {
    expect(flagWord('dispute')).toBe('Dispute');
    expect(flagWord('verify')).toBe('Verify');
    expect(flagWord('ok')).toBe('OK');
    expect(flagWord(null)).toBe('No flag');
  });
});

function mapOf(entries: Array<[string, LineAnnotation]>): Map<string, LineAnnotation> {
  return new Map(entries);
}

describe('summarizeAnnotations / summaryLine', () => {
  it('an untouched claim summarizes as "0 of N lines flagged" with no trailing clauses', () => {
    const counts = summarizeAnnotations(mapOf([]), 0, 3);
    expect(counts).toEqual({ totalLines: 3, flaggedCount: 0, disputedCount: 0, verifyCount: 0, okCount: 0, notedCount: 0, checkedCount: 0 });
    expect(summaryLine(counts)).toBe('0 of 3 lines flagged');
  });

  it('matches the spec\'s example: "3 of 12 lines flagged · 1 disputed"', () => {
    const annotations = mapOf([
      [annotationKey(0, 0), { note: '', flag: 'ok', checked: false }],
      [annotationKey(0, 1), { note: '', flag: 'verify', checked: false }],
      [annotationKey(0, 2), { note: '', flag: 'dispute', checked: false }],
    ]);
    const counts = summarizeAnnotations(annotations, 0, 12);
    expect(counts.flaggedCount).toBe(3);
    expect(counts.disputedCount).toBe(1);
    expect(summaryLine(counts)).toBe('3 of 12 lines flagged · 1 disputed');
  });

  it('only counts lines belonging to the given claim index', () => {
    const annotations = mapOf([
      [annotationKey(0, 0), { note: '', flag: 'dispute', checked: false }],
      [annotationKey(1, 0), { note: '', flag: 'dispute', checked: false }], // different claim — must not count toward claim 0's summary
    ]);
    expect(summarizeAnnotations(annotations, 0, 5).flaggedCount).toBe(1);
    expect(summarizeAnnotations(annotations, 1, 5).flaggedCount).toBe(1);
  });

  it('adds noted/checked clauses only when their count is non-zero', () => {
    const annotations = mapOf([[annotationKey(0, 0), { note: 'ask about this', flag: null, checked: true }]]);
    const counts = summarizeAnnotations(annotations, 0, 4);
    expect(summaryLine(counts)).toBe('0 of 4 lines flagged · 1 noted · 1 checked off');
  });
});

describe('annotationMatchesFilter', () => {
  const disputed: LineAnnotation = { note: '', flag: 'dispute', checked: false };
  const verified: LineAnnotation = { note: '', flag: 'verify', checked: false };
  const none: LineAnnotation | undefined = undefined;

  it('"all" always matches, including an absent annotation', () => {
    expect(annotationMatchesFilter(disputed, 'all')).toBe(true);
    expect(annotationMatchesFilter(none, 'all')).toBe(true);
  });

  it('"flagged" matches any non-null flag, never an absent one', () => {
    expect(annotationMatchesFilter(disputed, 'flagged')).toBe(true);
    expect(annotationMatchesFilter(verified, 'flagged')).toBe(true);
    expect(annotationMatchesFilter(none, 'flagged')).toBe(false);
  });

  it('"disputed" matches only a dispute flag', () => {
    expect(annotationMatchesFilter(disputed, 'disputed')).toBe(true);
    expect(annotationMatchesFilter(verified, 'disputed')).toBe(false);
    expect(annotationMatchesFilter(none, 'disputed')).toBe(false);
  });
});
