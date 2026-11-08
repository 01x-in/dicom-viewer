import type { MeasurementType } from '../measurements/model';
import type { SrWriteMeasurement } from '../measurements/sr-write';
import {
  GROUP_MEANING,
  isCoordinates,
  isRecord,
  itemsOf,
  measurementGroups,
  meaningOf,
  reportOf,
} from './sr-items';

/** The Comprehensive SR class. Cornerstone's writer says Enhanced SR, which TID 1500 does not list. */
export const COMPREHENSIVE_SR = '1.2.840.10008.5.1.4.1.1.88.33';

/** The code a label is filed under: short enough for its field (16 characters), and local to this viewer. */
export const LABEL_CODE = { value: 'LABEL', scheme: '99DICOMVIEWER' } as const;

/** The meaning of a code is at most 64 characters. The whole label goes in a Comment. */
export const MAX_CODE_MEANING = 64;

const MANUFACTURER = 'dicom-viewer';
const MODEL = '@01x/dicom-viewer-core';

function code(value: string, scheme: string, meaning: string): Record<string, unknown> {
  return { CodeValue: value, CodingSchemeDesignator: scheme, CodeMeaning: meaning };
}

function two(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `YYYYMMDD` and `HHMMSS` in UTC. */
export function dicomDateTime(date: Date): { readonly date: string; readonly time: string } {
  return {
    date: `${date.getUTCFullYear().toString().padStart(4, '0')}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}`,
    time: `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}`,
  };
}

/**
 * A UID that is the same for the same text every time: `2.25.` and 128 bits as a decimal number
 * (cyrb128, which needs no crypto and gives the same answer in every runtime). A measurement id
 * becomes its tracking unique identifier, so the same measurement has the same one in each export.
 */
export function uidFromText(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let at = 0; at < text.length; at += 1) {
    const k = text.charCodeAt(at);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const parts = [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  const value = parts.reduce((total, part) => (total << 32n) + BigInt(part), 0n);
  return `2.25.${value.toString()}`;
}

/** One evidence entry for the study, with each series once and each image once. */
function mergeEvidence(dataset: Record<string, unknown>): void {
  const studies = new Map<string, Map<string, Map<string, Record<string, unknown>>>>();
  for (const evidence of itemsOf(dataset['CurrentRequestedProcedureEvidenceSequence'])) {
    const study = String(evidence['StudyInstanceUID']);
    for (const series of itemsOf(evidence['ReferencedSeriesSequence'])) {
      const seriesUid = String(series['SeriesInstanceUID']);
      for (const image of itemsOf(series['ReferencedSOPSequence'])) {
        const inStudy =
          studies.get(study) ?? new Map<string, Map<string, Record<string, unknown>>>();
        const inSeries = inStudy.get(seriesUid) ?? new Map<string, Record<string, unknown>>();
        inSeries.set(String(image['ReferencedSOPInstanceUID']), image);
        inStudy.set(seriesUid, inSeries);
        studies.set(study, inStudy);
      }
    }
  }
  dataset['CurrentRequestedProcedureEvidenceSequence'] = [...studies].map(
    ([StudyInstanceUID, series]) => ({
      StudyInstanceUID,
      ReferencedSeriesSequence: [...series].map(([SeriesInstanceUID, images]) => ({
        SeriesInstanceUID,
        ReferencedSOPSequence: [...images.values()],
      })),
    }),
  );
}

function setProbeValue(group: Record<string, unknown>, hu: number | undefined): void {
  const content = itemsOf(group['ContentSequence']);
  const number = content.find((item) => item['ValueType'] === 'NUM');
  if (number === undefined) return;
  if (hu === undefined || !Number.isFinite(hu)) {
    // The writer puts a placeholder 0 with the unit 1 here. No value is better than a wrong one.
    group['ContentSequence'] = content.filter((item) => item !== number);
    return;
  }
  const measured = itemsOf(number['MeasuredValueSequence'])[0];
  if (measured === undefined) return;
  measured['NumericValue'] = hu;
  measured['MeasurementUnitsCodeSequence'] = code("[hnsf'U]", 'UCUM', 'Hounsfield unit');
}

/**
 * The standard puts a measurement's shape beside its number, as an Image Region. Cornerstone's
 * writer puts it inside the number. Moves it beside, for a group with one shape. A group with two
 * (a bidirectional measurement has a shape for each axis) is left as it is: there is no one place
 * for them, and the reader reads it that way.
 */
function liftShape(group: Record<string, unknown>): void {
  const numbers = itemsOf(group['ContentSequence']).filter((item) => item['ValueType'] === 'NUM');
  const shapes = numbers.flatMap((number) =>
    itemsOf(number['ContentSequence']).filter(isCoordinates),
  );
  const [shape] = shapes;
  if (shapes.length !== 1 || shape === undefined) return;
  for (const number of numbers) {
    number['ContentSequence'] = itemsOf(number['ContentSequence']).filter((item) => item !== shape);
  }
  shape['RelationshipType'] = 'CONTAINS';
  shape['ConceptNameCodeSequence'] = code('111030', 'DCM', 'Image Region');
  for (const image of itemsOf(shape['ContentSequence'])) {
    image['RelationshipType'] = 'SELECTED FROM';
    image['ConceptNameCodeSequence'] = code('260753009', 'SCT', 'Source');
  }
  group['ContentSequence'] = [...itemsOf(group['ContentSequence']), shape];
}

export interface FinishInput {
  /** The measurements, in the order the writer made their groups. */
  readonly written: readonly SrWriteMeasurement[];
  /** The ids in the order of the list, which is the order of the report. */
  readonly listOrder: readonly string[];
  readonly madeAt: Date;
}

/**
 * Everything the spike found wrong in what Cornerstone's writer makes, mended in one place and
 * with no Cornerstone code: the class, the character set, the equipment, the clock, the evidence,
 * and for each group its tracking identifier, label, probe value, shape place, and order. The
 * dataset is changed. Throws when the writer made another number of groups than was asked for.
 */
export function finishReport(dataset: Record<string, unknown>, input: FinishInput): void {
  const { date, time } = dicomDateTime(input.madeAt);
  dataset['SOPClassUID'] = COMPREHENSIVE_SR;
  const meta = dataset['_meta'];
  if (isRecord(meta)) {
    const sopClass = meta['MediaStorageSOPClassUID'];
    if (isRecord(sopClass)) sopClass['Value'] = [COMPREHENSIVE_SR];
    const sopInstance = meta['MediaStorageSOPInstanceUID'];
    if (isRecord(sopInstance)) sopInstance['Value'] = [dataset['SOPInstanceUID']];
  }
  dataset['SpecificCharacterSet'] = 'ISO_IR 192';
  dataset['Manufacturer'] = MANUFACTURER;
  dataset['ManufacturerModelName'] = MODEL;
  // The writer fills these with made-up values (`0` and `1`). They are optional, so they are left out.
  delete dataset['SoftwareVersions'];
  delete dataset['DeviceSerialNumber'];
  dataset['ContentDate'] = date;
  dataset['ContentTime'] = time;
  dataset['SeriesDate'] = date;
  dataset['SeriesTime'] = time;
  mergeEvidence(dataset);

  const report = reportOf(dataset);
  const groups = measurementGroups(dataset);
  if (report === undefined || groups.length !== input.written.length) {
    throw new Error(
      'The report writer made a different number of measurements than was asked for.',
    );
  }
  const made: [string, Record<string, unknown>][] = [];
  for (const [at, group] of groups.entries()) {
    const measurement = input.written[at];
    if (measurement === undefined) continue;
    const parts = itemsOf(group['ContentSequence']);
    // The same measurement has the same identifier in every export.
    const identifier = parts.find((item) => meaningOf(item) === 'Tracking Unique Identifier');
    if (identifier !== undefined) identifier['UID'] = uidFromText(measurement.id);
    // The whole label as a Comment, which has no limit; the Finding holds the first 64 characters.
    if (measurement.label !== undefined && measurement.label !== '') {
      group['ContentSequence'] = [
        ...itemsOf(group['ContentSequence']),
        {
          RelationshipType: 'CONTAINS',
          ValueType: 'TEXT',
          ConceptNameCodeSequence: code('121106', 'DCM', 'Comment'),
          TextValue: measurement.label,
        },
      ];
    }
    if (measurement.type === 'probe') setProbeValue(group, measurement.values.hu);
    liftShape(group);
    made.push([measurement.id, group]);
  }
  // The writer groups by image and by kind of shape. The report is in the order of the list.
  const rank = new Map(input.listOrder.map((id, at) => [id, at]));
  made.sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0));
  report['ContentSequence'] = [
    ...itemsOf(report['ContentSequence']).filter((item) => meaningOf(item) !== GROUP_MEANING),
    ...made.map(([, group]) => group),
  ];
}

/** The label as a Finding: a short code, and the first 64 characters as its meaning. */
export function labelFinding(label: string): Record<string, string> {
  return {
    CodeValue: LABEL_CODE.value,
    CodingSchemeDesignator: LABEL_CODE.scheme,
    // Characters, not UTF-16 units: a character outside the first plane is one.
    CodeMeaning: Array.from(label).slice(0, MAX_CODE_MEANING).join(''),
  };
}

/** The kinds of shape the writer is given, by the model's name. */
export const TOOL_OF_TYPE: Readonly<Record<MeasurementType, string>> = {
  length: 'Length',
  bidirectional: 'Bidirectional',
  ellipse: 'EllipticalROI',
  rectangle: 'RectangleROI',
  probe: 'Probe',
  angle: 'Angle',
};
