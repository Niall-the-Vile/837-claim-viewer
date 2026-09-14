import { describe, it, expect } from 'vitest';
import type { TabState } from '../src/renderer/tabState.js';
import { countActiveAnnotations, annotationsForClaimByLineIndex } from '../src/renderer/annotations.js';
import { annotationKey, type LineAnnotation } from '../src/model/annotations.js';

/**
 * Unit tests for src/renderer/annotations.ts — the small TabState-aware
 * helper layer over the pure src/model/annotations.ts (see
 * test/annotations.test.ts for that module's own tests). Only imports the
 * `TabState` TYPE from src/renderer/tabState.ts (erased at compile time),
 * same DOM-free-under-vitest posture as test/tabState.test.ts — a fake
 * object literal carrying just the two fields these functions actually
 * read (`annotations`, `currentIndex`) stands in for a real tab.
 */

function fakeTab(annotations: Array<[string, LineAnnotation]>, currentIndex = 0): TabState {
  return { annotations: new Map(annotations), currentIndex } as unknown as TabState;
}

const disputed: LineAnnotation = { note: 'check this', flag: 'dispute', checked: false };
const empty: LineAnnotation = { note: '', flag: null, checked: false };

describe('countActiveAnnotations', () => {
  it('is zero for a tab with no annotations at all', () => {
    expect(countActiveAnnotations(fakeTab([]), 'claim')).toBe(0);
    expect(countActiveAnnotations(fakeTab([]), 'all')).toBe(0);
  });

  it('never counts an empty Map entry (a fully-cleared annotation left in the Map)', () => {
    const tab = fakeTab([[annotationKey(0, 0), empty]], 0);
    expect(countActiveAnnotations(tab, 'claim')).toBe(0);
  });

  it('"claim" scope counts only the currently active claim index', () => {
    const tab = fakeTab(
      [
        [annotationKey(0, 0), disputed],
        [annotationKey(1, 0), disputed],
      ],
      0,
    );
    expect(countActiveAnnotations(tab, 'claim')).toBe(1);
    expect(countActiveAnnotations({ ...tab, currentIndex: 1 } as TabState, 'claim')).toBe(1);
  });

  it('"all" scope sums every claim in the tab', () => {
    const tab = fakeTab(
      [
        [annotationKey(0, 0), disputed],
        [annotationKey(1, 0), disputed],
      ],
      0,
    );
    expect(countActiveAnnotations(tab, 'all')).toBe(2);
  });
});

describe('annotationsForClaimByLineIndex', () => {
  it('re-keys by plain line index, dropping the claim-index prefix', () => {
    const tab = fakeTab([
      [annotationKey(2, 0), disputed],
      [annotationKey(2, 3), disputed],
    ]);
    const result = annotationsForClaimByLineIndex(tab, 2);
    expect(Array.from(result.keys()).sort()).toEqual([0, 3]);
    expect(result.get(0)).toEqual(disputed);
  });

  it('never leaks another claim\'s lines into this claim\'s map', () => {
    const tab = fakeTab([
      [annotationKey(0, 0), disputed],
      [annotationKey(1, 0), disputed],
    ]);
    expect(annotationsForClaimByLineIndex(tab, 0).size).toBe(1);
    expect(annotationsForClaimByLineIndex(tab, 1).size).toBe(1);
  });

  it('returns an empty map for a claim index with no annotations', () => {
    const tab = fakeTab([[annotationKey(0, 0), disputed]]);
    expect(annotationsForClaimByLineIndex(tab, 5).size).toBe(0);
  });
});
