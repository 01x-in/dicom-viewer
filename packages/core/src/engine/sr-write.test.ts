import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { metaData } from '@cornerstonejs/core';
import { data } from 'dcmjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DicomJsonInstance, SeriesInstance } from '../data/types';
import type { MeasurementType, Point3 } from '../measurements/model';
import type { SrWriteInput, SrWriteMeasurement } from '../measurements/sr-write';
import { readStructuredReport } from './sr';
import {
  isRecord,
  isUtf8,
  itemsOf,
  measurementGroups,
  meaningOf,
  repairUtf8,
  reportOf,
} from './sr-items';
import { COMPREHENSIVE_SR, dicomDateTime, uidFromText } from './sr-finish';
import { writeStructuredReport } from './sr-write';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));
const SPACING = 1.5;
const MADE_AT = new Date(Date.UTC(2026, 10, 8, 9, 14, 5));

function arrayBufferOf(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const ipSchema = z.object({
  SOPInstanceUID: z.string(),
  SOPClassUID: z.string(),
  SeriesInstanceUID: z.string(),
  StudyInstanceUID: z.string(),
  FrameOfReferenceUID: z.string(),
  ImagePositionPatient: z.tuple([z.coerce.number(), z.coerce.number(), z.coerce.number()]),
});

function load(
  file: string,
  imageId: string,
): { instance: SeriesInstance; info: z.infer<typeof ipSchema> } {
  const read = data.DicomMessage.readFile(arrayBufferOf(`${PHANTOM}/ct-evrle/${file}`));
  const info = ipSchema.parse(data.DicomMetaDictionary.naturalizeDataset(read.dict));
  // DICOM JSON without the pixels, as the viewer holds it.
  const metadata: Record<string, unknown> = { ...read.dict };
  delete metadata['7FE00010'];
  return {
    info,
    instance: {
      sopInstanceUID: info.SOPInstanceUID,
      instanceNumber: 1,
      imageId,
      metadata: metadata as DicomJsonInstance,
    },
  };
}

const fileMetaSchema = z.object({
  meta: z.record(z.string(), z.object({ Value: z.array(z.unknown()).optional() })),
});

const A = load('0021.dcm', 'phantom:A');
const B = load('0022.dcm', 'phantom:B');
const images = [A, B];

function planeOf(info: z.infer<typeof ipSchema>): unknown {
  return {
    frameOfReferenceUID: info.FrameOfReferenceUID,
    rows: 128,
    columns: 128,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    rowCosines: [1, 0, 0],
    columnCosines: [0, 1, 0],
    imagePositionPatient: info.ImagePositionPatient,
    pixelSpacing: [SPACING, SPACING],
    rowPixelSpacing: SPACING,
    columnPixelSpacing: SPACING,
  };
}

const provider = (type: string, query: unknown): unknown => {
  const image = images.find((candidate) => candidate.instance.imageId === query);
  if (image === undefined) return undefined;
  if (type === 'imagePlaneModule') return planeOf(image.info);
  return undefined;
};
const PRIORITY = 100;
beforeEach(() => {
  metaData.addProvider(provider, PRIORITY);
});
afterEach(() => {
  metaData.removeProvider(provider);
});

/** A point on an image, from its column and row, in patient millimetres. */
function at(image: number, column: number, row: number): Point3 {
  const [x, y, z] = (images[image] ?? A).info.ImagePositionPatient;
  return [x + column * SPACING, y + row * SPACING, z];
}

const sopOf = (image: number): string => (images[image] ?? A).info.SOPInstanceUID;

/** In an order that mixes the images and the kinds, as a list is. */
const LIST: readonly SrWriteMeasurement[] = [
  {
    id: 'm-probe',
    type: 'probe',
    points: [at(1, 50, 50)],
    label: 'Bone insert',
    sopInstanceUID: sopOf(1),
    values: { hu: 100 },
  },
  {
    id: 'm-length',
    type: 'length',
    points: [at(0, 20, 30), at(0, 60, 30)],
    label: 'Aorta',
    sopInstanceUID: sopOf(0),
    values: { lengthMm: 60 },
  },
  {
    id: 'm-ellipse',
    type: 'ellipse',
    points: [at(1, 64, 44), at(1, 64, 84), at(1, 54, 64), at(1, 74, 64)],
    sopInstanceUID: sopOf(1),
    values: { areaMm2: 100, meanHu: 12.5, stdDevHu: 3.1, minHu: -3, maxHu: 40 },
  },
  {
    id: 'm-angle',
    type: 'angle',
    points: [at(0, 20, 20), at(0, 40, 40), at(0, 70, 30)],
    sopInstanceUID: sopOf(0),
    values: { degrees: 40 },
  },
  {
    id: 'm-bi',
    type: 'bidirectional',
    points: [at(0, 30, 30), at(0, 70, 30), at(0, 50, 25), at(0, 50, 35)],
    label: 'Nodule',
    sopInstanceUID: sopOf(0),
    values: { lengthMm: 60, widthMm: 15 },
  },
  {
    id: 'm-rect',
    type: 'rectangle',
    points: [at(1, 20, 20), at(1, 60, 20), at(1, 20, 50), at(1, 60, 50)],
    sopInstanceUID: sopOf(1),
    values: { areaMm2: 100 },
  },
];

function inputOf(measurements: readonly SrWriteMeasurement[] = LIST): SrWriteInput {
  return {
    measurements,
    instances: images.map((image) => image.instance),
    seriesInstanceUID: '1.2.826.0.1.3680043.8.498.1',
    sopInstanceUID: '1.2.826.0.1.3680043.8.498.2',
    seriesDescription: 'Measurements',
    seriesNumber: 60,
    madeAt: MADE_AT,
  };
}

const imageIdBySop = new Map(
  images.map((image) => [image.info.SOPInstanceUID, image.instance.imageId]),
);

function naturalized(bytes: ArrayBuffer): Record<string, unknown> {
  const dataset: unknown = data.DicomMetaDictionary.naturalizeDataset(
    data.DicomMessage.readFile(bytes).dict,
  );
  if (!isRecord(dataset)) throw new Error('Not a dataset');
  // dcmjs reads text one byte to a character, so the way a reader must read it is part of the test.
  if (isUtf8(dataset)) repairUtf8(dataset);
  return dataset;
}

function group(dataset: Record<string, unknown>, at: number): Record<string, unknown> {
  const found = measurementGroups(dataset)[at];
  if (found === undefined) throw new Error(`No group ${at.toString()}`);
  return found;
}

const numbersOf = (g: Record<string, unknown>): Record<string, unknown>[] =>
  itemsOf(g['ContentSequence']).filter((item) => item['ValueType'] === 'NUM');

function closeTo(actual: readonly Point3[], expected: readonly Point3[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, point] of expected.entries()) {
    for (const axis of [0, 1, 2] as const) {
      expect(actual[index]?.[axis]).toBeCloseTo(point[axis], 2);
    }
  }
}

