/**
 * Pure, DOM-free matching/normalization/formatting logic for docs/
 * UI_REQUIREMENTS_v3_queued_features.md §1 (Ctrl+F inspector search,
 * docs/BUILD_QUEUE.md Build 2.1) — split out of features/search.ts (which
 * owns the DOM wiring: the search field, the live filtering of real
 * `.inspGroup`/`.inspRow` elements, group open-state capture/restore) for
 * the same reason src/renderer/fitMath.ts is split from preview.ts: vitest's
 * default (Node, non-DOM) environment can exercise this file directly, with
 * real unit coverage of the normalization rules the spec calls out by name
 * ("$1,204.00" found by "1204", a date found by "06/03" or "2026-06-03",
 * case-insensitivity, label matching) — importing features/search.ts itself
 * would pull in dom.ts's module-level `document.getElementById` calls, which
 * throw immediately outside a real DOM.
 */

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Case- and punctuation-insensitive normalization (docs/
 * UI_REQUIREMENTS_v3_queued_features.md §1): lower-cases, then strips `$`,
 * `,`, whitespace, parens, the inspector's `·`/`—` composite-value
 * separators, and BOTH date separators (`/` and `-`) so:
 *   - "$1,204.00" -> "1204.00", found by the query "1204".
 *   - an inspector date, which is always the model's raw "YYYY-MM-DD" string
 *     (see electron/main.ts's buildClaimDetail — `patient.dob`/service-line
 *     `dates`/etc. are passed through unformatted, never reformatted to
 *     MM/DD/YYYY the way the rendered PDF facsimile is) -> "2026-06-03"
 *     normalizes to "20260603", found by the query "2026-06-03" (which
 *     normalizes to the same "20260603", an exact match) OR by "06/03"
 *     (which normalizes to "0603", a substring of the tail "...0603").
 */
export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[$,\s()·—/-]/g, '');
}

/** `normalizedQuery` must already be the output of `normalizeSearchText` — callers that check many rows against one query normalize the query once, not per row. An empty query never matches anything (there is no "everything matches" state here; features/search.ts's own empty-query branch never calls this at all). */
export function matchesSearchQuery(text: string, normalizedQuery: string): boolean {
  if (normalizedQuery === '') return false;
  return normalizeSearchText(text).includes(normalizedQuery);
}

// ---------------------------------------------------------------------------
// Row-level matching within one claim's inspector
// ---------------------------------------------------------------------------

export interface SearchableRow {
  /** Index within its group's row list (features/search.ts uses the DOM row's own index — this module never sees a real DOM node). */
  id: string;
  groupId: string;
  key: string;
  value: string;
  /**
   * True for a caption/explanation row that carries no key of its own
   * (inspector.ts's `isExplanation` rows — the plain-English text under a
   * warning). docs/UI_REQUIREMENTS_v3_queued_features.md §1's "a bare
   * '1730258417' is meaningless without its group heading" applies one
   * level down here too: an explanation row is kept VISIBLE whenever the
   * warning row immediately before it matched (context for the match), and
   * a warning row is kept visible whenever its own explanation matched —
   * but neither counts as a "match" for the count/step-through totals
   * unless its OWN text also matched (see RowMatchResult.matched vs
   * .visible below).
   */
  isExplanation: boolean;
}

export interface RowMatchResult {
  id: string;
  groupId: string;
  /** This row's own key/value text matched the query. Only `matched` rows count toward the match count and the step-through (Enter/Shift+Enter) sequence. */
  matched: boolean;
  /** Whether the row should be shown while the query is active: `matched`, or kept for isExplanation context (see SearchableRow.isExplanation above). */
  visible: boolean;
}

export interface RowSearchIndex {
  /** One entry per input row, same order. */
  rows: RowMatchResult[];
  /** `rows` filtered to `matched`, in the same (DOM) order — the step-through sequence Enter/Shift+Enter walk. */
  matches: RowMatchResult[];
  /** Distinct group ids with at least one matched row, in first-seen order. */
  groupsWithMatches: string[];
}

/** `query` is the RAW (not yet normalized) user-typed text; normalized once here. An empty query yields an "everything visible, nothing matched" index (features/search.ts's clear/restore path doesn't call this at all, but keeping the function total — rather than requiring callers to special-case '' themselves — keeps every call site simpler). */
export function computeRowMatches(rows: SearchableRow[], query: string): RowSearchIndex {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery === '') {
    return {
      rows: rows.map((r) => ({ id: r.id, groupId: r.groupId, matched: false, visible: true })),
      matches: [],
      groupsWithMatches: [],
    };
  }

  const ownMatch = rows.map((row) => matchesSearchQuery(row.key, normalizedQuery) || matchesSearchQuery(row.value, normalizedQuery));
  const visible = rows.map((row, i) => {
    if (ownMatch[i]) return true;
    if (row.isExplanation) {
      // Its owner is always the row immediately before it — inspector.ts
      // never emits two explanation rows back to back.
      return i > 0 && ownMatch[i - 1] === true;
    }
    // Kept visible if its own explanation row (immediately after it, if any) matched.
    return i + 1 < rows.length && rows[i + 1]!.isExplanation && ownMatch[i + 1] === true;
  });

  const result: RowMatchResult[] = rows.map((row, i) => ({ id: row.id, groupId: row.groupId, matched: ownMatch[i]!, visible: visible[i]! }));
  const matches = result.filter((r) => r.matched);
  const groupsWithMatches: string[] = [];
  for (const m of matches) {
    if (!groupsWithMatches.includes(m.groupId)) groupsWithMatches.push(m.groupId);
  }
  return { rows: result, matches, groupsWithMatches };
}

