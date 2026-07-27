import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { X12ClaimSource } from '../src/sources/x12/x12ClaimSource.js';
import { renderUb04, getUb04BoxLines, maxLinesForHeight, wrapWithOverflow } from '../src/render/ub04/renderUb04.js';
import { GRID_TABLE, HEADER_FIELD_BOXES } from '../src/render/ub04/layout.js';
import type { Claim, ServiceLine } from '../src/model/claim.js';

const here = dirname(fileURLToPath(import.meta.url));
const inst837IMinimal = readFileSync(join(here, 'fixtures', 'x12', '837I-minimal.dat'), 'utf8');
const inst837IAllFields = readFileSync(join(here, 'fixtures', 'x12', '837I-all-fields.dat'), 'utf8');
const src = new X12ClaimSource();

function loadFixtureClaim(): Claim {
  const claims = src.parse(inst837IMinimal);
  expect(claims).toHaveLength(1);
  return claims[0]!;
}

function bytesToText(bytes: Uint8Array, length: number): string {
  return Buffer.from(bytes.slice(0, length)).toString('latin1');
}

/** Builds a synthetic institutional service line (all synthetic test data — no PHI). */
function makeLine(i: number): ServiceLine {
  return {
    fromDate: '2026-05-07',
    thruDate: '2026-05-07',
    placeOfService: '',
    procCode: `9921${i % 10}`,
    modifiers: [],
    diagPointers: [],
    charge: 25 + i,
    units: '1',
    chargeId: `L${i}`,
    patientResponsibility: 0,
    revenueCode: `030${i % 10}`,
    revenueDescription: `Line ${i}`,
  };
}

function withServiceLines(claim: Claim, count: number): Claim {
  const lines = Array.from({ length: count }, (_, i) => makeLine(i));
  const totalCharge = lines.reduce((sum, l) => sum + l.charge, 0);
  return {
    ...claim,
    serviceLines: lines,
    totals: { ...claim.totals, totalCharge },
  };
}

describe('renderUb04 — basic rendering', () => {
  it('renders a parsed 837I claim to a valid PDF of the right page size', async () => {
    const claim = loadFixtureClaim();
    const bytes = await renderUb04(claim);

    expect(bytesToText(bytes, 5)).toBe('%PDF-');

    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
    const page = loaded.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });
});

