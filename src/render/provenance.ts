/**
 * Optional provenance footer band for exported PDFs (docs/BUILD_QUEUE.md
 * Build 3.3). Every renderer (renderCms1500 / renderUb04 / renderDental)
 * takes this as an optional FINAL parameter and draws two extra footer
 * lines only when it's supplied. Every varying value here is passed IN by
 * the caller (electron/main.ts's dialog:exportPdf handler) — never computed
 * inside a renderer (no `new Date()`, no hash computed here), so the
 * renderers stay pure and deterministic. Omitting this parameter renders
 * BYTE-IDENTICAL output to before this build — see each renderer's
 * determinism test and the four golden manifests, none of which pass a
 * provenance object.
 *
 * This SUPPLEMENTS the "UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM" /
 * "UNVERIFIED — NOT AN OFFICIAL ADA FORM" disclaimer every renderer's footer
 * already draws — it never replaces it (docs/FEATURE_BACKLOG.md "Out of
 * scope" #7: the provenance footer is acceptable only because it keeps that
 * disclaimer, not because it substitutes for it).
 */
export interface RenderProvenance {
  /** The source file's name as opened (not a full path — matches the export filename's own PHI-free convention). */
  sourceFileName: string;
  /** Hex-encoded SHA-256 of the source file's bytes, computed once when the file was opened (electron/main.ts's ClaimSession), not re-hashed at export time. */
  sourceSha256: string;
  /** The app's own version string (electron/main.ts's build-info stamp, falling back to app.getVersion()). */
  appVersion: string;
  /** Wall-clock time of this specific export, supplied by the caller so the renderer never calls `new Date()` itself. */
  renderedAt: Date;
  /**
   * Editable-fields feature (docs/EDITABLE_FIELDS_DESIGN.md), invariant 6:
   * whether the `claim` this provenance is attached to has ANY active field
   * override applied. Required (not optional) precisely so a caller can
   * never construct a `RenderProvenance` without deciding this — the
   * mandatory EDITED stamp below is gated on it. `false`/`0` for every
   * existing call site that predates this feature (the golden/provenance
   * tests), which changes nothing about their rendered output — see
   * `provenanceFooterLines` below.
   */
  edited: boolean;
  /** How many field overrides are active, for the stamp's wording ("EDITED — N field(s) modified by user"). 0 when `edited` is false. */
  editedFieldCount: number;
}

/**
 * The footer lines to draw, in order. Always ends with the same two lines as
 * before this feature (source file + hash, then timestamp + version) —
 * unchanged in content and position when `editedFieldCount` is 0, which is
 * what keeps every pre-existing golden/determinism test byte-identical.
 * When `editedFieldCount > 0`, a THIRD line is PREPENDED — the mandatory,
 * unremovable "this export contains user-edited values" stamp (invariant 6):
 * it is drawn FIRST (most prominent position) by every caller, distinct
 * from — and never a replacement for — the "visual facsimile, not a
 * submittable form" disclaimer each renderer's footer already draws
 * unconditionally.
 */
export function provenanceFooterLines(p: RenderProvenance): string[] {
  const shortSha = p.sourceSha256.length > 12 ? `${p.sourceSha256.slice(0, 12)}…` : p.sourceSha256;
  const lines: string[] = [];
  if (p.editedFieldCount > 0) {
    lines.push(`EDITED — ${p.editedFieldCount} field${p.editedFieldCount === 1 ? '' : 's'} modified by user, see below`);
  }
  lines.push(`Source: ${p.sourceFileName}  ·  SHA-256 ${shortSha}`, `Rendered ${p.renderedAt.toISOString()}  ·  claim-viewer ${p.appVersion}`);
  return lines;
}
