import type { Claim, ClaimWarning } from './claim.js';

/**
 * Non-clinical, source-agnostic claim data-integrity checks.
 *
 * Extracted from src/sources/json/jsonClaimSource.ts (docs/BUILD_QUEUE.md
 * Build 3.1, first task before any new rule): both jsonClaimSource.ts and
 * x12ClaimSource.ts call `validateClaim` from here now, so the same rules
 * apply to every source instead of drifting per-parser. The original seven
 * codes (charge-total-mismatch, dangling-diag-pointer, billing-npi-invalid,
 * rendering-npi-invalid, diag-overflow, unsupported-form — plus
 * dental-transaction-type-unknown, which is pushed directly by
 * x12ClaimSource.ts and never lived here) are unchanged by this move; every
 * new code below was added AFTER confirming that move was byte-identical
 * (full `npm run verify` green before any new rule landed).
 *
 * **Clinical-judgment edits (NCCI/MUE/upcoding) are explicitly out of
 * scope** — see docs/FEATURE_BACKLOG.md "Out of scope" #2 and
 * docs/BUILD_QUEUE.md's Build 3 preamble. Every rule here is a structural,
 * date-and-arithmetic or format check that needs no clinical judgment and no
 * quarterly CMS edit file.
 */

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** True for the feed's "no provider" NPI sentinel: blank, or all zeros (e.g. "0", "0000000000"). Shared by jsonClaimSource's mapping-time hasAnyExceptSentinelNpi and this module's rendering-NPI check, so the exemption can't drift between the two call sites. */
export function isSentinelNpi(v: unknown): boolean {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || /^0+$/.test(t);
}

/** NPI = 10 digits with a valid Luhn check over the 80840-prefixed value. */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ('80840' + npi).split('').map(Number);
  let sum = 0;
  // Validate over the full value: the rightmost (check) digit is NOT doubled.
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = digits[i]!;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Normalizes a UB-04 Type of Bill string for every TOB-conditioned rule to
 * go through: strips exactly one leading '0' (a 4-digit TOB carries a
 * leading-zero facility-type digit some sources include), then requires
 * exactly 3 remaining digits. Anything else (blank, wrong length,
 * non-numeric) -> null, and every caller no-ops on null rather than
 * guessing at a malformed TOB.
 */
export function normalizeTob(raw: string): string | null {
  const t = (raw ?? '').trim();
  const stripped = t.startsWith('0') ? t.slice(1) : t;
  return /^\d{3}$/.test(stripped) ? stripped : null;
}

/** Today as a plain 'YYYY-MM-DD' string, in local time — used only as a default "is this suspiciously future-dated" reference, never for date arithmetic, so local-vs-UTC skew doesn't matter here the way it would for a billing calculation. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLineList(oneBasedLineNumbers: number[]): string {
  if (oneBasedLineNumbers.length === 1) return `${oneBasedLineNumbers[0]}`;
  if (oneBasedLineNumbers.length === 2) return `${oneBasedLineNumbers[0]} and ${oneBasedLineNumbers[1]}`;
  const head = oneBasedLineNumbers.slice(0, -1).join(', ');
  return `${head} and ${oneBasedLineNumbers[oneBasedLineNumbers.length - 1]}`;
}

// ---------------------------------------------------------------------------
// 3.1(c) — duplicate service lines
// ---------------------------------------------------------------------------

/**
 * Modifiers that mark a line as a deliberate repeat/distinct procedure
 * rather than an accidental duplicate (repeat procedure 76/77/91, distinct
 * procedural service 59/XE/XS/XP/XU, laterality LT/RT, eyelid E1-E4, finger
 * FA/F1-F9, toe TA/T1-T9, and the coronary-artery/renal-artery laterality
 * set LC/LD/LM/RC/RI). Carrying ANY of these on EITHER line in an otherwise
 * identical pair suppresses the duplicate-line warning for that whole group
 * — see checkDuplicateLines below. Exactly the list in docs/BUILD_QUEUE.md
 * Build 3.1(c); every value is asserted by test/validate.test.ts.
 */
export const DUPLICATE_SUPPRESSING_MODIFIERS: ReadonlySet<string> = new Set([
  '76', '77', '91', '59',
  'XE', 'XS', 'XP', 'XU',
  'LT', 'RT',
  'E1', 'E2', 'E3', 'E4',
  'FA', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
  'TA', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
  'LC', 'LD', 'LM', 'RC', 'RI',
]);

function duplicateLineKey(line: Claim['serviceLines'][number]): string {
  return JSON.stringify([
    line.fromDate,
    line.thruDate,
    line.procCode,
    [...line.modifiers].sort(),
    line.units,
    Math.round(line.charge * 100), // integer cents — avoids float-equality noise
    line.revenueCode ?? '',
    line.toothNumbers ?? '',
    line.toothSurfaces ?? '',
  ]);
}