describe('renderUb04 — pagination', () => {
  const maxRows = GRID_TABLE.maxRowsPerPage; // 22
  const lastPageCapacity = maxRows - 1; // one row reserved for the 0001 total line

  it(`fits on 1 page at exactly the last-page capacity (${lastPageCapacity} lines)`, async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, lastPageCapacity);
    const bytes = await renderUb04(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('spills to a 2nd page one line past the last-page capacity', async () => {
    const base = loadFixtureClaim();
    const claim = withServiceLines(base, lastPageCapacity + 1);
    const bytes = await renderUb04(claim);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
    for (let i = 0; i < loaded.getPageCount(); i++) {
      const { width, height } = loaded.getPage(i).getSize();
      expect(width).toBe(612);
      expect(height).toBe(792);
    }
  });

  it('drops no service lines across many pages', async () => {
    const base = loadFixtureClaim();
    const lineCount = maxRows * 3 + 5; // forces several full pages plus a partial last page
    const claim = withServiceLines(base, lineCount);
    // renderUb04 itself throws if pagination would drop a line; reaching a
    // resolved promise is proof none were dropped.
    const bytes = await renderUb04(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(4);
  });
});

describe('renderUb04 — determinism', () => {
  it('renders byte-identical output for the same claim twice', async () => {
    const claim = loadFixtureClaim();
    const a = await renderUb04(claim);
    const b = await renderUb04(claim);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('renders byte-identical output across a fresh claim parse (not just object identity)', async () => {
    const claimA = loadFixtureClaim();
    const claimB = loadFixtureClaim();
    const a = await renderUb04(claimA);
    const b = await renderUb04(claimB);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('renderUb04 — safe text handling', () => {
  it('renders a patient name with a character outside WinAnsi without throwing', async () => {
    const base = loadFixtureClaim();
    const claim: Claim = {
      ...base,
      patient: { ...base.patient, name: { last: 'MUÑOZ', first: 'JOŠE', middle: '' } },
    };
    const bytes = await renderUb04(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
  });

  it('renders a UB-04 claim with no institutional block and no service lines without throwing', async () => {
    const base = loadFixtureClaim();
    const { institutional: _institutional, ...rest } = base;
    const claim: Claim = { ...rest, diagnoses: [], serviceLines: [] };
    const bytes = await renderUb04(claim);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });
});

describe('renderUb04 — box-height overflow clamping', () => {
  it('wrapWithOverflow never returns more lines than maxLines, and flags the drop visibly when tokens don\'t fit', () => {
    // Same worst case the coordinator flagged: a real 837I stuffing 12 of
    // each code family into a box with room for only 1 or 2 lines.
    const tokens = Array.from({ length: 12 }, (_, i) => `CODE${i}`);
    for (const maxLines of [1, 2]) {
      // capacity (perLine=4 * maxLines) is 4 or 8 here — strictly less than
      // the 12 tokens, so this must truncate and say so.
      const lines = wrapWithOverflow(tokens, 4, maxLines);
      expect(lines.length).toBeLessThanOrEqual(maxLines);
      expect(lines.join(' ')).toMatch(/\+\d+ more/);
    }
    // At maxLines=3, capacity (4*3=12) exactly covers all 12 tokens — no
    // truncation needed, and none should be reported.
    const exact = wrapWithOverflow(tokens, 4, 3);
    expect(exact.length).toBeLessThanOrEqual(3);
    expect(exact.join(' ')).not.toMatch(/more/);
  });

  it('wrapWithOverflow returns all tokens, untouched, when they fit within maxLines', () => {
    const tokens = ['A', 'B', 'C'];
    const lines = wrapWithOverflow(tokens, 4, 2);
    expect(lines).toEqual(['A  B  C']);
    expect(lines.join(' ')).not.toMatch(/more/);
  });

  it('getUb04BoxLines never exceeds a header box\'s own line capacity for 837I-all-fields.dat (12 of each code)', () => {
    // Only the boxes that render a variable-length, data-driven token list
    // (condition codes / occurrence codes+spans / value codes / diagnoses)
    // go through the maxLinesForHeight clamp — those are exactly the boxes
    // that can carry an unbounded number of codes on a real 837I, which is
    // what makes them collision-prone. The other header boxes (provider,
    // patient, statement period, ...) always draw a small fixed number of
    // lines regardless of claim data, so they aren't part of this contract.
    const CLAMPED_KEYS = ['conditionCodes', 'occurrence', 'valueCodes', 'diagnoses'];
    const [claim] = src.parse(inst837IAllFields);
    for (const box of HEADER_FIELD_BOXES.filter((b) => CLAMPED_KEYS.includes(b.key))) {
      const lines = getUb04BoxLines(claim!, box);
      const capacity = maxLinesForHeight(box.rect.height);
      expect(lines.length, `box "${box.key}" (height ${box.rect.height}) drew ${lines.length} lines, capacity is ${capacity}`).toBeLessThanOrEqual(
        capacity,
      );
    }
  });

  it('flags the condition-codes, occurrence, and value-codes boxes with a visible "+N more" when 837I-all-fields.dat overflows them', () => {
    const [claim] = src.parse(inst837IAllFields);
    // This fixture carries 12 condition codes, 12 occurrence codes + 5
    // spans, and 12 value codes — more than any of these small boxes can
    // show at once, so every one of them must be visibly truncated (this is
    // the exact "12 of each" collision the coordinator reported for FL39-41
    // VALUE CODES colliding with FL50 PAYER NAME below it).
    const overflowKeys = ['conditionCodes', 'occurrence', 'valueCodes'];
    for (const key of overflowKeys) {
      const box = HEADER_FIELD_BOXES.find((b) => b.key === key)!;
      const capacity = maxLinesForHeight(box.rect.height);
      const lines = getUb04BoxLines(claim!, box);
      expect(lines.length).toBeLessThanOrEqual(capacity);
      expect(lines.join(' '), `box "${key}" should show a "+N more" indicator`).toMatch(/\+\d+ more/);
    }
  });

  it('does not falsely flag overflow on the diagnoses box, which fits within capacity for this fixture', () => {
    const [claim] = src.parse(inst837IAllFields);
    const box = HEADER_FIELD_BOXES.find((b) => b.key === 'diagnoses')!;
    const capacity = maxLinesForHeight(box.rect.height);
    const lines = getUb04BoxLines(claim!, box);
    expect(lines.length).toBeLessThanOrEqual(capacity);
    expect(lines.join(' ')).not.toMatch(/\+\d+ more/);
  });

  it('round-trips 837I-all-fields.dat through renderUb04 without throwing despite the 12-of-each overflow', async () => {
    const [claim] = src.parse(inst837IAllFields);
    const bytes = await renderUb04(claim!);
    expect(bytesToText(bytes, 5)).toBe('%PDF-');
  });
});
