import type { Claim, Name, Address } from '../../model/claim.js';
import type { AppliedFieldEdit } from '../../model/editableFields.js';
import type { EffectiveClaimForExport } from '../../app/export/structuredExport.js';
import { lineIsEdited } from '../../app/export/structuredExport.js';

/**
 * X12 5010 837 SERIALIZER — the inverse of x12ClaimSource.ts (docs/BUILD_LOG.md
 * Build 5 section has the full design writeup; this header is the short
 * version).
 *
 * Genuinely IG-shaped (ISA/GS/ST/BHT/1000A/1000B/2000A/2000B/2000C/2300/2400
 * loops, correct segment/element/component delimiters, generated control
 * numbers) for 837P (professional), 837I (institutional), and 837D (dental).
 * Deliberately reuses the SAME loop/segment/element positions
 * x12ClaimSource.ts already reads (see that file's extractXxx functions) —
 * this is what makes the round-trip test (test/x12ClaimSerializer.test.ts)
 * possible at all: every position written here was picked by reading the
 * corresponding extractor, not re-derived from the 005010X222/223/224 IGs
 * from scratch.
 *
 * SCOPE — only fields the normalized `Claim` model actually carries (and
 * that x12ClaimSource.ts actually reads back) are serialized. Fields the
 * X12 source NEVER populates regardless of input — `hospitalization`,
 * `otherInsurance`, `insured.employer`, `totals.amountPaid`,
 * `serviceLines[].patientResponsibility` — are never written here either;
 * on a claim that originated from X12 (every fixture this build's round-trip
 * test uses) those are always their zero-value already, so this is a no-op
 * scope limitation for that case. A JSON-sourced claim that happens to carry
 * one of those fields would lose it on an X12 export/reparse round trip —
 * a known, documented gap (docs/BUILD_LOG.md), not a silent one.
 *
 * DELIMITER SAFETY — every leaf value pulled off the `Claim` (names,
 * addresses, codes, free text) is passed through `safe()`, which strips the
 * four characters this serializer uses structurally (`* : ~ ^`), before it
 * is ever written into a segment or composite. Composite separators (`:`)
 * inserted BY this module's own code (never by `safe()`) are what preserve
 * intentional structure — see e.g. `procComposite`/`hiComposite` below.
 * Without this, a user-typed override (docs/EDITABLE_FIELDS_DESIGN.md)
 * containing one of those characters could silently corrupt the segment
 * structure of a real submission-shaped file — exactly the "malformed
 * real-world EDI" failure mode the task brief calls out as worse than a bad
 * PDF.
 */

// ---------------------------------------------------------------------------
// Delimiters this serializer always uses. Never '*'/'~'/'^' in user data —
// see safe() below.
// ---------------------------------------------------------------------------

const ELEMENT = '*';
const COMPONENT = ':';
const SEGMENT = '~';
const REPETITION = '^';

/** Strips the four structural delimiter characters from a leaf value pulled off the Claim model — see this file's header comment. Never applied to a composite string this module already built (that would destroy the ':' separators it deliberately inserted). */
function safe(v: string | undefined): string {
  return (v ?? '').replace(/[*:~^]/g, ' ');
}

