import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { renderCms1500 } from '../src/render/cms1500/renderCms1500.js';
import { renderUb04 } from '../src/render/ub04/renderUb04.js';
import { renderDental } from '../src/render/dental/renderDental.js';
import { provenanceFooterLines } from '../src/render/provenance.js';
import type { RenderProvenance } from '../src/render/provenance.js';
import { assertCleanLayout } from './support/geometry.js';
import { cms1500Regions, ub04Regions, dentalRegions, CMS1500_PAGE, UB04_PAGE, DENTAL_PAGE } from './support/regions.js';

/**
 * Build 3.3 — provenance footer. Covers what the golden test (one frozen
 * case) doesn't: that all THREE renderers draw it, that it never displaces
 * the "not an official form" disclaimer, that omitting it changes nothing,
 * and that it stays inside the already-declared footer region (no
 * region-builder change needed — see each renderer's drawFooter comment).
 */

const here = dirname(fileURLToPath(import.meta.url));
const standardFontDataUrl = join(here, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';
const jsonSrc = new JsonClaimSource();
const x12Src = new X12ClaimSource();

function fixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', ...parts), 'utf8');
}

const PROVENANCE: RenderProvenance = {
  sourceFileName: 'real-claim-file.dat',
  sourceSha256: 'deadbeefcafef00d1122334455667788990011223344556677889900aabbcc',
  appVersion: '1.2.3',
  renderedAt: new Date('2026-03-04T05:06:07.000Z'),
};

async function textOf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(...content.items.map((it) => (it as { str: string }).str));
  }
  return parts.join(' ');
}

describe('provenanceFooterLines', () => {
  it('includes the source filename, a SHA-256 prefix, render timestamp, and app version', () => {
    const [line1, line2] = provenanceFooterLines(PROVENANCE);
    expect(line1).toContain('real-claim-file.dat');
    expect(line1).toContain('deadbeefcafe'); // first 12 hex chars
    expect(line2).toContain('2026-03-04T05:06:07.000Z');
    expect(line2).toContain('1.2.3');
  });
});

describe('renderCms1500 — provenance footer (Build 3.3)', () => {
  it('omitting provenance renders identically to calling with no second argument at all', async () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const a = await renderCms1500(claim);
    const b = await renderCms1500(claim, undefined);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('with provenance: footer carries the source/hash/timestamp/version AND keeps the facsimile disclaimer', async () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const bytes = await renderCms1500(claim, PROVENANCE);
    const text = await textOf(bytes);
    expect(text).toContain('real-claim-file.dat');
    expect(text).toContain('1.2.3');
    expect(text).toContain('UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM');
  });

  it('does not change the page count', async () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const without = await PDFDocument.load(await renderCms1500(claim));
    const withProv = await PDFDocument.load(await renderCms1500(claim, PROVENANCE));
    expect(withProv.getPageCount()).toBe(without.getPageCount());
  });

  it('stays inside the existing footer region — no layout regression', async () => {
    const claim = jsonSrc.parse(fixture('synthetic-1500.json'))[0]!;
    const bytes = await renderCms1500(claim, PROVENANCE);
    await assertCleanLayout(
      bytes,
      { pageWidth: CMS1500_PAGE.width, pageHeight: CMS1500_PAGE.height, regions: cms1500Regions() },
      'cms1500 with provenance',
      standardFontDataUrl,
    );
  });
});

describe('renderUb04 — provenance footer (Build 3.3)', () => {
  it('omitting provenance renders identically to calling with no second argument at all', async () => {
    const claim = x12Src.parse(fixture('x12', '837I-minimal.dat'))[0]!;
    const a = await renderUb04(claim);
    const b = await renderUb04(claim, undefined);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('with provenance: footer carries the source/version AND keeps the disclaimer', async () => {
    const claim = x12Src.parse(fixture('x12', '837I-minimal.dat'))[0]!;
    const bytes = await renderUb04(claim, PROVENANCE);
    const text = await textOf(bytes);
    expect(text).toContain('real-claim-file.dat');
    expect(text).toContain('1.2.3');
    expect(text).toContain('UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM');
  });

  it('stays inside the existing footer region — no layout regression', async () => {
    const claim = x12Src.parse(fixture('x12', '837I-minimal.dat'))[0]!;
    const bytes = await renderUb04(claim, PROVENANCE);
    await assertCleanLayout(
      bytes,
      { pageWidth: UB04_PAGE.width, pageHeight: UB04_PAGE.height, regions: ub04Regions() },
      'ub04 with provenance',
      standardFontDataUrl,
    );
  });
});

describe('renderDental — provenance footer (Build 3.3)', () => {
  it('omitting provenance renders identically to calling with no second argument at all', async () => {
    const claim = x12Src.parse(fixture('x12', '837D-all-fields.dat'))[0]!;
    const a = await renderDental(claim);
    const b = await renderDental(claim, undefined);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('with provenance: footer carries the source/version AND keeps the disclaimer', async () => {
    const claim = x12Src.parse(fixture('x12', '837D-all-fields.dat'))[0]!;
    const bytes = await renderDental(claim, PROVENANCE);
    const text = await textOf(bytes);
    expect(text).toContain('real-claim-file.dat');
    expect(text).toContain('1.2.3');
    expect(text).toContain('UNVERIFIED FACSIMILE — NOT AN OFFICIAL FORM');
  });

  it('stays inside the existing footer region — no layout regression', async () => {
    const claim = x12Src.parse(fixture('x12', '837D-all-fields.dat'))[0]!;
    const bytes = await renderDental(claim, PROVENANCE);
    await assertCleanLayout(
      bytes,
      { pageWidth: DENTAL_PAGE.width, pageHeight: DENTAL_PAGE.height, regions: dentalRegions() },
      'dental with provenance',
      standardFontDataUrl,
    );
  });
});

