import { describe, it, expect } from 'vitest';
import {
  decodePlaceOfService,
  decodeRevenueCode,
  decodeModifier,
  decodeDischargeStatus,
  decodeConditionCode,
  decodeOccurrenceCode,
  decodeValueCode,
  decodeTypeOfBill,
} from '../src/model/decode.js';

/**
 * Fixture-in / exact-string-out tests for the public CMS/NUBC code-set
 * decoders (docs/BUILD_QUEUE.md Build 2.2). Each decoder is pure and
 * Electron-free (see src/model/decode.ts's header) so it's called directly
 * here — no Electron, no DOM, no fixture file I/O needed.
 */

describe('decodePlaceOfService', () => {
  it('decodes a known 2-digit POS code', () => {
    expect(decodePlaceOfService('11')).toEqual({ raw: '11', decoded: 'Office' });
  });

  it('decodes inpatient hospital', () => {
    expect(decodePlaceOfService('21')).toEqual({ raw: '21', decoded: 'Inpatient hospital' });
  });

  it('passes through an unrecognized code with decoded: null', () => {
    // Deliberately a code CMS has never assigned. This used to be '27',
    // which was a genuine gap in PLACE_OF_SERVICE (assigned 2023-10-01 as
    // Outreach Site/Street) — so the test passed for the wrong reason and
    // turned red the moment the table was corrected. A fixture for
    // "unrecognized" must be a code that can never become recognized.
    expect(decodePlaceOfService('43')).toEqual({ raw: '43', decoded: null });
  });

  it('passes through a blank code with decoded: null', () => {
    expect(decodePlaceOfService('')).toEqual({ raw: '', decoded: null });
  });
});

describe('decodeRevenueCode', () => {
  it('decodes a known 4-digit revenue code', () => {
    expect(decodeRevenueCode('0450')).toEqual({ raw: '0450', decoded: 'Emergency room' });
  });

  it('decodes laboratory hematology', () => {
    expect(decodeRevenueCode('0305')).toEqual({ raw: '0305', decoded: 'Laboratory — hematology' });
  });

  it('passes through an unrecognized revenue code with decoded: null', () => {
    expect(decodeRevenueCode('9999')).toEqual({ raw: '9999', decoded: null });
  });

  it('passes through a blank revenue code with decoded: null (professional lines carry no revenue code)', () => {
    expect(decodeRevenueCode('')).toEqual({ raw: '', decoded: null });
  });
});

describe('decodeModifier', () => {
  it('decodes CPT modifier 26 (professional component)', () => {
    expect(decodeModifier('26')).toEqual({ raw: '26', decoded: 'Professional component' });
  });

  it('decodes HCPCS modifier TC (technical component)', () => {
    expect(decodeModifier('TC')).toEqual({ raw: 'TC', decoded: 'Technical component' });
  });

  it('decodes modifier 25', () => {
    expect(decodeModifier('25')).toEqual({ raw: '25', decoded: 'Significant, separately identifiable E/M service, same day as a procedure' });
  });

  it('is case-insensitive on alpha modifiers', () => {
    expect(decodeModifier('lt')).toEqual({ raw: 'lt', decoded: 'Left side' });
  });

  it('passes through an unrecognized modifier with decoded: null', () => {
    expect(decodeModifier('ZZ')).toEqual({ raw: 'ZZ', decoded: null });
  });
});

describe('decodeDischargeStatus', () => {
  it('decodes "still a patient"', () => {
    expect(decodeDischargeStatus('30')).toEqual({ raw: '30', decoded: 'Still a patient' });
  });

  it('decodes discharged to home', () => {
    expect(decodeDischargeStatus('01')).toEqual({ raw: '01', decoded: 'Discharged to home or self-care' });
  });

  it('passes through an unrecognized status with decoded: null', () => {
    expect(decodeDischargeStatus('96')).toEqual({ raw: '96', decoded: null });
  });
});

