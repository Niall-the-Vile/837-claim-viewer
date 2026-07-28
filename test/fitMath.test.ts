import { describe, it, expect } from 'vitest';
import { computeFitPageZoom, computeFitWidthZoom, type FitSize } from '../src/renderer/fitMath.js';

/**
 * docs/UI_REQUIREMENTS_v3_queued_features.md §9 mandatory sub-task 2's
 * required vitest coverage of "the fit-math function" — see fitMath.ts's
 * header comment for why these functions deliberately take no `uiScale`
 * argument (the upstream measurement is already scale-correct by
 * construction; a correction here would be a bug, not a fix). What this
 * file proves: the math itself is correct for ordinary fit-page/fit-width
 * scenarios, against hardcoded expected values.
 *
 * It does NOT prove §9's scale-invariance acceptance criterion, and no unit
 * test can — the thing that could break is the upstream getBoundingClientRect
 * measurement, not this arithmetic. The sole proof of that criterion is
 * e2e/uiScale.spec.ts's "fitWidth yields the same PDF zoom% at 175% as at
 * 100%", which re-issues fitWidth in the running app at both scales and
 * compares #zoomLabel. This file previously claimed that role for two
 * self-comparison tests that any implementation would have passed
 * (docs/AUDIT_BUILD2.md).
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

describe('fitMath: exact expected values', () => {
  /**
   * This block replaces two tests that called each function twice with
   * identical inputs and asserted the results matched, under the heading
   * "the unit-level proof" of §9's scale-invariance criterion. Both
   * functions are one-line arithmetic over (avail, base) with no module or
   * global read, so that equality holds for ANY implementation — including a
   * wrong one that divided by a hidden --ui-scale global, since the same
   * global would be read both times. They proved nothing and mislabelled
   * themselves as the acceptance proof (docs/AUDIT_BUILD2.md).
   *
   * The REAL proof of §9's criterion is e2e/uiScale.spec.ts's "fitWidth
   * yields the same PDF zoom% at 175% as at 100%", which re-issues fitWidth
   * in the running app at both scales and compares #zoomLabel. A unit test
   * structurally cannot check it, because the thing that could break is the
   * upstream getBoundingClientRect measurement, not this arithmetic.
   *
   * What IS worth pinning here is the arithmetic itself, against hardcoded
   * numbers rather than against a second call to the same function.
   */
  it('computeFitWidthZoom divides available width (less the gutter) by base width', () => {
    expect(computeFitWidthZoom({ width: 900, height: 1100 }, { width: 612, height: 792 })).toBeCloseTo((900 - 4) / 612, 10);
  });

  it('computeFitPageZoom takes the binding axis, exactly — and applies NO gutter', () => {
    // Width-bound: 600/612 = 0.980 vs height 1200/792 = 1.515.
    // Note the absence of the -4 gutter: fitWidth subtracts it, fitPage does
    // not. Asserting hardcoded values is what makes that asymmetry visible;
    // a self-comparison would have been satisfied by either behaviour.
    expect(computeFitPageZoom({ width: 600, height: 1200 }, { width: 612, height: 792 })).toBeCloseTo(600 / 612, 10);
    // Height-bound: 400/792 = 0.505 vs 2000/612 = 3.268.
    expect(computeFitPageZoom({ width: 2000, height: 400 }, { width: 612, height: 792 })).toBeCloseTo(400 / 792, 10);
  });
});
