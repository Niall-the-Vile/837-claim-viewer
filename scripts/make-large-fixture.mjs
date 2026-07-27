#!/usr/bin/env node
/**
 * Derives large/volume test fixtures from the repo's existing small,
 * hand-authored fixtures under test/fixtures/ — by mechanically repeating
 * segments/objects and mutating only ids, dates, and sequence numbers.
 * Never hand-authors new EDI or JSON, and never invents new claim
 * semantics (diagnosis codes, revenue/procedure pairs, etc. are read out of
 * the existing fixtures and reused/cycled, not made up here).
 *
 * Deterministic: no Date.now(), no Math.random() — every run produces
 * byte-identical output. Re-run any time the small source fixtures change:
 *
 *   node scripts/make-large-fixture.mjs
 *
 * Generates:
 *   test/fixtures/x12/837I-400-claims.dat  - 400 institutional claims, one ST/SE
 *   test/fixtures/x12/837I-long-lines.dat  - 1 UB-04 claim, 120 SV2 service lines
 *   test/fixtures/1500-14-diagnoses.json   - 1 professional claim, 14 diagnoses
 *   test/fixtures/837P-many-warnings.json  - 1 professional claim tripping many warnings
 *
 * See docs/BUILD_QUEUE.md "Build 0 — pre-flight" for why these exist: Builds
 * 3.2, 4.1 and 6 name them as required verification-at-volume inputs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const X12_DIR = join(repoRoot, 'test', 'fixtures', 'x12');
const JSON_DIR = join(repoRoot, 'test', 'fixtures');

// ---------------------------------------------------------------------------
// Minimal X12 segment helpers. This is deliberately NOT the real tokenizer
// (src/sources/x12/tokenize.ts) — that's TypeScript, and this script stays
// dependency-free, hand-rolled JS like copy-fonts.mjs/make-icon.mjs. All of
// the repo's source fixtures use '~' as the segment terminator and '*' as
// the element separator (verified against their ISA byte 3 / byte 105), so a
// fixed '~' / '*' split is safe here even though the real parser reads
// those delimiters positionally per-file.
// ---------------------------------------------------------------------------

/** Splits raw X12 text into trimmed segment strings (no trailing '~'). */
function readSegments(path) {
  const text = readFileSync(path, 'utf8');
  return text
    .split('~')
    .map((s) => s.replace(/^[\r\n\s]+|[\r\n\s]+$/g, ''))
    .filter((s) => s !== '');
}

function idOf(seg) {
  return seg.split('*')[0] ?? '';
}

/** 1-based element index (element 0 is the segment id itself, matching X12 naming: CLM01 = index 1). */
function elOf(seg, n) {
  return seg.split('*')[n] ?? '';
}

/** Returns `seg` with element `n` replaced by `value` (padding with empty elements if needed). */
function setEl(seg, n, value) {
  const parts = seg.split('*');
  while (parts.length <= n) parts.push('');
  parts[n] = value;
  return parts.join('*');
}

function writeSegments(path, segs) {
  writeFileSync(path, segs.map((s) => `${s}~\n`).join(''));
}

