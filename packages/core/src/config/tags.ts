/**
 * DICOM tags by keyword, for the tags a person would want on an overlay. Not the whole dictionary:
 * any other tag is written as eight hex digits, such as `00181030`.
 */
const KEYWORDS: Readonly<Record<string, string>> = {
  // Patient and study: these can identify someone (see `isSensitiveTag`).
  PatientName: '00100010',
  PatientID: '00100020',
  PatientBirthDate: '00100030',
  PatientSex: '00100040',
  PatientAge: '00101010',
  PatientSize: '00101020',
  PatientWeight: '00101030',
  AccessionNumber: '00080050',
  InstitutionName: '00080080',
  ReferringPhysicianName: '00080090',
  OperatorsName: '00081070',
  StudyID: '00200010',
  // What the picture is
  ImageType: '00080008',
  StudyDate: '00080020',
  SeriesDate: '00080021',
  AcquisitionDate: '00080022',
  ContentDate: '00080023',
  StudyTime: '00080030',
  SeriesTime: '00080031',
  AcquisitionTime: '00080032',
  Modality: '00080060',
  Manufacturer: '00080070',
  StudyDescription: '00081030',
  SeriesDescription: '0008103E',
  StationName: '00081010',
  ManufacturerModelName: '00081090',
  ContrastBolusAgent: '00180010',
  BodyPartExamined: '00180015',
  SliceThickness: '00180050',
  KVP: '00180060',
  RepetitionTime: '00180080',
  EchoTime: '00180081',
  MagneticFieldStrength: '00180087',
  SpacingBetweenSlices: '00180088',
  ProtocolName: '00181030',
  ExposureTime: '00181150',
  XRayTubeCurrent: '00181151',
  Exposure: '00181152',
  ConvolutionKernel: '00181210',
  PatientPosition: '00185100',
  SeriesNumber: '00200011',
  AcquisitionNumber: '00200012',
  InstanceNumber: '00200013',
  ImagePositionPatient: '00200032',
  SliceLocation: '00201041',
  Rows: '00280010',
  Columns: '00280011',
  PixelSpacing: '00280030',
  WindowCenter: '00281050',
  WindowWidth: '00281051',
  RescaleIntercept: '00281052',
  RescaleSlope: '00281053',
};

const HEX_TAG = /^\(?([0-9A-Fa-f]{4}),?([0-9A-Fa-f]{4})\)?$/;

/**
 * A tag as eight capital hex digits (`0008103E`), from a keyword, from eight hex digits, or from
 * `0008,103E` or `(0008,103E)`. `undefined` for anything else.
 */
export function resolveTag(spec: string): string | undefined {
  const known = Object.hasOwn(KEYWORDS, spec) ? KEYWORDS[spec] : undefined;
  if (known !== undefined) return known;
  const match = HEX_TAG.exec(spec);
  return match === null ? undefined : `${match[1] ?? ''}${match[2] ?? ''}`.toUpperCase();
}

/** Tags outside group 0010 that name a person or a place, as people read DICOM de-identification. */
const SENSITIVE = new Set([
  '00080050', // AccessionNumber
  '00080080', // InstitutionName
  '00080081', // InstitutionAddress
  '00080090', // ReferringPhysicianName
  '00080092', // ReferringPhysicianAddress
  '00080094', // ReferringPhysicianTelephoneNumbers
  '00080096', // ReferringPhysicianIdentificationSequence
  '0008009C', // ConsultingPhysicianName
  '0008009D', // ConsultingPhysicianIdentificationSequence
  '00081048', // PhysiciansOfRecord
  '00081049', // PhysiciansOfRecordIdentificationSequence
  '00081050', // PerformingPhysicianName
  '00081052', // PerformingPhysicianIdentificationSequence
  '00081060', // NameOfPhysiciansReadingStudy
  '00081062', // PhysiciansReadingStudyIdentificationSequence
  '00081070', // OperatorsName
  '00081072', // OperatorIdentificationSequence
  '00200010', // StudyID
]);

/**
 * Groups that are about the patient, the request, the visit, the procedure, or the report: names,
 * dates, and places, all of them.
 */
const SENSITIVE_GROUPS = new Set([0x0010, 0x0032, 0x0038, 0x0040, 0x4008]);

/**
 * Whether a tag (eight capital hex digits) can identify a patient: every tag of the groups about the
 * patient, the request, the visit, the procedure, and the report (0010, 0032, 0038, 0040, 4008), the
 * physicians, the institution, the accession number, and every private tag (an odd group), which
 * can hold anything. An overlay shows these only when it is asked to show patient information.
 */
export function isSensitiveTag(tag: string): boolean {
  const group = Number.parseInt(tag.slice(0, 4), 16);
  return SENSITIVE_GROUPS.has(group) || group % 2 === 1 || SENSITIVE.has(tag);
}
