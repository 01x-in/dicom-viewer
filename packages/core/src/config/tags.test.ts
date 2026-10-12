import { describe, expect, it } from 'vitest';
import { isSensitiveTag, resolveTag } from './tags';

describe('resolveTag', () => {
  it('knows the keywords of common tags', () => {
    expect(resolveTag('SeriesDescription')).toBe('0008103E');
    expect(resolveTag('KVP')).toBe('00180060');
    expect(resolveTag('PatientName')).toBe('00100010');
  });

  it('takes a tag as eight hex digits, or with a comma or brackets, and writes it in capitals', () => {
    expect(resolveTag('0008103e')).toBe('0008103E');
    expect(resolveTag('0008,103E')).toBe('0008103E');
    expect(resolveTag('(0008,103e)')).toBe('0008103E');
  });

  it('is undefined for what is neither', () => {
    expect(resolveTag('NoSuchKeyword')).toBeUndefined();
    expect(resolveTag('0008103')).toBeUndefined();
    expect(resolveTag('')).toBeUndefined();
    expect(resolveTag('seriesdescription')).toBeUndefined();
  });
});

describe('isSensitiveTag', () => {
  it.each([
    '00100010', // PatientName
    '00100020',
    '00100030',
    '00101010', // any other tag of group 0010
    '00109999',
    '00080050', // AccessionNumber
    '00080080', // InstitutionName
    '00080090', // ReferringPhysicianName
    '0008009C', // ConsultingPhysicianName
    '00081070', // OperatorsName
    '00200010', // StudyID
    '00080096', // ReferringPhysicianIdentificationSequence
    '0008009D', // ConsultingPhysicianIdentificationSequence
    '00081049', // PhysiciansOfRecordIdentificationSequence
    '00081052', // PerformingPhysicianIdentificationSequence
    '00081062', // PhysiciansReadingStudyIdentificationSequence
    '00081072', // OperatorIdentificationSequence
    '00321032', // RequestingPhysician: group 0032 is about the request
    '00380300', // CurrentPatientLocation: group 0038 is about the visit
    '00400006', // ScheduledPerformingPhysicianName: group 0040 is about the procedure
    '40080114', // PhysicianApprovingInterpretation: group 4008 is about the report
    '00091001', // a private tag: an odd group
    '7FE10010',
  ])('treats %s as one that can identify a patient', (tag) => {
    expect(isSensitiveTag(tag)).toBe(true);
  });

  it.each(['0008103E', '00080060', '00180060', '00200013', '00280010', '00080020'])(
    'does not treat %s as one',
    (tag) => {
      expect(isSensitiveTag(tag)).toBe(false);
    },
  );

  it('treats every keyword the table has for a patient tag as sensitive', () => {
    for (const keyword of [
      'PatientName',
      'PatientID',
      'PatientBirthDate',
      'PatientSex',
      'PatientAge',
      'AccessionNumber',
      'InstitutionName',
      'ReferringPhysicianName',
      'OperatorsName',
      'StudyID',
    ]) {
      const tag = resolveTag(keyword);
      expect(tag, keyword).toBeDefined();
      expect(isSensitiveTag(tag ?? ''), keyword).toBe(true);
    }
  });
});
