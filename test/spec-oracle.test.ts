import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { JsonClaimSource } from '../src/sources/json/jsonClaimSource.js';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { renderCms1500 } from '../src/render/cms1500/renderCms1500.js';
import { renderUb04 } from '../src/render/ub04/renderUb04.js';
import { renderDental } from '../src/render/dental/renderDental.js';
import { composeName, formatMoney } from '../src/render/text.js';
import type { Claim } from '../src/model/claim.js';

/**
 * Spec-conformance oracle (docs/PLAN_REVISION_v2_JSON.md §5): renders each
 * fixture and asserts every "load-bearing" value the source parser
 * extracted (patient name, member id, each diagnosis code, each service
 * line's proc code and charge, and the billed total) actually made it onto
 * the rendered page. This is deliberately independent of the renderers'
 * OWN field-mapping tests — it walks the parsed Claim object (the same
 * object the renderer was handed) and searches the PDF's extracted text for
 * each value, so a field that's silently dropped somewhere between the
 * claim model and the drawText() call fails loudly here even if no other
 * test happens to check that specific box.
 *
 * Whitespace is normalized (collapsed to single spaces) on both sides
 * before the containment check. This isn't cosmetic slack for a fuzzy
 * match — it compensates for a real, expected quirk of both the renderers
 * and pdfjs's text extraction: CMS-1500 box 2/4 draw last/first/middle name
 * as separate columns (so "SAMPLEPATIENT, PAT Q" is 3+ separate drawText
 * calls, not one string), and pdfjs's getTextContent() inserts its own
 * filler space items between text runs with a horizontal gap. Joining raw
 * items with an extra separator (as allPageText does here, matching
 * test/invariants.test.ts's own helper) can double those gaps up. None of
 * that reflects a real rendering defect, so it must not fail this oracle.
 */

const here = dirname(fileURLToPath(import.meta.url));
const standardFontDataUrl = join(here, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';

const jsonSrc = new JsonClaimSource();
const x12Src = new X12ClaimSource();

function fixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', ...parts), 'utf8');
}

/** Flattens every non-blank text run on every page into one searchable string. Copies `bytes` first — see test/invariants.test.ts's allPageText for why (pdfjs's getDocument({data}) transfers/detaches the input buffer). */
async function allPageText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({ data: bytes.slice(), standardFontDataUrl }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(...content.items.map((it) => (it as { str: string }).str));
  }
  return parts.join(' ');
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Every value the oracle expects to find somewhere in the rendered text, labeled for a readable failure message. Empty-string values are skipped (a blank field renders as an em dash, not the missing value — asserting "" is present is always trivially true and proves nothing). */
function expectedValues(claim: Claim): Array<{ label: string; value: string }> {
  const values: Array<{ label: string; value: string }> = [
    { label: 'patient name', value: composeName(claim.patient.name) },
    { label: 'insured member id', value: claim.insured.memberId },
  ];
  claim.diagnoses.forEach((d, i) => values.push({ label: `diagnosis[${i}] code (${d.pointer || d.ordinal})`, value: d.code }));
  claim.serviceLines.forEach((line, i) => {
    values.push({ label: `service line[${i}] proc code`, value: line.procCode });
    values.push({ label: `service line[${i}] charge`, value: formatMoney(line.charge) });
  });
  values.push({ label: 'total charge', value: formatMoney(claim.totals.totalCharge) });
  return values.filter((v) => v.value !== '');
}

interface OracleCase {
  label: string;
  claim: Claim;
  render: (c: Claim) => Promise<Uint8Array>;
}

function oracleCases(): OracleCase[] {
  return [
    { label: 'cms1500 (synthetic JSON fixture)', claim: jsonSrc.parse(fixture('synthetic-1500.json'))[0]!, render: renderCms1500 },
    { label: 'cms1500 (837P-all-fields.dat)', claim: x12Src.parse(fixture('x12', '837P-all-fields.dat'))[0]!, render: renderCms1500 },
    { label: 'ub04 (837I-all-fields.dat)', claim: x12Src.parse(fixture('x12', '837I-all-fields.dat'))[0]!, render: renderUb04 },
    { label: 'dental (837D-all-fields.dat)', claim: x12Src.parse(fixture('x12', '837D-all-fields.dat'))[0]!, render: renderDental },
  ];
}

describe('spec-conformance oracle — every known fixture value survives into the rendered PDF text', () => {
  for (const { label, claim, render } of oracleCases()) {
    it(`${label}: patient name, member id, each diagnosis, each service line proc/charge, and the total all appear`, async () => {
      const bytes = await render(claim);
      const text = collapseWhitespace(await allPageText(bytes));

      const expected = expectedValues(claim);
      // Sanity: the fixture actually exercises what this test claims to check.
      expect(expected.length).toBeGreaterThan(5);

      for (const { label: fieldLabel, value } of expected) {
        expect(text, `${label}: ${fieldLabel} ("${value}") is missing from the rendered PDF text — a field was silently dropped`).toContain(
          collapseWhitespace(value),
        );
      }
    });
  }
});