describe('decodeConditionCode', () => {
  it('decodes condition code 09', () => {
    expect(decodeConditionCode('09')).toEqual({ raw: '09', decoded: 'Neither patient nor spouse employed' });
  });

  it('passes through an unrecognized condition code with decoded: null', () => {
    expect(decodeConditionCode('A1')).toEqual({ raw: 'A1', decoded: null });
  });
});

describe('decodeOccurrenceCode', () => {
  it('decodes occurrence code 11 (onset of symptoms/illness)', () => {
    expect(decodeOccurrenceCode('11')).toEqual({ raw: '11', decoded: 'Onset of symptoms/illness' });
  });

  it('passes through an unrecognized occurrence code with decoded: null', () => {
    // Was 'A2' — a standard NUBC insured-designation code (effective date,
    // insured A policy) that the table simply had not been extended to
    // cover, so completing the table turned this red. '99' is unassigned in
    // every NUBC revision.
    expect(decodeOccurrenceCode('99')).toEqual({ raw: '99', decoded: null });
  });
});

describe('decodeValueCode', () => {
  it('decodes value code 80 (covered days)', () => {
    expect(decodeValueCode('80')).toEqual({ raw: '80', decoded: 'Covered days' });
  });

  it('passes through an unrecognized value code with decoded: null', () => {
    expect(decodeValueCode('X9')).toEqual({ raw: 'X9', decoded: null });
  });
});

describe('decodeTypeOfBill', () => {
  it('decodes the classic 4-digit UB-04 form (leading zero) — "0131": hospital, outpatient, admit through discharge', () => {
    const result = decodeTypeOfBill('0131');
    expect(result.raw).toBe('0131');
    expect(result.facilityType).toEqual({ raw: '1', decoded: 'Hospital' });
    expect(result.billClassification).toEqual({ raw: '3', decoded: 'Outpatient' });
    expect(result.frequency).toEqual({ raw: '1', decoded: 'Admit through discharge claim' });
    expect(result.combined).toBe('Hospital, Outpatient, Admit through discharge claim');
  });

  it('decodes the 3-digit X12 form (no leading zero) — "111": hospital, inpatient Part A, admit through discharge', () => {
    const result = decodeTypeOfBill('111');
    expect(result.facilityType).toEqual({ raw: '1', decoded: 'Hospital' });
    expect(result.billClassification).toEqual({ raw: '1', decoded: 'Inpatient (Part A)' });
    expect(result.frequency).toEqual({ raw: '1', decoded: 'Admit through discharge claim' });
    expect(result.combined).toBe('Hospital, Inpatient (Part A), Admit through discharge claim');
  });

  it('uses the clinic classification table for facility type 7', () => {
    const result = decodeTypeOfBill('711');
    expect(result.facilityType).toEqual({ raw: '7', decoded: 'Clinic or special facility' });
    expect(result.billClassification).toEqual({ raw: '1', decoded: 'Rural health clinic' });
  });

  it('uses the special-facility classification table for facility type 8', () => {
    expect(decodeTypeOfBill('831').billClassification).toEqual({ raw: '3', decoded: 'Ambulatory surgery center' });
  });

  it('returns decoded: null on every component and combined: null for a value that is not 3 or 4 characters', () => {
    const result = decodeTypeOfBill('1');
    expect(result.facilityType.decoded).toBeNull();
    expect(result.billClassification.decoded).toBeNull();
    expect(result.frequency.decoded).toBeNull();
    expect(result.combined).toBeNull();
  });

  it('returns combined: null for a blank raw value', () => {
    expect(decodeTypeOfBill('').combined).toBeNull();
  });

  it('passes through an unrecognized facility-type digit but still decodes the other components', () => {
    const result = decodeTypeOfBill('091');
    expect(result.facilityType).toEqual({ raw: '0', decoded: null });
    expect(result.billClassification).toEqual({ raw: '9', decoded: null });
    expect(result.frequency).toEqual({ raw: '1', decoded: 'Admit through discharge claim' });
    expect(result.combined).toBe('Admit through discharge claim');
  });
});
