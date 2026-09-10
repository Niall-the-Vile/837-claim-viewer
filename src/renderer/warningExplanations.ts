/**
 * Plain-English, one-sentence explanation of what each warning code means
 * and whose problem it is — shown under the matching warning row in the
 * inspector's "Data warnings" group (see inspector.ts's renderInspector).
 *
 * docs/TABS_BUILD_PLAN.md §2f item 6: kept as the ONE file holding every
 * such string, on purpose — this is user-facing copy in a compliance-adjacent
 * tool, so Niall can reword it in a single place. If a future build adds a
 * new warning code, its explanation is added here, in this same file, never
 * a second copy elsewhere.
 *
 * *** NEEDS A WORDING REVIEW *** — this is a first-draft pass written by the
 * implementing agent, not yet read/approved by Niall. Flagged in the build
 * report; nothing here should be treated as final copy. The Build 3.1
 * additions below are flagged again in docs/BUILD_LOG.md's "needs wording
 * review" list, per that build's own rule.
 *
 * The original seven codes are produced by exactly two places (verified
 * against both before this file was first written):
 *   - src/model/validate.ts (moved out of src/sources/json/jsonClaimSource.ts
 *     in Build 3.1): charge-total-mismatch, dangling-diag-pointer,
 *     billing-npi-invalid, rendering-npi-invalid, diag-overflow,
 *     unsupported-form
 *   - src/sources/x12/x12ClaimSource.ts: dental-transaction-type-unknown
 *     (x12-only — the JSON source has no dental transaction-type concept)
 *
 * Build 3.1 (docs/BUILD_QUEUE.md) added twelve more, all non-clinical
 * structural/date/format checks:
 *   - src/model/validate.ts: institutional-line-missing-revenue-or-proc,
 *     institutional-line-revenue-code-not-4-digits,
 *     line-dos-outside-statement-period, line-dos-in-future,
 *     duplicate-service-line, dental-invalid-tooth-number,
 *     dental-invalid-tooth-surface, billing-taxid-missing,
 *     billing-taxonomy-missing
 *   - src/sources/x12/x12ClaimSource.ts (x12-only — EDI structural checks
 *     have no JSON-feed equivalent): edi-se-count-mismatch,
 *     edi-duplicate-claim-id, edi-bad-date-qualifier
 *
 * test/warningExplanations.test.ts asserts every code either source can
 * emit has an entry here.
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
  'institutional-line-missing-revenue-or-proc':
    'This service line has neither a revenue code nor a procedure code — one of the two is expected on every institutional line.',
  'institutional-line-revenue-code-not-4-digits':
    "This line's revenue code isn't the standard 4 digits — double-check it before relying on it.",
  'line-dos-outside-statement-period':
    "This line's date of service falls outside the claim's own statement-covers period — worth confirming which one is wrong before relying on either.",
  'line-dos-in-future':
    "This line's date of service is after today — either a data-entry error or a legitimately forward-dated submission, so confirm which before relying on it.",
  'duplicate-service-line':
    'Two or more lines on this claim have identical dates, code, modifiers, units and charge — likely a duplicate entry rather than two distinct services, unless a repeat/distinct-procedure modifier justifies it.',
  'dental-invalid-tooth-number':
    "This line's tooth number isn't a recognized value (1–32, 51–82, A–T, or AS–TS) — double-check it against the source claim.",
  'dental-invalid-tooth-surface':
    "This line's tooth surface code isn't made up of recognized surface letters (M/O/D/F/L/B/I) — double-check it against the source claim.",
  'billing-taxid-missing':
    "The billing provider's tax ID is not present on this claim — most payers require one to process a claim, so this is usually worth flagging.",
  'billing-taxonomy-missing':
    "The billing provider's taxonomy code is not present (situational — many payers do not require it).",
  'edi-se-count-mismatch':
    "This 837 transaction's trailer (SE01) reports a different segment count than the file actually contains — a sign the file may be truncated or was hand-edited.",
  'edi-duplicate-claim-id':
    'This claim shares its claim ID with another claim in the same 837 transaction — most payers expect claim IDs to be unique within a submission.',
  'edi-bad-date-qualifier':
    "A date segment in this claim's 837 data uses a format qualifier this app doesn't recognize, so that date may not have been read correctly — check it against the raw EDI.",
});

/** Looks up the explanation for a warning code; `undefined` for any code not in the table above (defensive — every code the sources currently emit is covered, but this stays a lookup miss rather than a throw if a new code ships without an explanation). */
export function explainWarning(code: string): string | undefined {
  return WARNING_EXPLANATIONS[code];
}
