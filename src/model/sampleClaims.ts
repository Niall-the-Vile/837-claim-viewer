/**
 * Bundled sample-claim registry (ease-of-use + accessibility batch, item 4 —
 * docs/FEATURE_BACKLOG.md #26 / docs/CLAUDE_CODE_NEXT_SESSION.md's "Bundled
 * sample-claim set"). A small, fixed, PHI-free set of synthetic X12 837
 * fixtures under src/samples/ (compiled/copied to dist/src/samples/ by
 * scripts/copy-samples.mjs — see that script's header for why a raw `.dat`
 * asset needs a copy step at all, same reason src/render/fonts/ has one).
 *
 * This is the SINGLE list — electron/main.ts resolves `id` -> an absolute
 * path against this same array and opens it through the exact same
 * `openClaimAtPath` every other open path (native dialog, drag-and-drop, E2E
 * seam) uses, and `getSampleClaims` (electron/preload.ts) hands the renderer
 * only `{ id, label, description }` (never a filename or path) so there is
 * no way for the renderer's menu/welcome-screen list to drift from what main
 * will actually open. Electron-free (no fs/path/Node imports) so it can be
 * imported by test/sampleClaims.test.ts directly.
 */

export interface SampleClaimInfo {
  id: string;
  /** File name under src/samples/ (and dist/src/samples/ once built) — read only by electron/main.ts; never sent across the bridge. */
  fileName: string;
  label: string;
  description: string;
}

export const SAMPLE_CLAIMS: readonly SampleClaimInfo[] = [
  {
    id: 'p-clean',
    fileName: 'sample-837p-clean.dat',
    label: 'Professional (837P) — clean',
    description: 'A synthetic CMS-1500 professional claim with no data warnings.',
  },
  {
    id: 'i-clean',
    fileName: 'sample-837i-clean.dat',
    label: 'Institutional (837I) — clean, with revenue codes',
    description: 'A synthetic UB-04 institutional claim with two revenue-coded service lines and no data warnings.',
  },
  {
    id: 'd-clean',
    fileName: 'sample-837d-clean.dat',
    label: 'Dental (837D) — clean',
    description: 'A synthetic ADA dental claim with a tooth number and surface.',
  },
  {
    id: 'p-defective',
    fileName: 'sample-837p-defective.dat',
    label: 'Professional (837P) — bad billing NPI',
    description: 'A synthetic CMS-1500 claim with an intentionally invalid billing-provider NPI, to show a real warning.',
  },
];

export function findSampleClaim(id: string): SampleClaimInfo | undefined {
  return SAMPLE_CLAIMS.find((s) => s.id === id);
}