describe('writeStructuredReport', () => {
  it('writes all six kinds of shape, and the viewer reads them back: each on its image, in the order of the list, within 0.01 mm', () => {
    const bytes = writeStructuredReport(inputOf());
    const read = readStructuredReport(bytes, imageIdBySop);
    expect(read.unreadable).toBe(0);
    expect(read.unsupported).toEqual([]);
    expect(read.shapes.map((shape) => shape.position)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const [index, expected] of LIST.entries()) {
      const shape = read.shapes[index];
      expect(shape?.type).toBe(expected.type);
      expect(shape?.sopInstanceUID).toBe(expected.sopInstanceUID);
      closeTo(shape?.points ?? [], expected.points);
    }
  });

  it('gives an ellipse its vertical axis first on the way back, whichever axis it is longer on', () => {
    const wide: SrWriteMeasurement = {
      id: 'wide',
      type: 'ellipse',
      points: [at(0, 64, 54), at(0, 64, 74), at(0, 34, 64), at(0, 94, 64)],
      sopInstanceUID: sopOf(0),
      values: { areaMm2: 1 },
    };
    const read = readStructuredReport(writeStructuredReport(inputOf([wide])), imageIdBySop);
    closeTo(read.shapes[0]?.points ?? [], wide.points);
  });

  it('writes a header another tool can file: the Comprehensive SR class in the dataset and the file meta, the UIDs it was given, and the series', () => {
    const bytes = writeStructuredReport(inputOf());
    const parsed = fileMetaSchema.parse(data.DicomMessage.readFile(bytes));
    const dataset = naturalized(bytes);
    expect(dataset['SOPClassUID']).toBe(COMPREHENSIVE_SR);
    expect(parsed.meta['00020002']?.Value?.[0]).toBe(COMPREHENSIVE_SR);
    expect(parsed.meta['00020003']?.Value?.[0]).toBe('1.2.826.0.1.3680043.8.498.2');
    expect(dataset['SOPInstanceUID']).toBe('1.2.826.0.1.3680043.8.498.2');
    expect(dataset['SeriesInstanceUID']).toBe('1.2.826.0.1.3680043.8.498.1');
    expect(dataset['SeriesNumber']).toBe(60);
    expect(dataset['SeriesDescription']).toBe('Measurements');
    expect(dataset['Modality']).toBe('SR');
    expect(itemsOf(dataset['ContentTemplateSequence'])[0]?.['TemplateIdentifier']).toBe('1500');
  });

  it('is in the study of the images and names the same patient, as a PACS needs, and says so in its character set', () => {
    const dataset = naturalized(writeStructuredReport(inputOf()));
    expect(dataset['StudyInstanceUID']).toBe(A.info.StudyInstanceUID);
    expect(JSON.stringify(dataset['PatientName'])).toContain('Phantom');
    expect(dataset['PatientID']).toBe('PHANTOM-001');
    expect(dataset['SpecificCharacterSet']).toBe('ISO_IR 192');
  });

  it('has honest equipment and the time it was given, and none of the made-up values', () => {
    const dataset = naturalized(writeStructuredReport(inputOf()));
    expect(dataset['Manufacturer']).toBe('dicom-viewer');
    expect(dataset['ManufacturerModelName']).toBe('@01x/dicom-viewer-core');
    expect(dataset['SoftwareVersions']).toBeUndefined();
    expect(dataset['DeviceSerialNumber']).toBeUndefined();
    expect(dataset['ContentDate']).toBe('20261108');
    expect(dataset['ContentTime']).toBe('091405');
    expect(dataset['SeriesDate']).toBe('20261108');
    expect(dataset['SeriesTime']).toBe('091405');
  });

  it('lists the study once as evidence, with its series once and each image once', () => {
    const dataset = naturalized(writeStructuredReport(inputOf()));
    const evidence = itemsOf(dataset['CurrentRequestedProcedureEvidenceSequence']);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.['StudyInstanceUID']).toBe(A.info.StudyInstanceUID);
    const series = itemsOf(evidence[0]?.['ReferencedSeriesSequence']);
    expect(series).toHaveLength(1);
    const sops = itemsOf(series[0]?.['ReferencedSOPSequence']).map(
      (item) => item['ReferencedSOPInstanceUID'],
    );
    expect(sops.sort()).toEqual([A.info.SOPInstanceUID, B.info.SOPInstanceUID].sort());
  });

  it('gives a measurement the same tracking identifier in every export, and each its own', () => {
    const first = naturalized(writeStructuredReport(inputOf()));
    const second = naturalized(writeStructuredReport(inputOf()));
    const uids = (dataset: Record<string, unknown>): unknown[] =>
      measurementGroups(dataset).map(
        (g) =>
          itemsOf(g['ContentSequence']).find(
            (item) => meaningOf(item) === 'Tracking Unique Identifier',
          )?.['UID'],
      );
    expect(uids(first)).toEqual(uids(second));
    expect(new Set(uids(first)).size).toBe(LIST.length);
    // The first group is the first of the list, whichever image it is on.
    expect(uids(first)[0]).toBe(uidFromText('m-probe'));
    for (const uid of uids(first)) expect(String(uid)).toMatch(/^2\.25\.\d{1,39}$/);
  });

  it('writes a label as a short code and whole in a Comment, whatever its length or characters', () => {
    const long = `Aorte ascendante ${'é'.repeat(80)} 肺 結節`;
    const labelled = LIST.map((m) => (m.id === 'm-length' ? { ...m, label: long } : m));
    const dataset = naturalized(writeStructuredReport(inputOf(labelled)));
    const parts = itemsOf(group(dataset, 1)['ContentSequence']);
    const finding = parts.find((item) => meaningOf(item) === 'Finding');
    const code = itemsOf(finding?.['ConceptCodeSequence'])[0];
    expect(code?.['CodeValue']).toBe('LABEL');
    expect(code?.['CodingSchemeDesignator']).toBe('99DICOMVIEWER');
    expect(String(code?.['CodeMeaning'])).toHaveLength(64);
    expect(long.startsWith(String(code?.['CodeMeaning']))).toBe(true);
    const got = parts.find((item) => meaningOf(item) === 'Comment')?.['TextValue'];
    expect(got).toBe(long);
    // The unlabelled have neither.
    const plain = itemsOf(group(dataset, 2)['ContentSequence']);
    expect(plain.some((item) => meaningOf(item) === 'Finding')).toBe(false);
    expect(plain.some((item) => meaningOf(item) === 'Comment')).toBe(false);
  });

  it('is read back with its whole label, and the label of a short one', () => {
    const long = `Aorte ${'é'.repeat(100)}`;
    const labelled = LIST.map((m) => (m.id === 'm-length' ? { ...m, label: long } : m));
    const read = readStructuredReport(writeStructuredReport(inputOf(labelled)), imageIdBySop);
    expect(read.shapes[0]?.label).toBe('Bone insert');
    expect(read.shapes[1]?.label).toBe(long);
    expect(read.shapes[2]?.label).toBeUndefined();
    expect(read.shapes[4]?.label).toBe('Nodule');
  });

  it('writes a probe with its value in Hounsfield units, and leaves the number out when the viewer has none', () => {
    const dataset = naturalized(writeStructuredReport(inputOf()));
    const [number] = numbersOf(group(dataset, 0));
    const measured = itemsOf(number?.['MeasuredValueSequence'])[0];
    expect(measured?.['NumericValue']).toBe(100);
    expect(itemsOf(measured?.['MeasurementUnitsCodeSequence'])[0]?.['CodeValue']).toBe("[hnsf'U]");
    const without = LIST.map((m) => (m.id === 'm-probe' ? { ...m, values: {} } : m));
    const bare = naturalized(writeStructuredReport(inputOf(without)));
    expect(numbersOf(group(bare, 0))).toEqual([]);
  });

  it('writes the numbers of a region in Hounsfield units, and no number the viewer has not worked out', () => {
    const dataset = naturalized(writeStructuredReport(inputOf()));
    const units = numbersOf(group(dataset, 2)).map((number) => {
      const measured = itemsOf(number['MeasuredValueSequence'])[0];
      return [
        meaningOf(number),
        itemsOf(measured?.['MeasurementUnitsCodeSequence'])[0]?.['CodeValue'],
      ];
    });
    expect(Object.fromEntries(units)).toEqual({
      Area: 'mm2',
      Maximum: "[hnsf'U]",
      Minimum: "[hnsf'U]",
      Mean: "[hnsf'U]",
      'Standard Deviation': "[hnsf'U]",
    });
    // The rectangle had an area and nothing from the pixels.
    expect(numbersOf(group(dataset, 5)).map(meaningOf)).toEqual(['Area']);
  });

  it('puts a shape beside its number, as the standard does, and keeps the two of a bidirectional measurement inside theirs', () => {
    const dataset = naturalized(writeStructuredReport(inputOf()));
    // The length: an Image Region beside the number, its image named Source.
    const length = itemsOf(group(dataset, 1)['ContentSequence']);
    const region = length.find((item) => item['ValueType'] === 'SCOORD');
    expect(meaningOf(region ?? {})).toBe('Image Region');
    expect(region?.['RelationshipType']).toBe('CONTAINS');
    expect(meaningOf(itemsOf(region?.['ContentSequence'])[0] ?? {})).toBe('Source');
    const [number] = numbersOf(group(dataset, 1));
    expect(itemsOf(number?.['ContentSequence'])).toEqual([]);
    // The bidirectional measurement: one shape inside each of its numbers.
    const bidirectional = group(dataset, 4);
    expect(
      itemsOf(bidirectional['ContentSequence']).some((item) => item['ValueType'] === 'SCOORD'),
    ).toBe(false);
    for (const n of numbersOf(bidirectional)) {
      expect(itemsOf(n['ContentSequence']).some((item) => item['ValueType'] === 'SCOORD')).toBe(
        true,
      );
    }
  });

  it('keeps every value within the length its DICOM field allows', () => {
    const bytes = writeStructuredReport(
      inputOf(LIST.map((m) => ({ ...m, label: 'x'.repeat(200) }))),
    );
    const dataset = naturalized(bytes);
    const checked: string[] = [];
    const walk = (value: unknown): void => {
      for (const item of itemsOf(value)) {
        for (const [key, entry] of Object.entries(item)) {
          if (key === 'CodeValue' || key === 'CodingSchemeDesignator') {
            expect(String(entry).length).toBeLessThanOrEqual(16);
            checked.push(key);
          }
          if (key === 'CodeMeaning') expect(String(entry).length).toBeLessThanOrEqual(64);
          if (key === 'UID') expect(String(entry).length).toBeLessThanOrEqual(64);
          if (Array.isArray(entry) || isRecord(entry)) walk(entry);
        }
      }
    };
    walk(dataset['ContentSequence']);
    expect(checked.length).toBeGreaterThan(20);
    expect(reportOf(dataset)).toBeDefined();
  });

  it('refuses a measurement on an image it was not given', () => {
    const [, base] = LIST;
    if (base === undefined) throw new Error('No measurement');
    const lost: SrWriteMeasurement = {
      ...base,
      sopInstanceUID: '9.9.9',
    };
    expect(() => writeStructuredReport(inputOf([lost]))).toThrow(/image the report was not given/);
  });
});

describe('uidFromText and dicomDateTime', () => {
  it('make the same UID for the same text, a different one for another, and always a valid UID', () => {
    expect(uidFromText('a')).toBe(uidFromText('a'));
    expect(uidFromText('a')).not.toBe(uidFromText('b'));
    for (const text of ['', 'a', 'sr:1.2.3:4', 'é肺'.repeat(30)]) {
      expect(uidFromText(text)).toMatch(/^2\.25\.[1-9]\d{0,38}$/);
    }
  });

  it('write the time in UTC as DICOM does', () => {
    expect(dicomDateTime(new Date(Date.UTC(2026, 0, 5, 3, 4, 9)))).toEqual({
      date: '20260105',
      time: '030409',
    });
  });
});

export type { MeasurementType };
