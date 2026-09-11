import type { Claim } from '../../model/claim.js';

/**
 * PHI-free filename construction for PDF exports — single-claim (Build 3.3)
 * and batch (docs/BUILD_QUEUE.md Build 4.1). Pure-moved out of
 * electron/main.ts for Build 4's batch export, which needed the SAME
 * building blocks (sanitizeNamePart/earliestServiceDate) the single-claim
 * export path already had, so this is now the ONE place either path reads
 * the naming rule from. Electron-free (no fs/path/Electron import) so it's
 * directly unit-testable, matching every other pure module under
 * src/app/**.
 */

export function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

/**
 * Filename-safe version of a name/provider that KEEPS spaces so the result
 * still reads naturally ("MILLER THEODORE Z"). Strips the characters Windows
 * forbids in a filename, the comma composeName inserts, and any control
 * characters, then collapses whitespace.
 */
export function sanitizeNamePart(value: string): string {
  return value
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|,'.includes(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

/** Earliest service-line date on the claim (YYYY-MM-DD, already normalized by the sources), or '' when no line carries one. */
export function earliestServiceDate(claim: Claim): string {
  const dates = claim.serviceLines.map((l) => l.fromDate).filter((d) => d !== '');
  if (dates.length === 0) return '';
  return dates.reduce((a, b) => (a < b ? a : b));
}

/**
 * Default export filename for a SINGLE claim export:
 * "<billing provider> - <service date>.pdf", e.g.
 * "NATIONWIDE CHILDRENS HOSPITAL - 2026-06-03.pdf".
 *
 * Stays PHI-free by design — the patient name is deliberately NOT used, so
 * an export sitting in a folder listing, a recent-files list or a backup
 * doesn't identify a member. Provider + date of service is what negotiators
 * file by.
 *
 * Any part the claim doesn't carry is skipped, and if none are available it
 * falls back to the claim id so the file is never named just ".pdf".
 */
export function defaultExportFileName(claim: Claim): string {
  const parts = [sanitizeNamePart(claim.billingProvider.name), sanitizeNamePart(earliestServiceDate(claim))].filter((p) => p !== '');
  const base = parts.length > 0 ? parts.join(' - ') : `claim_${sanitizeFileNamePart(claim.claimId) || 'claim'}`;
  return `${base}.pdf`;
}

/**
 * Batch export filename (docs/BUILD_QUEUE.md Build 4.1):
 * "<billing provider> - <service date> - <NNN>.pdf", where NNN is this
 * claim's 1-based ordinal within the source interchange, zero-padded to
 * `totalCount`'s own digit length (a 312-claim batch pads to 3 digits, a
 * 9-claim batch to 1). The ordinal is a POSITION in the file, not patient
 * data, so it carries no additional PHI exposure of its own (same reasoning
 * as the editable-fields feature's `${claimIndex}::` key prefix) — and,
 * since billing provider + date of service are typically near-constant
 * across one real-world batch, the ordinal is what actually makes every
 * file in the destination folder distinguishable from its neighbors.
 */
export function batchExportFileName(claim: Claim, ordinal: number, totalCount: number): string {
  const width = String(Math.max(totalCount, 1)).length;
  const nnn = String(ordinal).padStart(width, '0');
  const parts = [sanitizeNamePart(claim.billingProvider.name), sanitizeNamePart(earliestServiceDate(claim))].filter((p) => p !== '');
  const base = parts.length > 0 ? parts.join(' - ') : `claim_${sanitizeFileNamePart(claim.claimId) || 'claim'}`;
  return `${base} - ${nnn}.pdf`;
}

/**
 * Appends a " (2)", " (3)", ... suffix before the extension until `exists`
 * reports no collision for the candidate name. `exists` is a caller-supplied
 * predicate (rather than this module touching the filesystem itself) so this
 * stays a pure, directly-testable function — electron/main.ts's callers pass
 * a predicate backed by both `existsSync` on the destination folder AND the
 * set of names this batch run has already claimed, so two claims that would
 * otherwise render to the exact same name within ONE run still don't
 * collide.
 *
 * This is the SECOND-LINE fallback only (docs/BUILD_QUEUE.md Build 4.1): the
 * batch filename's ordinal already makes every claim in one run
 * distinguishable, so in practice this only ever fires against a file left
 * over from a PREVIOUS export run to the same destination folder.
 */
export function uniqueFileName(fileName: string, exists: (candidate: string) => boolean): string {
  if (!exists(fileName)) return fileName;
  const dot = fileName.lastIndexOf('.');
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  const ext = dot === -1 ? '' : fileName.slice(dot);
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (exists(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}
