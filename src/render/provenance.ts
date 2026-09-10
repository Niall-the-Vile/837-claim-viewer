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
}

/** Two short, footer-sized lines: source file + a short hash prefix, then render timestamp + app version. Shared verbatim by all three renderers so the wording never drifts between forms. */
export function provenanceFooterLines(p: RenderProvenance): [string, string] {
  const shortSha = p.sourceSha256.length > 12 ? `${p.sourceSha256.slice(0, 12)}…` : p.sourceSha256;
  return [
    `Source: ${p.sourceFileName}  ·  SHA-256 ${shortSha}`,
    `Rendered ${p.renderedAt.toISOString()}  ·  claim-viewer ${p.appVersion}`,
  ];
}