function seg(id: string, elements: (string | undefined)[]): string {
  return [id, ...elements.map((e) => e ?? '')].join(ELEMENT) + SEGMENT + '\n';
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD' (x12ClaimSource.ts's x12Date, inverted). '' -> ''. */
function x12DateOut(iso: string): string {
  return iso === '' ? '' : iso.replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// Control numbers (docs/BUILD_LOG.md Build 5: control-number scheme).
//
// Every one of ISA13/GS06/ST02 is derived from the CURRENT TIME (seconds
// since epoch, mod 1e6 -> 6 digits) plus a caller-supplied, monotonically
// increasing sequence number (electron/main.ts keeps one counter per app
// process, incremented before every 837 export) — so two exports in the
// same second, even the same millisecond, never collide as long as they
// come from the same running app, and two exports from different app
// launches practically never collide either (the seconds component alone
// makes that astronomically unlikely). ISA13/GS06/ST02 each get their own
// derived value (seq, seq+1, seq+2) rather than sharing one literal number,
// matching how real trading partners issue independent control numbers per
// envelope level. Deliberately NOT a hardcoded literal (e.g. "000000001")
// the way a naive reference implementation might do it — that would collide
// on every single export from this app, which is exactly the failure mode
// the task brief calls out.
// ---------------------------------------------------------------------------

export interface ControlNumbers {
  isa: string;
  gs: string;
  st: string;
}

export function makeControlNumbers(now: Date, seq: number): ControlNumbers {
  const seconds = Math.floor(now.getTime() / 1000) % 1_000_000;
  const secondsPart = String(seconds).padStart(6, '0');
  const fmt = (offset: number): string => `${secondsPart}${String((seq + offset) % 1000).padStart(3, '0')}`;
  return { isa: fmt(0), gs: fmt(1), st: fmt(2) };
}

// ---------------------------------------------------------------------------
// Small composite/segment builders shared across loops
// ---------------------------------------------------------------------------

/** Builds a `qualifier:code[:extra...]` composite, trimming trailing empty components. `extra` keys are 0-based component indices (2 = the 3rd component, i.e. right after qualifier/code). */
function hiComposite(qualifier: string, code: string, extra?: Record<number, string>): string {
  const arr: string[] = [qualifier, code];
  if (extra) {
    const maxIdx = Math.max(...Object.keys(extra).map(Number));
    while (arr.length <= maxIdx) arr.push('');
    for (const [k, v] of Object.entries(extra)) arr[Number(k)] = v;
  }
  while (arr.length > 2 && arr[arr.length - 1] === '') arr.pop();
  return arr.join(COMPONENT);
}

/** Builds a `qualifier:code:mod1:mod2:mod3:mod4[:extra...]` composite (SV1/SV2/SV3's procedure composite shape) — mods are always padded to 4 slots so a later `extra` (e.g. SV2's revenue description) lands at the right index, then trailing empties are trimmed. */
function procComposite(qualifier: string, code: string, mods: string[], extra?: Record<number, string>): string {
  const arr: string[] = [qualifier, code, ...mods.slice(0, 4)];
  while (arr.length < 6) arr.push('');
  if (extra) {
    const maxIdx = Math.max(...Object.keys(extra).map(Number));
    while (arr.length <= maxIdx) arr.push('');
    for (const [k, v] of Object.entries(extra)) arr[Number(k)] = v;
  }
  while (arr.length > 2 && arr[arr.length - 1] === '') arr.pop();
  return arr.join(COMPONENT);
}

function nm1Person(entityId: string, name: Name, idQualifier: string, idValue: string): string {
  return seg('NM1', [entityId, '1', safe(name.last), safe(name.first), safe(name.middle), '', '', idValue !== '' ? idQualifier : '', safe(idValue)]);
}

function nm1Org(entityId: string, name: string, idQualifier: string, idValue: string): string {
  return seg('NM1', [entityId, '2', safe(name), '', '', '', '', idValue !== '' ? idQualifier : '', safe(idValue)]);
}

function isBlankName(name: Name): boolean {
  return name.last === '' && name.first === '' && name.middle === '';
}

function n3n4(address: Address): string[] {
  const out: string[] = [];
  if (address.line1 !== '' || address.line2 !== '') out.push(seg('N3', [safe(address.line1), safe(address.line2)]));
  if (address.city !== '' || address.state !== '' || address.zip !== '') out.push(seg('N4', [safe(address.city), safe(address.state), safe(address.zip)]));
  return out;
}

function perPhone(phone: string): string[] {
  return phone === '' ? [] : [seg('PER', ['IC', 'CONTACT', 'TE', safe(phone)])];
}

function refSeg(qualifier: string, value: string): string[] {
  return value === '' ? [] : [seg('REF', [qualifier, safe(value)])];
}

function prvTaxonomy(entityCode: string, taxonomy: string): string[] {
  return taxonomy === '' ? [] : [seg('PRV', [entityCode, 'PXC', safe(taxonomy)])];
}

function dmgSeg(dob: string, sex: string): string[] {
  if (dob === '' && sex === '') return [];
  return [seg('DMG', ['D8', x12DateOut(dob), safe(sex)])];
}

/** DTP for a from/thru pair — D8 (single date) when they're equal, RD8 (range) otherwise. Shared by claim-level (434 statement period) and line-level (472 service date). `[]` when both are blank. */
function dtpRange(qualifier: string, from: string, thru: string): string[] {
  if (from === '' && thru === '') return [];
  const f = from || thru;
  const t = thru || from;
  if (f === t) return [seg('DTP', [qualifier, 'D8', x12DateOut(f)])];
  return [seg('DTP', [qualifier, 'RD8', `${x12DateOut(f)}-${x12DateOut(t)}`])];
}

function dtpSingle(qualifier: string, date: string): string[] {
  return date === '' ? [] : [seg('DTP', [qualifier, 'D8', x12DateOut(date)])];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** letter (box-21 pointer, 'A'..'L') -> 1-based ordinal. Inverse of x12ClaimSource.ts's pointerLetter/jsonClaimSource.ts's pointerLetter. */
function pointerNumber(letter: string): number {
  return letter.length === 1 ? letter.charCodeAt(0) - 64 : 0;
}

// ---------------------------------------------------------------------------
// EDI-native EDITED-equivalent signal (docs/EDITABLE_FIELDS_DESIGN.md
// invariant 6, extended to X12 by this build — see docs/BUILD_LOG.md's
// Build 5 section for the full design rationale).
//
// X12 has no visual-watermark concept, so this uses K3 (Fixed-Format
// Information) — a real 005010X222/223/224 segment reserved for exactly
// this purpose: free-text supplemental information the IG doesn't otherwise
// accommodate, NOT a clinical/certification narrative code (unlike NTE,
// whose qualifiers — ADD/CER/DCP/DGN/RTV/TPO — all carry specific clinical
// or billing-narrative meaning a downstream payer system could
// misinterpret). x12ClaimSource.ts never reads K3 anywhere, so this marker
// is 100% inert to the round-trip comparison — it can never change what the
// reparsed Claim looks like, only what a human (or a text search) sees in
// the raw file. Mandatory and unremovable: both call sites below are driven
// directly off `applied.length > 0`, with no parameter or code path that
// can suppress them once that's true (mirrors the PDF/CSV/JSON EDITED
// stamp's own "single source of truth" pattern in electron/main.ts /
// structuredExport.ts).
// ---------------------------------------------------------------------------

const EDITED_CLAIM_NOTE =
  'THIS CLAIM DATA WAS MODIFIED FROM THE ORIGINAL SOURCE FILE BY 837 CLAIM VIEWER - NOT FOR SUBMISSION';

const K3_MAX_CHARS = 80; // X12 K301's practical element-length ceiling.

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length > 0 ? out : [''];
}

/** Claim-level EDITED marker: the mandatory notice, plus (space permitting) a second K3 naming exactly which fields changed. `[]` when `applied` is empty — never emitted for an unedited claim. */
function editedClaimMarkers(applied: AppliedFieldEdit[]): string[] {
  if (applied.length === 0) return [];
  const out = [seg('K3', [EDITED_CLAIM_NOTE])];
  const fieldList = `MODIFIED FIELDS: ${applied.map((a) => a.label).join('; ')}`;
  for (const part of chunkText(fieldList, K3_MAX_CHARS)) out.push(seg('K3', [part]));
  return out;
}

/** Per-line EDITED marker (task brief: "per-line consideration if practical") — one K3 right after the line's own segments, only for lines that actually carry an override. */
function editedLineMarker(applied: AppliedFieldEdit[], lineIndex: number): string[] {
  return lineIsEdited(applied, lineIndex) ? [seg('K3', [`LINE ${lineIndex + 1} MODIFIED FROM ORIGINAL SOURCE`])] : [];
}

// ---------------------------------------------------------------------------
// Kind resolution (mirrors x12ClaimSource.ts's resolveKind, inverted)
// ---------------------------------------------------------------------------

export type X12Kind = 'P' | 'I' | 'D';

const KIND_VERSION: Record<X12Kind, string> = {
  P: '005010X222A1',
  I: '005010X223A2',
  D: '005010X224A2',
};

function resolveKindFromClaim(claim: Claim): X12Kind {
  if (claim.formType === 'cms1500') return 'P';
  if (claim.formType === 'ub04') return 'I';
  if (claim.formType === 'dental') return 'D';
  throw new Error(
    `Cannot export a claim of form type "${claim.formType}" to X12 837 — only professional (CMS-1500), institutional (UB-04), and dental (ADA) claims are supported.`,
  );
}

function resolveBatchKind(claims: Claim[]): X12Kind {
  const kinds = new Set(claims.map(resolveKindFromClaim));
  if (kinds.size > 1) {
    throw new Error('Cannot export a mix of professional, institutional, and dental claims into a single 837 file — export them one at a time instead.');
  }
  return resolveKindFromClaim(claims[0]!);
}

const KIND_VERSION_PREFIX: Record<X12Kind, string> = {
  P: '005010X222',
  I: '005010X223',
  D: '005010X224',
};

/**
 * Prefers the claim's OWN `claimFormRaw` (the version string the source
 * file actually declared in GS08/ST03 — see x12ClaimSource.ts's
 * `resolveKind`) over this module's canonical default, as long as it's
 * actually a valid version for `kind` — this is what makes `claimFormRaw`
 * round-trip byte-for-byte for every claim that originated from X12 (every
 * fixture the round-trip test uses), rather than silently overwriting it
 * with a fixed literal. A JSON-sourced claim (or any claim whose
 * `claimFormRaw` doesn't match `kind`'s own IG prefix) falls back to the
 * canonical default instead of writing something nonsensical.
 */
function versionStringFor(claim: Claim, kind: X12Kind): string {
  return claim.claimFormRaw.startsWith(KIND_VERSION_PREFIX[kind]) ? claim.claimFormRaw : KIND_VERSION[kind];
}

// ---------------------------------------------------------------------------
// 2010AA billing provider (loop under HL level 20)
// ---------------------------------------------------------------------------

function billingProviderSegments(claim: Claim): string[] {
  const bp = claim.billingProvider;
  const out: string[] = [];
  out.push(...prvTaxonomy('BI', bp.taxonomy));
  out.push(nm1Org('85', bp.name, 'XX', bp.npi));
  out.push(...n3n4(bp.address));
  const refQualifier = bp.taxIdType === 'S' ? 'SY' : 'EI';
  out.push(...refSeg(refQualifier, bp.taxId));
  out.push(...perPhone(bp.phone));
  return out;
}

// ---------------------------------------------------------------------------
// 2000B subscriber (SBR + 2010BA + 2010BB payer) / 2000C patient
// ---------------------------------------------------------------------------

function orderCodeFromLabel(label: string): string {
  if (label === 'Primary') return 'P';
  if (label === 'Secondary') return 'S';
  if (label === 'Tertiary') return 'T';
  return '';
}

function subscriberAndPayerSegments(claim: Claim): string[] {
  const insured = claim.insured;
  const out: string[] = [];
  out.push(seg('SBR', [orderCodeFromLabel(claim.payer.order), '', safe(insured.group), safe(insured.plan)]));
  out.push(nm1Person('IL', insured.name, 'MI', insured.memberId));
  out.push(...n3n4(insured.address));
  out.push(...dmgSeg(insured.dob, insured.sex));
  out.push(nm1Org('PR', claim.payer.name, 'PI', claim.payer.id));
  out.push(...n3n4(claim.payer.address));
  return out;
}

/** Always emitted (docs/BUILD_LOG.md Build 5: "always write a 2000C patient loop" design note) — simpler and exactly as correct as the canonical-patient-implied-by-absence rule x12ClaimSource.ts also supports, since PAT01/NM1*QC here always carry the claim's own patient fields regardless of whether patient == insured. */
function patientSegments(claim: Claim): string[] {
  const p = claim.patient;
  const out: string[] = [];
  out.push(seg('PAT', [safe(p.relationshipToInsured)]));
  out.push(nm1Person('QC', p.name, '', ''));
  out.push(...n3n4(p.address));
  out.push(...dmgSeg(p.dob, p.sex));
  out.push(...perPhone(p.phone));
  return out;
}

// ---------------------------------------------------------------------------
// 2300 claim-level: CLM + DTP + HI + referring/rendering/facility + REF/NTE
// ---------------------------------------------------------------------------

/**
 * CLM01 (X12's own field name is literally "Patient Control Number") is the
 * ONE wire position x12ClaimSource.ts reads into BOTH `claim.claimId` and
 * `claim.patient.accountNumber` (see that file's buildClaim: `patient:
 * { accountNumber: claimId, ... }`) — there is no second slot for these to
 * diverge into on the wire, for a claim that originated from X12. A
 * JSON-sourced claim, however, CAN legitimately carry two different values
 * (jsonClaimSource.ts maps them from separate fields) — so this defaults to
 * `claim.claimId` (the field every OTHER part of this app treats as the
 * claim's identity: duplicate-detection, filenames, the inspector) and only
 * substitutes `patient.accountNumber` when `applied` shows that field was
 * SPECIFICALLY overridden — the one case where a user has explicitly asked
 * to correct "the account number", and X12 has no way to honor that request
 * except by changing the same slot claimId also lives in. See
 * docs/BUILD_LOG.md's Build 5 adversarial-audit note on this exact finding
 * (an earlier version of this function preferred accountNumber
 * unconditionally, which silently discarded a JSON-sourced claim's real
 * claimId even with no override active at all).
 */
function clmSegment(claim: Claim, kind: X12Kind, applied: AppliedFieldEdit[]): string {
  const accountNumberOverridden = applied.some((a) => a.fieldPath === 'patient.accountNumber');
  const patientControlNumber = accountNumberOverridden ? claim.patient.accountNumber || claim.claimId : claim.claimId || claim.patient.accountNumber;
  const causesParts: string[] = [];
  if (claim.flags.autoAccident) causesParts.push('AA');
  if (claim.flags.employmentRelated) causesParts.push('EM');
  if (claim.flags.autoAccident && claim.flags.autoAccidentState !== '') causesParts.push(safe(claim.flags.autoAccidentState));
  const causes = causesParts.join(COMPONENT);

  let composite: string;
  if (kind === 'I') {
    const tob = claim.institutional?.typeOfBill ?? '';
    const facilityAndClass = tob.slice(0, 2);
    const frequency = tob.slice(2, 3);
    composite = `${facilityAndClass}${COMPONENT}A${COMPONENT}${frequency}`;
  } else if (kind === 'D') {
    composite = `${safe(claim.dental?.placeOfTreatment ?? '')}${COMPONENT}B${COMPONENT}1`;
  } else {
    composite = `11${COMPONENT}B${COMPONENT}1`;
  }

  return seg('CLM', [
    safe(patientControlNumber),
    claim.totals.totalCharge.toFixed(2),
    '',
    '',
    composite,
    'Y',
    claim.flags.acceptAssignment ? 'A' : 'C',
    'Y',
    'Y',
    '',
    causes,
  ]);
}

function diagnosisHiSegments(claim: Claim, kind: X12Kind): string[] {
  if (claim.diagnoses.length === 0) return [];
  const composites = claim.diagnoses.map((d, i) => {
    const qualifier = i === 0 ? 'ABK' : 'ABF';
    const extra = kind === 'I' && d.poa !== '' ? { 8: safe(d.poa) } : undefined;
    return hiComposite(qualifier, safe(d.code), extra);
  });
  return chunk(composites, 12).map((group) => seg('HI', group));
}

function institutionalHiSegments(claim: Claim): string[] {
  const inst = claim.institutional;
  if (!inst) return [];
  const out: string[] = [];

  if (inst.admittingDiagnosis !== '') out.push(seg('HI', [hiComposite('ABJ', safe(inst.admittingDiagnosis))]));

  if (inst.principalProcedure) {
    out.push(seg('HI', [hiComposite('BBR', safe(inst.principalProcedure.code), { 3: x12DateOut(inst.principalProcedure.date) })]));
  }

  for (const group of chunk(inst.valueCodes, 12)) {
    out.push(seg('HI', group.map((v) => hiComposite('BE', safe(v.code), { 4: v.amount.toFixed(2) }))));
  }
  for (const group of chunk(inst.occurrenceCodes, 12)) {
    out.push(seg('HI', group.map((o) => hiComposite('BH', safe(o.code), { 3: x12DateOut(o.date) }))));
  }
  for (const group of chunk(inst.occurrenceSpans, 12)) {
    out.push(seg('HI', group.map((s) => hiComposite('BI', safe(s.code), { 3: `${x12DateOut(s.from)}-${x12DateOut(s.through)}` }))));
  }
  for (const group of chunk(inst.conditionCodes, 12)) {
    out.push(seg('HI', group.map((c) => hiComposite('BG', safe(c)))));
  }
  if (inst.drg !== '') out.push(seg('HI', [hiComposite('DR', safe(inst.drg))]));

  return out;
}

function referringProviderSegments(claim: Claim): string[] {
  const rp = claim.referringProvider;
  if (!rp || (isBlankName(rp.name) && rp.npi === '')) return [];
  const out: string[] = [nm1Person('DN', rp.name, 'XX', rp.npi)];
  out.push(...refSeg('G2', rp.id));
  return out;
}

function renderingProviderSegments(claim: Claim): string[] {
  const rp = claim.renderingProvider;
  if (isBlankName(rp.name) && rp.npi === '') return [];
  const out: string[] = [...prvTaxonomy('PE', rp.taxonomy)];
  out.push(nm1Person('82', rp.name, 'XX', rp.npi));
  return out;
}

function facilitySegments(claim: Claim): string[] {
  const f = claim.facility;
  if (!f || (f.name === '' && f.npi === '')) return [];
  const out: string[] = [nm1Org('77', f.name, 'XX', f.npi)];
  out.push(...n3n4(f.address));
  return out;
}

function dentalClaimLevelSegments(claim: Claim): string[] {
  const dental = claim.dental;
  if (!dental) return [];
  const out: string[] = [];
  out.push(...refSeg('G3', dental.predeterminationNumber));
  if (dental.orthodontics) out.push(seg('DN1', ['', safe(dental.orthodontics.monthsRemaining)]));
  for (const tooth of dental.missingTeeth) out.push(seg('DN2', [safe(tooth), 'M']));
  return out;
}

function claimLevelSegments(claim: Claim, kind: X12Kind, applied: AppliedFieldEdit[]): string[] {
  const out: string[] = [clmSegment(claim, kind, applied)];

  if (kind === 'I' && claim.institutional) {
    out.push(...dtpRange('434', claim.institutional.statementFrom, claim.institutional.statementThrough));
    out.push(...dtpSingle('435', claim.institutional.admissionDate));
    const { admissionType, admissionSource, patientStatus } = claim.institutional;
    if (admissionType !== '' || admissionSource !== '' || patientStatus !== '') {
      out.push(seg('CL1', [safe(admissionType), safe(admissionSource), safe(patientStatus)]));
    }
  }

  if (kind === 'D') out.push(...dentalClaimLevelSegments(claim));

  out.push(...refSeg('G1', claim.flags.priorAuth));
  out.push(...refSeg('X4', claim.cliaNumber));
  if (claim.narrative !== '') out.push(seg('NTE', ['ADD', safe(claim.narrative)]));

  out.push(...diagnosisHiSegments(claim, kind));
  if (kind === 'I') out.push(...institutionalHiSegments(claim));

  out.push(...referringProviderSegments(claim));
  out.push(...renderingProviderSegments(claim));
  out.push(...facilitySegments(claim));

  out.push(...editedClaimMarkers(applied));

  return out;
}

// ---------------------------------------------------------------------------
// 2400 service lines
// ---------------------------------------------------------------------------

function professionalLineSegments(line: Claim['serviceLines'][number], lineNumber: number): string[] {
  const composite = procComposite('HC', safe(line.procCode), line.modifiers.map(safe));
  const diagComposite = line.diagPointers.map((p) => String(pointerNumber(p))).join(COMPONENT);
  const out: string[] = [
    seg('LX', [String(lineNumber)]),
    seg('SV1', [composite, line.charge.toFixed(2), 'UN', safe(line.units), safe(line.placeOfService), '', diagComposite]),
  ];
  out.push(...dtpRange('472', line.fromDate, line.thruDate));
  return out;
}

function institutionalLineSegments(line: Claim['serviceLines'][number], lineNumber: number): string[] {
  const composite = procComposite('HC', safe(line.procCode), line.modifiers.map(safe), {
    6: safe(line.revenueDescription ?? ''),
  });
  const out: string[] = [
    seg('LX', [String(lineNumber)]),
    seg('SV2', [safe(line.revenueCode ?? ''), composite, line.charge.toFixed(2), 'UN', safe(line.units)]),
  ];
  out.push(...dtpRange('472', line.fromDate, line.thruDate));
  return out;
}

function tooSegments(toothNumbers: string, toothSurfaces: string): string[] {
  const numbers = toothNumbers === '' ? [] : toothNumbers.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const surfaces = toothSurfaces === '' ? [] : toothSurfaces.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const count = Math.max(numbers.length, surfaces.length);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const num = numbers[i] ?? '';
    const surf = surfaces[i] ?? '';
    const surfComposite = surf
      .split('')
      .map((ch) => safe(ch))
      .join(COMPONENT);
    out.push(seg('TOO', ['', safe(num), surfComposite]));
  }
  return out;
}