function ymd(dateUtcMs) {
  return new Date(dateUtcMs).toISOString().slice(0, 10).replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// 837I-400-claims.dat — 400 institutional claims in one ST/SE transaction,
// derived from test/fixtures/x12/837I-multi-claim.dat's SECOND claim (the
// self-contained one, with no embedded COB loop) repeated 400 times with a
// unique CLM01, an incrementing REF*1G control number, and incrementing
// service dates per claim.
// ---------------------------------------------------------------------------

function buildI400Claims() {
  const src = readSegments(join(X12_DIR, '837I-multi-claim.dat'));
  const isa = src.find((s) => idOf(s) === 'ISA');
  const gs = src.find((s) => idOf(s) === 'GS');
  if (!isa || !gs) throw new Error('837I-multi-claim.dat is missing ISA/GS');
  const gs06 = elOf(gs, 6);
  const isa13 = elOf(isa, 13);

  const stIdx = src.findIndex((s) => idOf(s) === 'ST');
  const seIdx = src.findIndex((s) => idOf(s) === 'SE');
  const body = src.slice(stIdx + 1, seIdx); // BHT .. last claim segment, exclusive of ST/SE

  const clmIdxs = [];
  body.forEach((s, i) => {
    if (idOf(s) === 'CLM') clmIdxs.push(i);
  });
  if (clmIdxs.length < 2) throw new Error('expected >= 2 CLM loops in 837I-multi-claim.dat to derive a template claim');

  const header = body.slice(0, clmIdxs[0]); // billing (HL*1) + subscriber (HL*2) loops, shared by every generated claim
  const template = body.slice(clmIdxs[1]); // the second claim's full segment set (CLM .. end)

  const claimCount = 400;
  const baseDate = Date.UTC(2016, 8, 15); // 2016-09-15 — fixed deterministic anchor, not "today"
  const dayMs = 86400000;

  const seenClmIds = new Set();
  const generated = [];

  for (let i = 1; i <= claimCount; i++) {
    const claimId = `LG${String(i).padStart(4, '0')}CLM`;
    if (seenClmIds.has(claimId)) throw new Error(`duplicate CLM01 generated at claim ${i}: ${claimId}`);
    seenClmIds.add(claimId);

    const svcDate = ymd(baseDate + i * dayMs);
    const refCtrl = `B${String(9000 + i).padStart(6, '0')}`; // incrementing control number, B9001.. B9400

    for (const seg of template) {
      const id = idOf(seg);
      if (id === 'CLM') {
        generated.push(setEl(seg, 1, claimId));
      } else if (id === 'REF' && elOf(seg, 1) === '1G') {
        generated.push(setEl(seg, 2, refCtrl));
      } else if (id === 'DTP' && elOf(seg, 1) === '434') {
        generated.push(setEl(seg, 3, `${svcDate}-${svcDate}`));
      } else if (id === 'DTP' && elOf(seg, 1) === '472') {
        generated.push(setEl(seg, 3, svcDate));
      } else {
        generated.push(seg);
      }
    }
  }

  const bodyOut = [...header, ...generated];
  const stCtrl = '0400';
  const segCount = bodyOut.length + 2; // +ST +SE, matches the (SE01 = body+2) rule verified against every other fixture in this dir

  const out = [
    isa,
    gs,
    `ST*837*${stCtrl}*005010X223A3`,
    ...bodyOut,
    `SE*${segCount}*${stCtrl}`,
    `GE*1*${gs06}`,
    `IEA*1*${isa13}`,
  ];

  const clmCount = out.filter((s) => idOf(s) === 'CLM').length;
  if (clmCount !== claimCount) throw new Error(`expected ${claimCount} CLM segments, got ${clmCount}`);
  const clmIds = out.filter((s) => idOf(s) === 'CLM').map((s) => elOf(s, 1));
  if (new Set(clmIds).size !== claimCount) throw new Error('CLM01 values are not all unique');

  writeSegments(join(X12_DIR, '837I-400-claims.dat'), out);
  console.log(
    `[837I-400-claims] wrote ${claimCount} claims (unique CLM01), ${bodyOut.length} body segments, SE01=${segCount}, GE01=1, IEA01=1`,
  );
}

// ---------------------------------------------------------------------------
// 837I-long-lines.dat — ONE UB-04 claim with 120 SV2 service lines, derived
// from the same claim-2 template's claim-level segments (CLM..REF*1G), with
// 120 LX/SV2/DTP triplets built by cycling through the real (revenue code,
// procedure composite, charge, unit qualifier, units) tuples already present
// in the 837I fixtures — no invented procedure/revenue combination.
// ---------------------------------------------------------------------------

function buildILongLines() {
  const srcMulti = readSegments(join(X12_DIR, '837I-multi-claim.dat'));
  const srcAll = readSegments(join(X12_DIR, '837I-all-fields.dat'));

  const isa = srcMulti.find((s) => idOf(s) === 'ISA');
  const gs = srcMulti.find((s) => idOf(s) === 'GS');
  if (!isa || !gs) throw new Error('837I-multi-claim.dat is missing ISA/GS');
  const gs06 = elOf(gs, 6);
  const isa13 = elOf(isa, 13);

  const stIdx = srcMulti.findIndex((s) => idOf(s) === 'ST');
  const seIdx = srcMulti.findIndex((s) => idOf(s) === 'SE');
  const body = srcMulti.slice(stIdx + 1, seIdx);

  const clmIdxs = [];
  body.forEach((s, i) => {
    if (idOf(s) === 'CLM') clmIdxs.push(i);
  });
  const header = body.slice(0, clmIdxs[0]);
  const template = body.slice(clmIdxs[1]);
  const lxIdx = template.findIndex((s) => idOf(s) === 'LX');
  const claimLevel = template.slice(0, lxIdx); // CLM .. REF*1G, before the first LX/SV2 line

  // Real (revenue, procedure-composite, charge, unit-qualifier, units)
  // tuples pulled from every SV2 in both source 837I fixtures.
  const tuples = [];
  for (const segs of [srcMulti, srcAll]) {
    for (const seg of segs) {
      if (idOf(seg) !== 'SV2') continue;
      tuples.push({ rev: elOf(seg, 1), proc: elOf(seg, 2), charge: elOf(seg, 3), unitQual: elOf(seg, 4), units: elOf(seg, 5) });
    }
  }
  if (tuples.length === 0) throw new Error('no SV2 lines found in the source 837I fixtures to derive from');

  const lineCount = 120;
  const baseDate = Date.UTC(2018, 0, 1); // 2018-01-01 — fixed deterministic anchor
  const dayMs = 86400000;

  const lines = [];
  for (let i = 1; i <= lineCount; i++) {
    const t = tuples[(i - 1) % tuples.length];
    const dos = ymd(baseDate + i * dayMs);
    lines.push(`LX*${i}`);
    lines.push(`SV2*${t.rev}*${t.proc}*${t.charge}*${t.unitQual}*${t.units}`);
    lines.push(`DTP*472*D8*${dos}`);
  }

  const claimId = 'LONGLINES0001';
  const firstDos = ymd(baseDate + dayMs);
  const lastDos = ymd(baseDate + lineCount * dayMs);
  const claimLevelOut = claimLevel.map((seg) => {
    const id = idOf(seg);
    if (id === 'CLM') return setEl(seg, 1, claimId);
    if (id === 'REF' && elOf(seg, 1) === '1G') return setEl(seg, 2, 'B999LL0001');
    if (id === 'DTP' && elOf(seg, 1) === '434') return setEl(seg, 3, `${firstDos}-${lastDos}`);
    return seg;
  });

  const bodyOut = [...header, ...claimLevelOut, ...lines];
  const stCtrl = '0120';
  const segCount = bodyOut.length + 2;

  const out = [
    isa,
    gs,
    `ST*837*${stCtrl}*005010X223A3`,
    ...bodyOut,
    `SE*${segCount}*${stCtrl}`,
    `GE*1*${gs06}`,
    `IEA*1*${isa13}`,
  ];

  const sv2Count = out.filter((s) => idOf(s) === 'SV2').length;
  if (sv2Count !== lineCount) throw new Error(`expected ${lineCount} SV2 lines, got ${sv2Count}`);
  const clmCount = out.filter((s) => idOf(s) === 'CLM').length;
  if (clmCount !== 1) throw new Error(`expected exactly 1 claim, got ${clmCount}`);

  writeSegments(join(X12_DIR, '837I-long-lines.dat'), out);
  console.log(`[837I-long-lines] wrote 1 claim, ${sv2Count} SV2 lines, SE01=${segCount}, GE01=1, IEA01=1`);
}

// ---------------------------------------------------------------------------
// Shared: pull a pool of real ICD-10-ish diagnosis codes already present in
// the repo's fixtures (HI*ABK/ABF composites in the .dat files, diag_N
// fields in the JSON ones) — used by both JSON builders below so no
// diagnosis code is ever typed in by hand.
// ---------------------------------------------------------------------------

function diagCodesFromDat(path) {
  const text = readFileSync(path, 'utf8');
  const codes = [];
  const re = /\b(?:ABK|ABF):([A-Z0-9]+)/g;
  let m;
  while ((m = re.exec(text))) codes.push(m[1]);
  return codes;
}

function diagCodesFromJson(path) {
  const obj = JSON.parse(readFileSync(path, 'utf8'));
  const codes = [];
  for (let i = 1; i <= 24; i++) {
    const v = obj[`diag_${i}`];
    if (typeof v === 'string' && v.trim() !== '') codes.push(v.trim());
  }
  return codes;
}

function gatherDiagCodePool() {
  const seen = new Set();
  const pool = [];
  const add = (c) => {
    if (c && !seen.has(c)) {
      seen.add(c);
      pool.push(c);
    }
  };
  for (const f of ['837I-multi-claim.dat', '837I-all-fields.dat', '837P-all-fields.dat', '837D-all-fields.dat']) {
    for (const c of diagCodesFromDat(join(X12_DIR, f))) add(c);
  }
  for (const c of diagCodesFromJson(join(JSON_DIR, 'synthetic-1500.json'))) add(c);
  if (pool.length === 0) throw new Error('no diagnosis codes found in any source fixture');
  return pool;
}

// ---------------------------------------------------------------------------
// 1500-14-diagnoses.json — one professional claim carrying 14 diagnoses
// (diag_1..diag_14), derived from test/fixtures/synthetic-1500.json with its
// diagnosis codes replaced by 14 codes drawn from the shared pool above
// (cycled if the pool were ever smaller than 14) — to exercise the CMS-1500
// A-L pointer overflow.
// ---------------------------------------------------------------------------

function buildDiag14() {
  const base = JSON.parse(readFileSync(join(JSON_DIR, 'synthetic-1500.json'), 'utf8'));
  const pool = gatherDiagCodePool();
  const need = 14;
  const codes = Array.from({ length: need }, (_, i) => pool[i % pool.length]);

  const claim = structuredClone(base);
  claim.claimid = 'LG-DIAG-0001';
  claim.pcn = 'ACCT-LGDIAG-0001';
  for (let i = 1; i <= 24; i++) delete claim[`diag_${i}`];
  for (let i = 1; i <= need; i++) claim[`diag_${i}`] = codes[i - 1];

  writeFileSync(join(JSON_DIR, '1500-14-diagnoses.json'), `${JSON.stringify(claim, null, 2)}\n`);
  console.log(`[1500-14-diagnoses] wrote 1 claim with ${need} diagnoses (pool had ${pool.length} distinct codes): ${codes.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 837P-many-warnings.json — one professional claim engineered to trip every
// rule validateClaim() (src/sources/json/jsonClaimSource.ts) currently has:
// charge-total-mismatch, dangling-diag-pointer (repeated across several
// lines — the volume dimension), billing-npi-invalid, rendering-npi-invalid,
// and diag-overflow. That is all 5 distinct non-form-type codes the current
// rule set can produce (a 6th, unsupported-form, is deliberately not used —
// it would mean the claim doesn't render as a professional claim at all,
// which isn't what "stress the warnings banner" is testing). See the report
// for why ">8 distinct codes" isn't reachable before Build 3.1 adds more
// rules, and how this fixture instead produces >8 total warning entries.
// ---------------------------------------------------------------------------

function buildManyWarnings() {
  const base = JSON.parse(readFileSync(join(JSON_DIR, 'synthetic-1500.json'), 'utf8'));
  const pool = gatherDiagCodePool();

  const claim = structuredClone(base);
  claim.claimid = 'LG-WARN-0001';
  claim.pcn = 'ACCT-LGWARN-0001';

  // charge-total-mismatch: inflate the stated total against the (unchanged) line charges.
  claim.total_charge = (Number(base.total_charge) + 1000).toFixed(2);

  // billing-npi-invalid / rendering-npi-invalid: single-digit mutations of
  // the fixture's own valid NPI (1234567893), chosen because they fail the
  // Luhn check in isValidNpi() (verified: 1234567890 and 1111111111 both
  // fail; 1234567893, the source value, passes).
  claim.bill_npi = '1234567890';
  claim.prov_npi = '1111111111';

  // diag-overflow: only diag_1 and diag_13 populated. Ordinal 13 alone trips
  // the ">12 diagnoses" rule, and leaving 2..12 blank means only pointer 'A'
  // is "present" — so every other A-L pointer below is dangling.
  for (let i = 1; i <= 24; i++) delete claim[`diag_${i}`];
  claim.diag_1 = pool[0];
  claim.diag_13 = pool[1] ?? pool[0];

  // dangling-diag-pointer x11: three lines (the fixture's own two charge
  // templates, cycled, with only chgid/diag_ref mutated), each pointing at
  // pointer letters B-L that have no matching diagnosis.
  const templates = base.charge;
  const pointerSets = ['BCDE', 'FGHI', 'JKL'];
  claim.charge = pointerSets.map((diagRef, i) => {
    const t = structuredClone(templates[i % templates.length]);
    t.chgid = `LW${i + 1}`;
    t.diag_ref = diagRef;
    return t;
  });

  writeFileSync(join(JSON_DIR, '837P-many-warnings.json'), `${JSON.stringify(claim, null, 2)}\n`);
  const totalDangling = pointerSets.reduce((a, s) => a + s.length, 0);
  console.log(
    `[837P-many-warnings] wrote 1 claim: charge-total-mismatch(1) + dangling-diag-pointer(${totalDangling}) + billing-npi-invalid(1) + rendering-npi-invalid(1) + diag-overflow(1) = ${1 + totalDangling + 1 + 1 + 1} warnings across 5 distinct codes`,
  );
}

// ---------------------------------------------------------------------------

buildI400Claims();
buildILongLines();
buildDiag14();
buildManyWarnings();
