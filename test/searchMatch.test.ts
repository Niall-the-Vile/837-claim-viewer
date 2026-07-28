import { describe, it, expect } from 'vitest';
import {
  normalizeSearchText,
  matchesSearchQuery,
  computeRowMatches,
  computeOtherClaimMatches,
  formatMatchSummaryText,
  formatEmptyStateText,
  formatOtherClaimsButtonLabel,
  nextMatchIndex,
  type SearchableRow,
  type OtherClaimSummary,
} from '../src/renderer/features/searchMatch.js';

/**
 * Unit coverage for docs/UI_REQUIREMENTS_v3_queued_features.md §1 / docs/
 * BUILD_QUEUE.md Build 2.1's normalization rules and the pure row/cross-claim
 * matching logic behind features/search.ts's DOM wiring. See searchMatch.ts's
 * header comment for why this logic lives in a DOM-free module: it lets
 * these cases run under vitest's plain Node environment, the same split
 * fitMath.test.ts uses for preview.ts's fit-math.
 */

describe('normalizeSearchText / matchesSearchQuery', () => {
  it('strips $ and , so a dollar amount is found by its bare digits (docs/BUILD_QUEUE.md 2.1 worked example)', () => {
    expect(normalizeSearchText('$1,204.00')).toBe('1204.00');
    expect(matchesSearchQuery('$1,204.00', normalizeSearchText('1204'))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesSearchQuery('Billing NPI', normalizeSearchText('billing'))).toBe(true);
    expect(matchesSearchQuery('billing npi', normalizeSearchText('BILLING'))).toBe(true);
  });

  it('finds an ISO inspector date ("2026-06-03") by the exact ISO query', () => {
    expect(normalizeSearchText('2026-06-03')).toBe('20260603');
    expect(matchesSearchQuery('2026-06-03', normalizeSearchText('2026-06-03'))).toBe(true);
  });

  it('finds an ISO inspector date by a slash-separated MM/DD fragment', () => {
    // "06/03" normalizes to "0603", a substring of "20260603"'s tail.
    expect(normalizeSearchText('06/03')).toBe('0603');
    expect(matchesSearchQuery('2026-06-03', normalizeSearchText('06/03'))).toBe(true);
  });

  it('ignores whitespace and the inspector composite-value separators (· and em dash)', () => {
    const composite = '2026-06-01  ·  99213-25  ptr 1  ×1  $50.00';
    expect(matchesSearchQuery(composite, normalizeSearchText('99213'))).toBe(true);
    expect(matchesSearchQuery(composite, normalizeSearchText('99213-25'))).toBe(true);
    expect(matchesSearchQuery(composite, normalizeSearchText('9921325'))).toBe(true);
  });

  it('an empty query never matches anything', () => {
    expect(matchesSearchQuery('anything', '')).toBe(false);
  });

  it('matches a plain non-numeric label substring case-insensitively', () => {
    expect(matchesSearchQuery('Rendering NPI', normalizeSearchText('rendering'))).toBe(true);
    expect(matchesSearchQuery('Rendering NPI', normalizeSearchText('xyz'))).toBe(false);
  });
});

describe('computeRowMatches — label vs value matching', () => {
  const rows: SearchableRow[] = [
    { id: '0', groupId: 'patient', key: 'Name', value: 'DOE JOHN', isExplanation: false },
    { id: '1', groupId: 'patient', key: 'Member ID', value: '030005074A', isExplanation: false },
    { id: '2', groupId: 'patient', key: 'Date of birth', value: '1926-11-11', isExplanation: false },
  ];

  it('matches on the field label', () => {
    const index = computeRowMatches(rows, 'member');
    expect(index.matches.map((m) => m.id)).toEqual(['1']);
  });

  it('matches on the field value', () => {
    const index = computeRowMatches(rows, 'doe');
    expect(index.matches.map((m) => m.id)).toEqual(['0']);
  });

  it('matches an ISO date value by a slash-separated query', () => {
    const index = computeRowMatches(rows, '11/11');
    expect(index.matches.map((m) => m.id)).toEqual(['2']);
  });

  it('an empty query matches nothing and marks every row visible (the "not searching" shape)', () => {
    const index = computeRowMatches(rows, '');
    expect(index.matches).toEqual([]);
    expect(index.groupsWithMatches).toEqual([]);
    expect(index.rows.every((r) => r.visible)).toBe(true);
  });

  it('groupsWithMatches lists each distinct matching group once, in first-seen order', () => {
    const mixed: SearchableRow[] = [
      { id: '0', groupId: 'a', key: 'Foo', value: '1204', isExplanation: false },
      { id: '1', groupId: 'b', key: 'Bar', value: 'nope', isExplanation: false },
      { id: '2', groupId: 'a', key: 'Baz', value: '1204 too', isExplanation: false },
    ];
    const index = computeRowMatches(mixed, '1204');
    expect(index.groupsWithMatches).toEqual(['a']);
    expect(index.matches).toHaveLength(2);
  });
});