// ---------------------------------------------------------------------------
// Cross-claim matching (837 batch — docs/UI_REQUIREMENTS_v3_queued_features.md
// §1's "also report matches in OTHER claims"). Scoped to the fields already
// synchronously available on every `ClaimSummaryDto` (claim id, patient
// name, form type, total) rather than each other claim's full field-level
// ClaimDetailDto — fetching every other claim's full detail on every
// keystroke (an extra IPC round trip per claim, potentially hundreds in a
// large 837 batch) would make typing feel laggy for a feature whose own spec
// only asks for a coarse "N matches in M other claims" count, not per-field
// fidelity for claims the user hasn't opened yet.
// ---------------------------------------------------------------------------

export interface OtherClaimSummary {
  /** The claim's index within the tab's `summaries` array — what a "jump" needs to actually switch to it. */
  index: number;
  claimId: string;
  patientName: string;
  formTypeLabel: string;
  totalLabel: string;
}

export interface OtherClaimMatch {
  index: number;
  /** How many of this claim's summary fields matched — summed into the aggregate "N matches" figure. */
  matchCount: number;
}

export interface OtherClaimSearchResult {
  totalMatches: number;
  /** One entry per OTHER claim with at least one matching field, in the order `others` was given (callers pass claims in ascending index order, so `matches[0]` is the nearest/lowest-index other claim with a match — what the "click-to-jump" control jumps to). */
  matches: OtherClaimMatch[];
}

export function computeOtherClaimMatches(others: OtherClaimSummary[], query: string): OtherClaimSearchResult {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery === '') return { totalMatches: 0, matches: [] };

  const matches: OtherClaimMatch[] = [];
  let totalMatches = 0;
  for (const claim of others) {
    const fields = [claim.claimId, claim.patientName, claim.formTypeLabel, claim.totalLabel];
    const matchCount = fields.filter((f) => matchesSearchQuery(f, normalizedQuery)).length;
    if (matchCount > 0) {
      matches.push({ index: claim.index, matchCount });
      totalMatches += matchCount;
    }
  }
  return { totalMatches, matches };
}

// ---------------------------------------------------------------------------
// aria-live text (docs/UI_REQUIREMENTS_v3_queued_features.md §1: "The match
// count, position ... and empty state live in a single aria-live=polite
// aria-atomic=true element ... announcing count and position only — never
// matched row contents").
// ---------------------------------------------------------------------------

export interface OtherClaimsInfo {
  totalMatches: number;
  claimCount: number;
}

/** Irregular-plural-aware — `pluralize(1, 'match', 'matches')` -> "1 match", `pluralize(3, 'match', 'matches')` -> "3 matches". `plural` defaults to `singular + 's'` for the regular case (`pluralize(2, 'group')` -> "2 groups"). */
function pluralize(n: number, singular: string, plural: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function otherClaimsClause(info: OtherClaimsInfo): string {
  if (info.claimCount === 0) return '';
  const verb = info.claimCount === 1 ? 'matches' : 'match';
  return ` — but ${pluralize(info.claimCount, 'other claim')} in this file ${verb}.`;
}

/** `currentMatchOneBased`: the 1-based step-through position (Enter/Shift+Enter), or `null` before the user has stepped to a match yet. */
export function formatMatchSummaryText(totalMatches: number, groupCount: number, currentMatchOneBased: number | null, otherClaims: OtherClaimsInfo): string {
  let text = `${pluralize(totalMatches, 'match', 'matches')} in ${pluralize(groupCount, 'group')}`;
  if (currentMatchOneBased !== null) text += ` — match ${currentMatchOneBased} of ${totalMatches}`;
  if (otherClaims.claimCount > 0) {
    text += ` · ${formatOtherClaimsButtonLabel(otherClaims)}`;
  }
  return text;
}

export function formatEmptyStateText(query: string, otherClaims: OtherClaimsInfo): string {
  const base = `No matches for '${query}' in this claim`;
  return otherClaims.claimCount === 0 ? `${base}.` : `${base}${otherClaimsClause(otherClaims)}`;
}

/** The visible "N more matches in M other claims" click-to-jump control's label (docs/UI_REQUIREMENTS_v3_queued_features.md §1) — separate from the aria-live text above so the control has its own accessible name regardless of whether the live region happens to be observed. */
export function formatOtherClaimsButtonLabel(otherClaims: OtherClaimsInfo): string {
  return `${pluralize(otherClaims.totalMatches, 'more match', 'more matches')} in ${pluralize(otherClaims.claimCount, 'other claim')}`;
}