function dentalLineSegments(line: Claim['serviceLines'][number], lineNumber: number): string[] {
  const composite = procComposite('AD', safe(line.procCode), line.modifiers.map(safe));
  const areaParts = (line.oralCavityArea ?? '').split('-').filter((p) => p !== '');
  const areaComposite = areaParts.map(safe).join(COMPONENT);
  const out: string[] = [
    seg('LX', [String(lineNumber)]),
    seg('SV3', [composite, line.charge.toFixed(2), '', areaComposite, '', safe(line.units)]),
  ];
  out.push(...tooSegments(line.toothNumbers ?? '', line.toothSurfaces ?? ''));
  out.push(...dtpRange('472', line.fromDate, line.thruDate));
  return out;
}

function serviceLineSegments(claim: Claim, kind: X12Kind, applied: AppliedFieldEdit[]): string[] {
  const out: string[] = [];
  claim.serviceLines.forEach((line, i) => {
    const lineNumber = i + 1;
    if (kind === 'P') out.push(...professionalLineSegments(line, lineNumber));
    else if (kind === 'I') out.push(...institutionalLineSegments(line, lineNumber));
    else out.push(...dentalLineSegments(line, lineNumber));
    out.push(...editedLineMarker(applied, i));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

function isaDate(now: Date): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function isaTime(now: Date): string {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hh}${mi}`;
}

function ccyymmdd(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
}

function buildIsa(now: Date, controlNumber: string, senderId: string, receiverId: string): string {
  const fields = [
    '00',
    padRight('', 10),
    '00',
    padRight('', 10),
    'ZZ',
    padRight(safe(senderId), 15),
    'ZZ',
    padRight(safe(receiverId), 15),
    isaDate(now),
    isaTime(now),
    REPETITION,
    '00501',
    controlNumber.padStart(9, '0').slice(-9),
    '0',
    'T', // usage indicator: Test — this app never submits claims (docs/BUILD_LOG.md Build 5 scope note).
    COMPONENT,
  ];
  return ['ISA', ...fields].join(ELEMENT) + SEGMENT + '\n';
}

/** One claim's full HL(20)+HL(22)+HL(23)+2300+2400 tree, starting at `hlStart` (its billing-provider HL id — subscriber/patient get hlStart+1/hlStart+2). */
function claimTreeSegments(claim: Claim, applied: AppliedFieldEdit[], kind: X12Kind, hlStart: number): string[] {
  const billingHl = hlStart;
  const subscriberHl = hlStart + 1;
  const patientHl = hlStart + 2;
  const out: string[] = [];

  out.push(seg('HL', [String(billingHl), '', '20', '1']));
  out.push(...billingProviderSegments(claim));

  out.push(seg('HL', [String(subscriberHl), String(billingHl), '22', '1']));
  out.push(...subscriberAndPayerSegments(claim));

  out.push(seg('HL', [String(patientHl), String(subscriberHl), '23', '0']));
  out.push(...patientSegments(claim));

  out.push(...claimLevelSegments(claim, kind, applied));
  out.push(...serviceLineSegments(claim, kind, applied));

  return out;
}

/**
 * Serializes one or more claims (all the SAME form kind — see
 * resolveBatchKind) into a single, complete X12 837 interchange:
 * ISA/GS/ST/BHT/1000A/1000B, then one independent HL(20/22/23) tree per
 * claim (see claimTreeSegments — every claim gets its own billing/
 * subscriber/patient loop rather than sharing one across claims, which is
 * simpler and just as valid X12 as sharing would be), then SE/GE/IEA.
 *
 * `now`/`controlSeq` are supplied by the caller (electron/main.ts) rather
 * than computed here, matching this repo's "formatters never call `new
 * Date()`/generate their own IDs" convention (see structuredExport.ts's own
 * header comment) — this is also what makes makeControlNumbers's collision
 * avoidance actually testable (test/x12ClaimSerializer.test.ts pins both).
 */
export function serializeClaimsToX12(claims: EffectiveClaimForExport[], now: Date, controlSeq: number): string {
  if (claims.length === 0) throw new Error('No claims to export.');
  const kind = resolveBatchKind(claims.map((c) => c.claim));
  const control = makeControlNumbers(now, controlSeq);

  const firstClaim = claims[0]!.claim;
  const senderId = firstClaim.billingProvider.npi || firstClaim.billingProvider.name || 'CLAIMVIEWER';
  const receiverId = firstClaim.payer.id || firstClaim.payer.name || 'PAYER';

  const version = versionStringFor(firstClaim, kind);
  const parts: string[] = [];
  parts.push(buildIsa(now, control.isa, senderId, receiverId));
  parts.push(seg('GS', ['HC', safe(senderId), safe(receiverId), ccyymmdd(now), isaTime(now), control.gs, 'X', version]));
  parts.push(seg('ST', ['837', control.st, version]));
  parts.push(seg('BHT', ['0019', '00', control.st, ccyymmdd(now), isaTime(now), 'CH']));
  parts.push(nm1Org('41', '837 CLAIM VIEWER EXPORT', '46', safe(senderId)));
  parts.push(nm1Org('40', firstClaim.payer.name || 'RECEIVER', '46', safe(receiverId)));

  let nextHl = 1;
  for (const { claim, applied } of claims) {
    parts.push(...claimTreeSegments(claim, applied, kind, nextHl));
    nextHl += 3;
  }

  // SE01 = segment count strictly between ST and SE (ST/SE themselves
  // excluded) — every `parts` entry from BHT through the last claim's
  // segments is exactly that set; ISA/GS aren't counted (they're outside
  // the ST...SE transaction set) and SE hasn't been pushed yet.
  const transactionSegmentCount = parts.length - 2; // minus ISA, GS
  parts.push(seg('SE', [String(transactionSegmentCount + 1), control.st])); // +1 counts SE itself
  parts.push(seg('GE', ['1', control.gs]));
  parts.push(seg('IEA', ['1', control.isa]));

  return parts.join('');
}