describe('computeRowMatches — explanation-row context (docs/AUDIT_BUILD1.md-style "never show a bare match without its context")', () => {
  it('keeps a matched warning row\'s explanation caption visible even though the caption text itself does not match', () => {
    const rows: SearchableRow[] = [
      { id: '0', groupId: 'warn', key: 'Warning', value: 'charge total mismatch', isExplanation: false },
      { id: '1', groupId: 'warn', key: '', value: 'The sum of the service line charges does not equal the claim total.', isExplanation: true },
    ];
    const index = computeRowMatches(rows, 'mismatch');
    // Only the warning row itself counts as a "match" (step-through/count)...
    expect(index.matches.map((m) => m.id)).toEqual(['0']);
    // ...but its explanation caption is kept VISIBLE for context.
    expect(index.rows.find((r) => r.id === '1')?.visible).toBe(true);
  });

  it('keeps the owning warning row visible when only its explanation text matches', () => {
    const rows: SearchableRow[] = [
      { id: '0', groupId: 'warn', key: 'Warning', value: 'charge total mismatch', isExplanation: false },
      { id: '1', groupId: 'warn', key: '', value: 'The sum of the service line charges does not equal the claim total.', isExplanation: true },
    ];
    const index = computeRowMatches(rows, 'does not equal');
    expect(index.matches.map((m) => m.id)).toEqual(['1']);
    expect(index.rows.find((r) => r.id === '0')?.visible).toBe(true);
  });

  it('hides an unrelated warning+explanation pair entirely when neither matches', () => {
    const rows: SearchableRow[] = [
      { id: '0', groupId: 'warn', key: 'Warning', value: 'charge total mismatch', isExplanation: false },
      { id: '1', groupId: 'warn', key: '', value: 'The sum of the service line charges does not equal the claim total.', isExplanation: true },
      { id: '2', groupId: 'warn', key: 'Note', value: 'missing taxonomy', isExplanation: false },
      { id: '3', groupId: 'warn', key: '', value: 'Not present — situational, many payers do not require it.', isExplanation: true },
    ];
    const index = computeRowMatches(rows, 'taxonomy');
    expect(index.rows.find((r) => r.id === '0')?.visible).toBe(false);
    expect(index.rows.find((r) => r.id === '1')?.visible).toBe(false);
    expect(index.rows.find((r) => r.id === '2')?.visible).toBe(true);
    expect(index.rows.find((r) => r.id === '3')?.visible).toBe(true);
  });
});

describe('computeOtherClaimMatches (837 batch cross-claim summary matching)', () => {
  const others: OtherClaimSummary[] = [
    { index: 0, claimId: '756048Q', patientName: 'DOE JOHN', formTypeLabel: 'Institutional — UB-04', totalLabel: '$89.93' },
    { index: 2, claimId: '756050Q', patientName: 'SMITH JANE', formTypeLabel: 'Institutional — UB-04', totalLabel: '$120.00' },
  ];

  it('finds a claim by its claim id and reports it as one match in one claim', () => {
    const result = computeOtherClaimMatches(others, '756048');
    expect(result.totalMatches).toBe(1);
    expect(result.matches).toEqual([{ index: 0, matchCount: 1 }]);
  });

  it('sums matches across multiple matching claims/fields', () => {
    // matchCount counts matching FIELDS per claim. "institutional" hits
    // exactly one field (formTypeLabel) on each of the two claims, so
    // 1 + 1 = 2 across 2 claims.
    //
    // The comment here used to describe a two-query case that was never
    // executed and contradicted the assertion below, so a reader "correcting"
    // the code to produce 4 would have broken the suite (docs/AUDIT_BUILD2.md).
    const result = computeOtherClaimMatches(others, 'institutional');
    expect(result.totalMatches).toBe(2);
    expect(result.matches.map((m) => m.index)).toEqual([0, 2]);
  });

  it('counts each matching field separately within one claim', () => {
    // The multi-field case the old comment claimed to cover: '756048Q'
    // matches only claim 0's id, while a query hitting both its id and its
    // total would count 2 on that one claim.
    const oneClaim: OtherClaimSummary[] = [{ index: 1, claimId: '89', patientName: 'DOE JOHN', formTypeLabel: 'Professional — CMS-1500', totalLabel: '$89.93' }];
    const result = computeOtherClaimMatches(oneClaim, '89');
    expect(result.matches).toEqual([{ index: 1, matchCount: 2 }]);
    expect(result.totalMatches).toBe(2);
  });

  it('an empty query matches no other claims', () => {
    expect(computeOtherClaimMatches(others, '')).toEqual({ totalMatches: 0, matches: [] });
  });

  it('matches[0] is the lowest-index other claim with a match (the click-to-jump target)', () => {
    const result = computeOtherClaimMatches(others, 'q');
    expect(result.matches[0]?.index).toBe(0);
  });
});

