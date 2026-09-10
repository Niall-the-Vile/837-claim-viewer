import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { JsonClaimSource } from '../../src/sources/json/jsonClaimSource.js';
import { X12ClaimSource } from '../../src/sources/x12/x12ClaimSource.js';
import { renderCms1500 } from '../../src/render/cms1500/renderCms1500.js';
import { renderUb04 } from '../../src/render/ub04/renderUb04.js';
import { renderDental } from '../../src/render/dental/renderDental.js';
import type { Claim } from '../../src/model/claim.js';
import type { RenderProvenance } from '../../src/render/provenance.js';

/**
 * Golden render manifests: renders each form from a fixed fixture, extracts
 * every drawn text run as {text, x, y} (x/y = pdfjs's text-matrix origin,
 * i.e. where pdf-lib's drawText placed it — PDF bottom-left-origin page
 * coordinates), and diffs that against a committed JSON snapshot. This
 * catches anything the layout/pagination/spec-oracle invariant tests don't
 * — a field that moves a few points, a row that silently reorders, a
 * boilerplate label that gets reworded — because unlike those tests this
 * one has NO tolerance and NO "is it somewhere in a valid region" slack; it
 * demands the exact same text runs at the exact same coordinates.
 *
 * That strictness is also why this suite is deliberately narrow (4 cases,
 * fixed fixtures) rather than parametrized over every fixture like
 * test/invariants.test.ts — a golden test is supposed to be boring to keep
 * green; broad coverage of "is this claim renderable at all" already lives
 * in the layout-invariant and spec-oracle suites.
 *
 * Regenerate after an intentional layout change:
 *   UPDATE_GOLDENS=1 npx vitest run test/golden/render.test.ts
 * then review the diff of the committed test/golden/*.json files like any
 * other code change before committing it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const standardFontDataUrl = join(repoRoot, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';
const UPDATE = process.env['UPDATE_GOLDENS'] === '1';

const jsonSrc = new JsonClaimSource();
const x12Src = new X12ClaimSource();

function fixture(...parts: string[]): string {
  return readFileSync(join(repoRoot, 'test', 'fixtures', ...parts), 'utf8');
}

interface GoldenItem {
  text: string;
  x: number;
  y: number;
}
type GoldenPage = GoldenItem[];
type GoldenManifest = GoldenPage[];

/** Rounds to 2dp — pdf-lib/pdfjs coordinates are already stable to well under this across runs (see renderCms1500.test.ts's byte-identical-output determinism test), so this is just insurance against float noise, not real slack. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Extracts every non-blank text run on every page as {text, x, y}, in page order. Blank/whitespace-only items (pdfjs's own inter-run gap filler, not something the renderer drew) are dropped — see test/spec-oracle.test.ts's header comment for the same quirk. */
async function extractManifest(bytes: Uint8Array): Promise<GoldenManifest> {
  // .slice(): pdfjs's getDocument({data}) transfers/detaches the input
  // buffer (see test/invariants.test.ts's allPageText for the full
  // explanation) — copy so the caller's `bytes` stays usable afterward.
  const doc = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const pages: GoldenManifest = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items
      .map((raw) => raw as { str: string; transform: number[] })
      .filter((it) => it.str.trim() !== '')
      .map((it) => ({ text: it.str, x: round2(it.transform[4] ?? 0), y: round2(it.transform[5] ?? 0) }));
    pages.push(items);
  }
  return pages;
}

interface GoldenCase {
  id: string;
  label: string;
  claim: Claim;
  render: (c: Claim) => Promise<Uint8Array>;
}

/** Fixed, never-`new Date()` provenance object for the one provenance golden case (Build 3.3) — every value is a literal, exactly as a real caller (electron/main.ts) must supply them, so this case is reproducible across runs. */
const FROZEN_PROVENANCE: RenderProvenance = {
  sourceFileName: 'synthetic-1500.json',
  sourceSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0',
  appVersion: '0.0.1',
  renderedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function goldenCases(): GoldenCase[] {
  return [
    {
      id: 'cms1500-synthetic-json',
      label: 'cms1500 (synthetic-1500.json)',
      claim: jsonSrc.parse(fixture('synthetic-1500.json'))[0]!,
      render: renderCms1500,
    },
    {
      id: 'cms1500-837p',
      label: 'cms1500 (837P-all-fields.dat)',
      claim: x12Src.parse(fixture('x12', '837P-all-fields.dat'))[0]!,
      render: renderCms1500,
    },
    {
      id: 'ub04-837i',
      label: 'ub04 (837I-all-fields.dat)',
      claim: x12Src.parse(fixture('x12', '837I-all-fields.dat'))[0]!,
      render: renderUb04,
    },
    {
      id: 'dental-837d',
      label: 'dental (837D-all-fields.dat)',
      claim: x12Src.parse(fixture('x12', '837D-all-fields.dat'))[0]!,
      render: renderDental,
    },
    {
      // Build 3.3: proves the provenance footer renders (and stays stable)
      // WITHOUT touching a single existing golden — if this case's own
      // manifest ever drifts unexpectedly, or if adding it changed any of
      // the four cases above, that's provenance leaking into the default
      // path and must be fixed, never "explained away" by regenerating.
      id: 'cms1500-synthetic-json-with-provenance',
      label: 'cms1500 (synthetic-1500.json, WITH provenance footer)',
      claim: jsonSrc.parse(fixture('synthetic-1500.json'))[0]!,
      render: (c: Claim) => renderCms1500(c, FROZEN_PROVENANCE),
    },
  ];
}

describe('golden render manifests', () => {
  for (const { id, label, claim, render } of goldenCases()) {
    it(`${label}: rendered text/position manifest matches the committed golden`, async () => {
      const bytes = await render(claim);
      const actual = await extractManifest(bytes);
      const goldenPath = join(here, `${id}.json`);

      if (UPDATE) {
        mkdirSync(here, { recursive: true });
        writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + '\n', 'utf8');
      }

      expect(existsSync(goldenPath), `No golden manifest at ${goldenPath} — regenerate with UPDATE_GOLDENS=1 npx vitest run test/golden/render.test.ts`).toBe(
        true,
      );
      const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenManifest;
      expect(actual).toEqual(golden);
    });
  }
});