function checkDuplicateLines(claim: Claim, w: ClaimWarning[]): void {
  const groups = new Map<string, number[]>(); // key -> 0-based line indices
  claim.serviceLines.forEach((line, i) => {
    const key = duplicateLineKey(line);
    const existing = groups.get(key);
    if (existing) existing.push(i);
    else groups.set(key, [i]);
  });

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const suppressed = indices.some((i) =>
      claim.serviceLines[i]!.modifiers.some((m) => DUPLICATE_SUPPRESSING_MODIFIERS.has(m.toUpperCase())),
    );
    if (suppressed) continue;
    const lineNumbers = indices.map((i) => i + 1);
    w.push({
      code: 'duplicate-service-line',
      severity: 'info',
      message: `Service lines ${formatLineList(lineNumbers)} appear to be exact duplicates (same dates, code, modifiers, units and charge).`,
    });
  }
}

// ---------------------------------------------------------------------------
// 3.1(e) — dental tooth/surface validity
// ---------------------------------------------------------------------------

/** Valid Universal Numbering System tokens: permanent 1-32, supernumerary-permanent 51-82, primary A-T, supernumerary-primary AS-TS. */
export function isValidToothToken(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (t === '') return false;
  if (/^([1-9]|[12][0-9]|3[0-2])$/.test(t)) return true; // 1-32
  if (/^(5[1-9]|6[0-9]|7[0-9]|8[0-2])$/.test(t)) return true; // 51-82
  if (/^[A-T]$/.test(t)) return true; // A-T
  if (/^[A-T]S$/.test(t)) return true; // AS-TS
  return false;
}

const VALID_TOOTH_SURFACE_CHARS: ReadonlySet<string> = new Set(['M', 'O', 'D', 'F', 'L', 'B', 'I']);

/** Every character of a surface token must be one of M/O/D/F/L/B/I (Mesial/Occlusal/Distal/Facial/Lingual/Buccal/Incisal). */
export function isValidToothSurfaceToken(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (t === '') return false;
  return [...t].every((ch) => VALID_TOOTH_SURFACE_CHARS.has(ch));
}

