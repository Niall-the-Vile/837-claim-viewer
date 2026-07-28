/**
 * Plain-English, one-sentence explanation of what each warning code means
 * and whose problem it is — shown under the matching warning row in the
 * inspector's "Data warnings" group (see inspector.ts's renderInspector).
 *
 * docs/TABS_BUILD_PLAN.md §2f item 6: kept as the ONE file holding all seven
 * strings, on purpose — this is user-facing copy in a compliance-adjacent
 * tool, so Niall can reword it in a single place. If a future build adds a
 * new warning code, its explanation is added here, in this same file, never
 * a second copy elsewhere.
 *
 * *** NEEDS A WORDING REVIEW *** — this is a first-draft pass written by the
 * implementing agent, not yet read/approved by Niall. Flagged in the build
 * report; nothing here should be treated as final copy.
 *
 * The seven codes are produced by exactly two places (verified against both
 * before writing this file):
 *   - src/sources/json/jsonClaimSource.ts: charge-total-mismatch,
 *     dangling-diag-pointer, billing-npi-invalid, rendering-npi-invalid,
 *     diag-overflow, unsupported-form
 *   - src/sources/x12/x12ClaimSource.ts: dental-transaction-type-unknown
 *     (x12-only — the JSON source has no dental transaction-type concept)
 */

export const WARNING_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  'charge-total-mismatch':
    "The service lines' charges don't add up to the claim's stated total — a data problem in the source file (clearinghouse export or 837), not something this app changed.",
  'dangling-diag-pointer':
    'A service line points to a diagnosis letter that has no matching diagnosis listed on this claim — either the pointer or the diagnosis list is incomplete in the source data.',
  'billing-npi-invalid':
    "The billing provider's NPI fails the standard NPI check-digit validation — confirm it against the provider's enrollment record before relying on it for anything downstream.",
  'rendering-npi-invalid':
    "The rendering provider's NPI fails the standard NPI check-digit validation — confirm it against the provider's enrollment record before relying on it for anything downstream.",
  'diag-overflow':
    'This claim carries more diagnoses than the CMS-1500 facsimile can display (boxes A–L only) — every diagnosis is still parsed and readable in the inspector, just not on the paper-form preview.',
  'unsupported-form':
    "This claim's form type has no paper-form renderer in this version of the app — every parsed field is still readable in the inspector, but there is no facsimile preview to check it against.",
  'dental-transaction-type-unknown':
    "This 837D file's dental transaction-type code wasn't recognized — the claim may use a variant this app hasn't seen, so double-check the dental details in the inspector rather than trusting the facsimile alone.",
});

/** Looks up the explanation for a warning code; `undefined` for any code not in the table above (defensive — every code the sources currently emit is covered, but this stays a lookup miss rather than a throw if a new code ships without an explanation). */
export function explainWarning(code: string): string | undefined {
  return WARNING_EXPLANATIONS[code];
}
