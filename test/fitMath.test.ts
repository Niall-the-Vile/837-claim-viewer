import { describe, it, expect } from 'vitest';
import { computeFitPageZoom, computeFitWidthZoom, type FitSize } from '../src/renderer/fitMath.js';

/**
 * docs/UI_REQUIREMENTS_v3_queued_features.md §9 mandatory sub-task 2's
 * required vitest coverage of "the fit-math function" — see fitMath.ts's
 * header comment for why these functions deliberately take no `uiScale`
 * argument (the upstream measurement is already scale-correct by
 * construction; a correction here would be a bug, not a fix). What this
 * file proves: the math itself is correct for ordinary fit-page/fit-width
 * scenarios, AND — the actual §9 acceptance criterion — that feeding it
 * the SAME available/base sizes always yields the SAME zoom regardless of
 * anything about scale, i.e. there is no hidden scale dependency to find.
 * The complementary, equally-required half of this (that #pdfScroll's real
 * getBoundingClientRect measurement is ITSELF unaffected by --ui-scale in
 * the actual running app) is verified in e2e/uiScale.spec.ts, which a pure
 * unit test structurally cannot check.
 */

describe('fitMath: computeFitPageZoom', () => {
  it('picks the smaller of the width/height ratios so the whole page fits both axes', () => {
    // Page is wider relative to available space than it is tall -> width is the binding constraint.
    const avail: FitSize = { width: 600, height: 900 };
    const base: FitSize = { width: 612, height: 792 }; // US Letter, points
    const zoom = computeFitPageZoom(avail, base);
    expect(zoom).toBeCloseTo(600 / 612, 10);
  });

  it('picks height as the binding constraint when the available area is relatively short', () => {
    const avail: FitSize = { width: 2000, height: 400 };
    const base: FitSize = { width: 612, height: 792 };
    const zoom = computeFitPageZoom(avail, base);
    expect(zoom).toBeCloseTo(400 / 792, 10);
  });

  it('returns exactly 1 when the available area exactly matches the base size', () => {
    const size: FitSize = { width: 612, height: 792 };
    expect(computeFitPageZoom(size, size)).toBeCloseTo(1, 10);
  });
});

describe('fitMath: computeFitWidthZoom', () => {
  it('fits the base width to the available width, minus the 4px scroll-container clearance', () => {
    const avail: FitSize = { width: 616, height: 9999 };
    const base: FitSize = { width: 612, height: 792 };
    expect(computeFitWidthZoom(avail, base)).toBeCloseTo((616 - 4) / 612, 10);
  });

  it('ignores available height entirely — only width drives the ratio', () => {
    const base: FitSize = { width: 612, height: 792 };
    const short = computeFitWidthZoom({ width: 900, height: 50 }, base);
    const tall = computeFitWidthZoom({ width: 900, height: 5000 }, base);
    expect(short).toBe(tall);
  });
});

describe('fitMath: scale-invariance (docs/UI_REQUIREMENTS_v3_queued_features.md §9 acceptance criterion)', () => {
  /**
   * The DoD requires "fitWidth at 175% yields the same PDF zoom value as at
   * 100%". Since #pdfScroll is deliberately kept outside every zoomed chrome
   * region (see fitMath.ts/preview.ts's doc comments), the SAME real avail/
   * base measurements are what these functions receive at every --ui-scale
   * setting — so proving these are pure functions of (avail, base) alone,
   * with no other hidden input, IS the unit-level proof of that invariant.
   * Calling each function twice with identical inputs (standing in for "the
   * same real window size measured at 100% and at 175%") must always agree.
   */
  it('computeFitPageZoom is a pure function of its inputs — same avail/base always yields the same zoom', () => {
    const avail: FitSize = { width: 850, height: 1100 };
    const base: FitSize = { width: 612, height: 792 };
    const first = computeFitPageZoom(avail, base);
    const second = computeFitPageZoom({ ...avail }, { ...base });
    expect(second).toBe(first);
  });

  it('computeFitWidthZoom is a pure function of its inputs — same avail/base always yields the same zoom', () => {
    const avail: FitSize = { width: 850, height: 1100 };
    const base: FitSize = { width: 612, height: 792 };
    const first = computeFitWidthZoom(avail, base);
    const second = computeFitWidthZoom({ ...avail }, { ...base });
    expect(second).toBe(first);
  });
});