function checkDentalToothSurfaces(claim: Claim, w: ClaimWarning[]): void {
  if (claim.formType !== 'dental') return;
  claim.serviceLines.forEach((line, i) => {
    // Never flag an absent tooth number — most dental lines (cleanings,
    // exams) legitimately carry none.
    const numbersRaw = (line.toothNumbers ?? '').trim();
    if (numbersRaw !== '') {
      const bad = numbersRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '' && !isValidToothToken(s));
      if (bad.length > 0) {
        w.push({
          code: 'dental-invalid-tooth-number',
          severity: 'warning',
          message: `Service line ${i + 1} has an invalid tooth number: ${bad.join(', ')}.`,
        });
      }
    }

    const surfacesRaw = (line.toothSurfaces ?? '').trim();
    if (surfacesRaw !== '') {
      const bad = surfacesRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '' && !isValidToothSurfaceToken(s));
      if (bad.length > 0) {
        w.push({
          code: 'dental-invalid-tooth-surface',
          severity: 'warning',
          message: `Service line ${i + 1} has an invalid tooth surface: ${bad.join(', ')}.`,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 3.1(a) — institutional line missing revenue/procedure code, or a
// malformed (non-4-digit) revenue code.
// ---------------------------------------------------------------------------

function checkInstitutionalLines(claim: Claim, w: ClaimWarning[]): void {
  const inst = claim.institutional;
  if (!inst) return;
  if (normalizeTob(inst.typeOfBill) === null) return; // malformed/absent TOB — nothing to condition the check on

  claim.serviceLines.forEach((line, i) => {
    const rev = (line.revenueCode ?? '').trim();
    const hasProc = line.procCode !== '';
    if (rev === '' && !hasProc) {
      w.push({
        code: 'institutional-line-missing-revenue-or-proc',
        severity: 'info',
        message: `Service line ${i + 1} has neither a revenue code nor a procedure code.`,
      });
    } else if (rev !== '' && !/^\d{4}$/.test(rev)) {
      w.push({
        code: 'institutional-line-revenue-code-not-4-digits',
        severity: 'info',
        message: `Service line ${i + 1}'s revenue code "${rev}" is not 4 digits.`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 3.1(b) — date-of-service checks. Both compare plain 'YYYY-MM-DD' strings
// lexicographically — NEVER parsed to Date — which is exactly as correct as
// a Date comparison for this format and carries no timezone risk.
// ---------------------------------------------------------------------------

function checkDatesOfService(claim: Claim, w: ClaimWarning[], today: string): void {
  // (i) outside the claim's own statement period — institutional only, and
  // only when the claim actually states a period (blank statement dates
  // mean there's nothing to compare against).
  const inst = claim.institutional;
  if (inst && inst.statementFrom !== '' && inst.statementThrough !== '') {
    claim.serviceLines.forEach((line, i) => {
      if (line.fromDate === '' && line.thruDate === '') return; // blank date — valid on inpatient bills
      const from = line.fromDate || line.thruDate;
      const thru = line.thruDate || line.fromDate;
      if (from < inst.statementFrom || thru > inst.statementThrough) {
        const span = thru !== from ? `${from} to ${thru}` : from;
        w.push({
          code: 'line-dos-outside-statement-period',
          severity: 'warning',
          message: `Service line ${i + 1}'s date of service (${span}) falls outside the claim's statement period (${inst.statementFrom} to ${inst.statementThrough}).`,
        });
      }
    });
  }

  // (ii) in the future — checked across every form type, but suppressed on
  // a dental claim that's a legitimate forward-dated predetermination
  // request or carries an orthodontic treatment plan.
  const dental = claim.dental;
  const suppressFuture =
    claim.formType === 'dental' && dental != null && (dental.predeterminationNumber !== '' || dental.orthodontics != null);
  if (!suppressFuture) {
    claim.serviceLines.forEach((line, i) => {
      if (line.fromDate === '' && line.thruDate === '') return;
      const from = line.fromDate || line.thruDate;
      if (from > today) {
        w.push({
          code: 'line-dos-in-future',
          severity: 'warning',
          message: `Service line ${i + 1}'s date of service (${from}) is in the future.`,
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 3.1(f) — billing-provider tax ID / taxonomy presence.
// ---------------------------------------------------------------------------

function checkProvider(claim: Claim, w: ClaimWarning[]): void {
  if (claim.billingProvider.taxId === '') {
    w.push({ code: 'billing-taxid-missing', severity: 'warning', message: 'Billing provider tax ID is not present.' });
  }
  if (claim.billingProvider.taxonomy === '') {
    w.push({
      code: 'billing-taxonomy-missing',
      severity: 'info',
      message: 'Billing provider taxonomy is not present (situational — many payers do not require it).',
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Non-blocking, inspector-surfaced data checks. `today` defaults to the
 * real current date (as 'YYYY-MM-DD') but is an explicit parameter so tests
 * can pin it — see test/validate.test.ts's future-DOS cases.
 */
export function validateClaim(claim: Claim, today: string = todayIso()): ClaimWarning[] {
  const w: ClaimWarning[] = [];

  // --- Original six codes (byte-identical to the pre-3.1 jsonClaimSource.ts version) ---

  // Reconcile Σ line charges vs the stated total (compare in integer cents).
  const sumCents = claim.serviceLines.reduce((a, l) => a + Math.round(l.charge * 100), 0);
  const totalCents = Math.round(claim.totals.totalCharge * 100);
  if (claim.serviceLines.length > 0 && sumCents !== totalCents) {
    w.push({
      code: 'charge-total-mismatch',
      severity: 'warning',
      message: `Line charges (${fmtCents(sumCents)}) don't match the claim total (${fmtCents(totalCents)}).`,
    });
  }

  // Diagnosis pointers that reference a position with no diagnosis.
  const present = new Set(claim.diagnoses.map((d) => d.pointer).filter((p) => p !== ''));
  for (const line of claim.serviceLines) {
    for (const p of line.diagPointers) {
      if (!present.has(p)) {
        w.push({
          code: 'dangling-diag-pointer',
          severity: 'warning',
          message: `Diagnosis pointer ${p} on a service line has no matching diagnosis.`,
        });
      }
    }
  }

  // NPI sanity (billing + rendering).
  if (claim.billingProvider.npi !== '' && !isValidNpi(claim.billingProvider.npi)) {
    w.push({ code: 'billing-npi-invalid', severity: 'warning', message: `Billing NPI ${claim.billingProvider.npi} fails the NPI check.` });
  }
  if (claim.renderingProvider.npi !== '' && !isSentinelNpi(claim.renderingProvider.npi) && !isValidNpi(claim.renderingProvider.npi)) {
    w.push({ code: 'rendering-npi-invalid', severity: 'warning', message: `Rendering NPI ${claim.renderingProvider.npi} fails the NPI check.` });
  }

  // More than 12 diagnoses can't all be pointed to on a paper CMS-1500.
  if (claim.diagnoses.some((d) => d.ordinal > 12)) {
    w.push({ code: 'diag-overflow', severity: 'info', message: 'Claim has more than 12 diagnoses; CMS-1500 shows A–L only.' });
  }

  if (claim.formType === 'unsupported') {
    w.push({ code: 'unsupported-form', severity: 'warning', message: `claim_form "${claim.claimFormRaw}" has no form renderer yet.` });
  }

  // --- New in Build 3.1 ---
  checkInstitutionalLines(claim, w);
  checkDatesOfService(claim, w, today);
  checkDuplicateLines(claim, w);
  checkDentalToothSurfaces(claim, w);
  checkProvider(claim, w);

  return w;
}