describe('aria-live / empty-state text formatting', () => {
  it('formats a plain match summary with no other-claims clause', () => {
    expect(formatMatchSummaryText(7, 3, null, { totalMatches: 0, claimCount: 0 })).toBe('7 matches in 3 groups');
  });

  it('formats a match summary with the step-through position', () => {
    expect(formatMatchSummaryText(7, 3, 3, { totalMatches: 0, claimCount: 0 })).toBe('7 matches in 3 groups — match 3 of 7');
  });

  it('pluralizes singular counts correctly', () => {
    expect(formatMatchSummaryText(1, 1, 1, { totalMatches: 0, claimCount: 0 })).toBe('1 match in 1 group — match 1 of 1');
  });

  it('appends the other-claims clause when applicable', () => {
    const text = formatMatchSummaryText(7, 3, null, { totalMatches: 3, claimCount: 2 });
    expect(text).toBe('7 matches in 3 groups · 3 more matches in 2 other claims');
  });

  it('formats the empty state with no other-claims match', () => {
    expect(formatEmptyStateText('1204', { totalMatches: 0, claimCount: 0 })).toBe("No matches for '1204' in this claim.");
  });

  it('formats the empty state naming the other-claims match, singular claim', () => {
    const text = formatEmptyStateText('756049', { totalMatches: 1, claimCount: 1 });
    expect(text).toBe("No matches for '756049' in this claim — but 1 other claim in this file matches.");
  });

  it('formats the empty state naming the other-claims match, plural claims', () => {
    const text = formatEmptyStateText('xyz', { totalMatches: 3, claimCount: 2 });
    expect(text).toBe("No matches for 'xyz' in this claim — but 2 other claims in this file match.");
  });

  it('formats the other-claims button label', () => {
    expect(formatOtherClaimsButtonLabel({ totalMatches: 3, claimCount: 2 })).toBe('3 more matches in 2 other claims');
    expect(formatOtherClaimsButtonLabel({ totalMatches: 1, claimCount: 1 })).toBe('1 more match in 1 other claim');
  });
});

/**
 * Build 2 audit regressions (docs/AUDIT_BUILD2.md). Each case below was
 * confirmed to fail against build-2-green before the fix.
 */
describe('nextMatchIndex — step-through wrap', () => {
  it('first Enter lands on the first match', () => {
    expect(nextMatchIndex(-1, 1, 7)).toBe(0);
  });

  it('first Shift+Enter lands on the LAST match, not the second-to-last', () => {
    // The bug: `((-1 + -1) % 7 + 7) % 7` === 5, so the first backward step
    // skipped match 7 of 7 and announced "match 6 of 7". Because the sentinel
    // resets on every keystroke, this recurred after each edit.
    expect(nextMatchIndex(-1, -1, 7)).toBe(6);
  });

  it('wraps forward off the end', () => {
    expect(nextMatchIndex(6, 1, 7)).toBe(0);
  });

  it('wraps backward off the start', () => {
    expect(nextMatchIndex(0, -1, 7)).toBe(6);
  });

  it('steps normally in the middle', () => {
    expect(nextMatchIndex(3, 1, 7)).toBe(4);
    expect(nextMatchIndex(3, -1, 7)).toBe(2);
  });

  it('handles a single match in both directions', () => {
    expect(nextMatchIndex(-1, 1, 1)).toBe(0);
    expect(nextMatchIndex(-1, -1, 1)).toBe(0);
    expect(nextMatchIndex(0, 1, 1)).toBe(0);
    expect(nextMatchIndex(0, -1, 1)).toBe(0);
  });

  it('returns the sentinel when there is nothing to step through', () => {
    expect(nextMatchIndex(-1, 1, 0)).toBe(-1);
    expect(nextMatchIndex(-1, -1, 0)).toBe(-1);
  });
});

describe('matchesSearchQuery — composite values match per component', () => {
  // inspector.ts joins independent service-line values with '  ·  '.
  const SERVICE_LINE = '2026-06-03  ·  99213-25  ·  ptr 1  ·  pos 11  ·  ×1  ·  $1,150.00';

  it('does not match a query that spans two components', () => {
    // '0399' spans the date's day ("03") and the proc code's leading "99".
    // Build 2 counted this and drew a persistent outline on a row where the
    // string is nowhere on screen.
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('0399'))).toBe(false);
  });

  it('does not match a query spanning the units and charge components', () => {
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('11150'))).toBe(false);
  });

  it('still matches within a single component', () => {
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('1150'))).toBe(true);
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('$1,150.00'))).toBe(true);
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('99213'))).toBe(true);
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('2026-06-03'))).toBe(true);
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('06/03'))).toBe(true);
    expect(matchesSearchQuery(SERVICE_LINE, normalizeSearchText('pos 11'))).toBe(true);
  });
});

describe('normalizeSearchText — signs are stripped symmetrically', () => {
  it('strips a leading + as well as a leading -', () => {
    // Dates force '-' into the strip set, so matching cannot be
    // sign-sensitive. Build 2 stripped '-' but kept '+', so the query
    // '-45.00' matched a rendered '+$45.00' while the reverse failed.
    expect(normalizeSearchText('+$45.00')).toBe('45.00');
    expect(normalizeSearchText('-$45.00')).toBe('45.00');
    expect(normalizeSearchText('+$45.00')).toBe(normalizeSearchText('-$45.00'));
  });
});
