/**
 * UB-04 Occurrence codes (FL31–34) and Occurrence Span codes (FL35–36).
 *
 * Source: NUBC Occurrence Code / Occurrence Span Code sets, as republished
 * by CMS in the Medicare Claims Processing Manual (Pub 100-04, Ch. 25).
 * Public, freely redistributable short labels only. This is a curated
 * subset of the commonly-seen numeric (01–xx) codes — payer-specific
 * alpha-prefixed codes are not covered; an un-listed code shows the raw
 * value alone (never "Unknown").
 *
 * Occurrence codes and occurrence span codes are technically two separate
 * NUBC lists with some numeric overlap; this app decodes both fields
 * against the single table below (a deliberate simplification — a span
 * code in the low-70s range may show a slightly different label than the
 * formal span-code list would give it, which is still far more useful than
 * no decoding at all, and is never presented as certain — see decode.ts).
 *
 * To refresh: check the current Medicare Claims Processing Manual chapter
 * 25 occurrence-code / occurrence-span-code tables and add any new/changed
 * codes below, keyed by the plain 2-character code.
 */
export const OCCURRENCE_CODES: Record<string, string> = {
  '01': 'Accident/medical coverage',
  '02': 'No-fault insurance involved — including auto accident',
  '03': 'Accident/tort liability',
  '04': 'Accident/employment related',
  '05': 'Accident/no medical or liability coverage',
  '06': 'Crime victim',
  '09': 'Start of infertility treatment',
  '10': 'Last menstrual period',
  '11': 'Onset of symptoms/illness',
  '12': 'Date of onset for a chronically dependent individual',
  '16': 'Date of last therapy',
  '17': 'Date outpatient occupational therapy plan established or last reviewed',
  '18': 'Date of retirement — patient/beneficiary',
  '19': 'Date of retirement — spouse',
  '20': 'Guarantee of payment began',
  '21': 'Utilization review notice received',
  '22': 'Date active care ended',
  '24': 'Date insurance denied',
  '25': 'Date benefits terminated by primary payer',
  '26': 'Date skilled nursing facility bed available',
  '27': 'Date home health plan established',
  '28': 'Spouse’s date of birth',
  '29': 'Date outpatient physical therapy plan established or last reviewed',
  '30': 'Date outpatient speech pathology plan established or last reviewed',
  '31': 'Date beneficiary notified of intent to bill (accommodations)',
  '32': 'Date beneficiary notified of intent to bill (procedures/treatments)',
  '33': 'First day of the Medicare coordination period for ESRD beneficiaries',
  '34': 'Date of election of extended care facilities',
  '35': 'Date treatment started for physical therapy',
  '36': 'Date of inpatient hospital discharge for a covered transplant patient',
  '37': 'Date of inpatient hospital discharge for a non-covered transplant patient',
  '38': 'Date treatment started for home IV therapy',
  '39': 'Date treatment started for occupational therapy',
  '40': 'Scheduled date of admission',
  '41': 'Date of first test for pregnancy',
  '42': 'Date of discharge',
  '43': 'Scheduled date of canceled surgery',
  '44': 'Date treatment started for speech therapy',
  '45': 'Date treatment started for cardiac rehabilitation',
  '50': 'Assessment date',
  '51': 'Date of last Kt/V reading (dialysis)',
  '55': 'Date of death',
  '70': 'Qualifying stay dates',
  '71': 'Prior stay dates',
  '72': 'First/last visit dates',
  '73': 'Benefit eligibility period',
  '74': 'Non-covered level of care/leave of absence dates',
  '75': 'SNF level of care dates',
  '76': 'Patient liability',
  '77': 'Provider liability period',
  '78': 'SNF prior stay dates',
  '79': 'Payer code',
};
