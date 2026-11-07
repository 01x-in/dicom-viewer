import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adaptersSR } from '@cornerstonejs/adapters';
import { metaData } from '@cornerstonejs/core';
import { data } from 'dcmjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { MeasurementType, Point3 } from '../measurements/model';
import {
  liftSiblingCoordinates,
  readReportReferences,
  readStructuredReport,
  shapesFromToolState,
} from './sr';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));
const IMAGE_ID = 'phantom:1';
const SPACING = 1.5;

function arrayBufferOf(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const ctBytes = arrayBufferOf(`${PHANTOM}/ct-evrle/0021.dcm`);
const ct = data.DicomMetaDictionary.naturalizeDataset(data.DicomMessage.readFile(ctBytes).dict);
const ctSchema = z.object({
  SOPInstanceUID: z.string(),
  SOPClassUID: z.string(),
  SeriesInstanceUID: z.string(),
  FrameOfReferenceUID: z.string(),
  ImagePositionPatient: z.tuple([z.coerce.number(), z.coerce.number(), z.coerce.number()]),
});
const ctInfo = ctSchema.parse(ct);

const plane = {
  frameOfReferenceUID: ctInfo.FrameOfReferenceUID,
  rows: 128,
  columns: 128,
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  rowCosines: [1, 0, 0],
  columnCosines: [0, 1, 0],
  imagePositionPatient: ctInfo.ImagePositionPatient,
  pixelSpacing: [SPACING, SPACING],
  rowPixelSpacing: SPACING,
  columnPixelSpacing: SPACING,
};

/** What Cornerstone would know about the one image the reports in these tests are drawn on. */
function provide(type: string, imageId: string): unknown {
  if (imageId !== IMAGE_ID) return undefined;
  if (type === 'imagePlaneModule') return plane;
  if (type === 'sopCommonModule') {
    return { sopInstanceUID: ctInfo.SOPInstanceUID, sopClassUID: ctInfo.SOPClassUID };
  }
  if (type === 'instance') return ct;
  if (type === 'frameNumber') return 1;
  return undefined;
}

/** A point on the image, from its column and row, in patient millimetres. */
function at(column: number, row: number): Point3 {
  const [x, y, z] = ctInfo.ImagePositionPatient;
  return [x + column * SPACING, y + row * SPACING, z];
}

interface WrittenShape {
  readonly tool: string;
  readonly points: readonly Point3[];
  readonly stats: Record<string, unknown>;
}

const reportSchema = z.object({ dataset: z.unknown() });

/** A report made by Cornerstone's own writer: what the reader is built to read. */
function writeReport(shapes: readonly WrittenShape[]): ArrayBuffer {
  const toolState: Record<string, Record<string, { data: unknown[] }>> = { [IMAGE_ID]: {} };
  for (const shape of shapes) {
    const tools = toolState[IMAGE_ID] ?? {};
    tools[shape.tool] ??= { data: [] };
    tools[shape.tool]?.data.push({
      data: {
        handles: { points: shape.points },
        cachedStats: { [`imageId:${IMAGE_ID}`]: shape.stats },
      },
      metadata: { referencedImageId: IMAGE_ID, FrameOfReferenceUID: ctInfo.FrameOfReferenceUID },
      finding: undefined,
      findingSites: [],
    });
  }
  const report: unknown = adaptersSR.Cornerstone3D.MeasurementReport.generateReport(
    toolState,
    { get: provide },
    { SeriesInstanceUID: '1.2.3', SOPInstanceUID: '1.2.3.4', SeriesNumber: 50 },
  );
  return data.datasetToDict(reportSchema.parse(report).dataset).write();
}

const imageIdBySop = new Map([[ctInfo.SOPInstanceUID, IMAGE_ID]]);

const providerPriority = 100;
const provider = (type: string, query: unknown): unknown =>
  typeof query === 'string' ? provide(type, query) : undefined;

beforeEach(() => {
  metaData.addProvider(provider, providerPriority);
});
afterEach(() => {
  metaData.removeProvider(provider);
});

function closeTo(actual: readonly Point3[], expected: readonly Point3[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [index, point] of expected.entries()) {
    for (const axis of [0, 1, 2] as const) {
      expect(actual[index]?.[axis]).toBeCloseTo(point[axis], 2);
    }
  }
}

describe('readStructuredReport', () => {
  it('reads each kind of shape Cornerstone writes, on the image it names', () => {
    const wrote: readonly (WrittenShape & { readonly type: MeasurementType })[] = [
      {
        tool: 'Length',
        type: 'length',
        points: [at(20, 30), at(60, 30)],
        stats: { length: 60, unit: 'mm' },
      },
      { tool: 'Probe', type: 'probe', points: [at(50, 50)], stats: { value: 100 } },
      {
        tool: 'Angle',
        type: 'angle',
        points: [at(20, 20), at(40, 40), at(70, 30)],
        stats: { angle: 40 },
      },
      {
        tool: 'Bidirectional',
        type: 'bidirectional',
        points: [at(30, 30), at(70, 30), at(50, 25), at(50, 35)],
        stats: { length: 60, width: 15, unit: 'mm', widthUnit: 'mm' },
      },
      {
        tool: 'EllipticalROI',
        type: 'ellipse',
        points: [at(64, 44), at(64, 84), at(54, 64), at(74, 64)],
        stats: { area: 100, areaUnit: 'mm2' },
      },
      {
        tool: 'RectangleROI',
        type: 'rectangle',
        points: [at(20, 20), at(60, 20), at(20, 50), at(60, 50)],
        stats: { area: 100, areaUnit: 'mm2', perimeter: 1 },
      },
    ];
    const read = readStructuredReport(writeReport(wrote), imageIdBySop);
    expect(read.unreadable).toBe(0);
    expect(read.unsupported).toEqual([]);
    expect(read.shapes).toHaveLength(wrote.length);
    for (const expected of wrote) {
      const shape = read.shapes.find((candidate) => candidate.type === expected.type);
      expect(shape?.sopInstanceUID).toBe(ctInfo.SOPInstanceUID);
      closeTo(shape?.points ?? [], expected.points);
    }
  });

  it('gives an ellipse its vertical axis first, whichever axis the report wrote first', () => {
    // The writer puts the longer axis first, so a wide ellipse is written horizontal axis first.
    const wide: readonly Point3[] = [at(34, 64), at(94, 64), at(64, 54), at(64, 74)];
    const read = readStructuredReport(
      writeReport([{ tool: 'EllipticalROI', points: wide, stats: { area: 100, areaUnit: 'mm2' } }]),
      imageIdBySop,
    );
    closeTo(read.shapes[0]?.points ?? [], [at(64, 54), at(64, 74), at(34, 64), at(94, 64)]);
  });

  it('counts a shape on an image it was not given as one it could not read', () => {
    const read = readStructuredReport(
      writeReport([
        { tool: 'Length', points: [at(20, 30), at(60, 30)], stats: { length: 60, unit: 'mm' } },
      ]),
      new Map(),
    );
    expect(read.shapes).toEqual([]);
    expect(read.unreadable).toBe(1);
  });

  it('refuses a file that is not a measurement report', () => {
    expect(() => readStructuredReport(ctBytes, imageIdBySop)).toThrow(/measurement report/i);
  });
});

describe('shapesFromToolState', () => {
  const entry = (
    sopInstanceUid: string,
    points: readonly Point3[],
    description?: string,
  ): unknown => ({
    sopInstanceUid,
    description,
    annotation: { data: { handles: { points } }, metadata: { referencedImageId: IMAGE_ID } },
  });

  it('keeps the finding of a shape as its label', () => {
    const { shapes } = shapesFromToolState(
      { Length: [entry('1.2.3', [at(0, 0), at(1, 1)], 'Tumor')] },
      () => undefined,
    );
    expect(shapes[0]?.label).toBe('Tumor');
  });

  it('names the kinds of shape the model has no place for', () => {
    const result = shapesFromToolState(
      {
        Length: [entry('1.2.3', [at(0, 0), at(1, 1)])],
        ArrowAnnotate: [entry('1.2.3', [at(0, 0), at(1, 1)]), entry('1.2.3', [at(2, 2), at(3, 3)])],
        PlanarFreehandROI: [entry('1.2.3', [at(0, 0), at(1, 1), at(2, 0)])],
      },
      () => undefined,
    );
    expect(result.shapes).toHaveLength(1);
    expect(result.unsupported).toEqual(['ArrowAnnotate', 'ArrowAnnotate', 'PlanarFreehandROI']);
  });

  it('counts a shape the model cannot hold as one it could not read', () => {
    const result = shapesFromToolState({ Length: [{ nonsense: true }] }, () => undefined);
    expect(result.shapes).toEqual([]);
    expect(result.unreadable).toBe(1);
  });
});

describe('liftSiblingCoordinates', () => {
  const coordinates = { ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 2, 3, 4] };
  const group = (items: unknown[]): unknown => ({
    ContentSequence: [
      {
        ConceptNameCodeSequence: { CodeMeaning: 'Imaging Measurements' },
        ContentSequence: [
          { ConceptNameCodeSequence: { CodeMeaning: 'Measurement Group' }, ContentSequence: items },
        ],
      },
    ],
  });

  it('moves a shape that sits beside a number into the number, where the reader looks', () => {
    const dataset = group([{ ValueType: 'NUM' }, coordinates]);
    liftSiblingCoordinates(dataset);
    const items = z
      .object({
        ContentSequence: z.array(
          z.object({
            ContentSequence: z.array(
              z.object({
                ContentSequence: z.array(
                  z.object({
                    ValueType: z.string(),
                    ContentSequence: z.array(z.unknown()).optional(),
                  }),
                ),
              }),
            ),
          }),
        ),
      })
      .parse(dataset).ContentSequence[0]?.ContentSequence[0]?.ContentSequence;
    expect(items?.find((item) => item.ValueType === 'NUM')?.ContentSequence).toEqual([coordinates]);
  });

  it('leaves a group alone when the shape is already inside the number', () => {
    const inside = { ValueType: 'NUM', ContentSequence: [coordinates] };
    const dataset = group([inside, coordinates]);
    liftSiblingCoordinates(dataset);
    expect(inside.ContentSequence).toEqual([coordinates]);
  });

  it('leaves a group that has no number alone', () => {
    const items = [coordinates];
    liftSiblingCoordinates(group(items));
    expect(items).toEqual([coordinates]);
  });
});

describe('readReportReferences', () => {
  it('names the series the report has as evidence', () => {
    const report = writeReport([
      { tool: 'Length', points: [at(20, 30), at(60, 30)], stats: { length: 60, unit: 'mm' } },
    ]);
    expect(readReportReferences(report)).toEqual([ctInfo.SeriesInstanceUID]);
  });

  it('refuses a file that is not a readable DICOM file, with a message that says so', () => {
    expect(() => readReportReferences(new ArrayBuffer(16))).toThrow(/not a readable DICOM file/);
  });

  it('refuses a DICOM file that is not a TID 1500 report', () => {
    expect(() => readReportReferences(ctBytes)).toThrow(/not a TID 1500 measurement report/);
  });
});
