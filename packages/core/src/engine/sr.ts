import { adaptersSR } from '@cornerstonejs/adapters';
import { metaData } from '@cornerstonejs/core';
import { data } from 'dcmjs';
import { z } from 'zod';
import { isDicomUid } from '../data/uid';
import type { MeasurementType, Point3 } from '../measurements/model';
import {
  type EllipsePoints,
  orderEllipseAxes,
  type SrRead,
  type SrShape,
} from '../measurements/sr';
import {
  isCoordinates,
  isRecord,
  isUtf8,
  itemsOf,
  measurementGroups,
  meaningOf,
  repairUtf8,
  reportOf,
  toArray,
} from './sr-items';

/** The reader's names for the shapes the model keeps. */
const TYPE_OF_TOOL: Readonly<Record<string, MeasurementType>> = {
  Length: 'length',
  Bidirectional: 'bidirectional',
  EllipticalROI: 'ellipse',
  RectangleROI: 'rectangle',
  Probe: 'probe',
  Angle: 'angle',
};

/**
 * The reader looks for a shape inside the number of a measurement group. The DICOM template, and
 * tools that follow it (highdicom), put the shape beside the number, and with a number there the
 * reader finds no shape and gives up on the group. This moves such a shape into the number. A
 * group that already has its shape inside, or has no number, is left as it is. So is a group with
 * more than one shape beside its numbers: which number a shape belongs to cannot be told, and the
 * reader fails on it, so it is counted as one it could not read.
 */
export function liftSiblingCoordinates(dataset: unknown): void {
  for (const group of measurementGroups(dataset)) {
    const items = itemsOf(group['ContentSequence']);
    const number = items.find((item) => item['ValueType'] === 'NUM');
    const beside = items.filter(isCoordinates);
    if (number === undefined || beside.length !== 1) continue;
    const inside = itemsOf(number['ContentSequence']);
    if (inside.some(isCoordinates)) continue;
    number['ContentSequence'] = [...inside, ...beside];
  }
}

/** The text of the Comment in a measurement group: where a label is written whole. */
function commentOf(group: Record<string, unknown>): string | undefined {
  for (const item of itemsOf(group['ContentSequence'])) {
    if (item['ValueType'] === 'TEXT' && meaningOf(item) === 'Comment') {
      const text = item['TextValue'];
      if (typeof text === 'string' && text !== '') return text;
    }
  }
  return undefined;
}

const finite = z.number();
const point = z.tuple([finite, finite, finite]);

const entrySchema = z.object({
  sopInstanceUid: z.string(),
  // The finding the report names the shape by. It is no use to the model if it is not text.
  description: z.string().optional().catch(undefined),
  annotation: z.object({
    data: z.object({ handles: z.object({ points: z.array(point) }) }),
    metadata: z.object({ referencedImageId: z.string() }),
  }),
});

const toolStateSchema = z.record(z.string(), z.array(z.unknown()));

/**
 * Turns the reader's result, which is typed `any`, into shapes. `columnOf` gives the direction of
 * increasing row of an image (down the picture), which says which axis of an ellipse is vertical.
 * `position` is the place of the measurement group in the report, which every shape gets.
 */
export function shapesFromToolState(
  toolState: unknown,
  columnOf: (imageId: string) => Point3 | undefined,
  position: number,
): SrRead {
  const shapes: SrShape[] = [];
  const unsupported: string[] = [];
  let unreadable = 0;
  for (const [tool, entries] of Object.entries(toolStateSchema.parse(toolState))) {
    const type = TYPE_OF_TOOL[tool];
    for (const entry of entries) {
      if (type === undefined) {
        unsupported.push(tool);
        continue;
      }
      const parsed = entrySchema.safeParse(entry);
      if (!parsed.success) {
        unreadable += 1;
        continue;
      }
      const { sopInstanceUid, description, annotation } = parsed.data;
      const column = columnOf(annotation.metadata.referencedImageId);
      const points = annotation.data.handles.points;
      const [first, second, third, fourth] = points;
      shapes.push({
        type,
        points:
          type === 'ellipse' &&
          points.length === 4 &&
          column !== undefined &&
          first !== undefined &&
          second !== undefined &&
          third !== undefined &&
          fourth !== undefined
            ? orderEllipseAxes([first, second, third, fourth] satisfies EllipsePoints, column)
            : points,
        label: description,
        sopInstanceUID: sopInstanceUid,
        position,
      });
    }
  }
  return { shapes, unreadable, unsupported };
}

const planeSchema = z.object({ columnCosines: z.tuple([finite, finite, finite]) });

function columnOfImage(imageId: string): Point3 | undefined {
  const plane: unknown = metaData.get('imagePlaneModule', imageId);
  const parsed = planeSchema.safeParse(plane);
  return parsed.success ? parsed.data.columnCosines : undefined;
}

const adapterMetadata = {
  get(type: string, imageId: string): unknown {
    return metaData.get(type, imageId);
  },
};

const NOT_TID_1500 = 'This is not a TID 1500 measurement report, the only kind the viewer reads.';

/** The report as named fields. Throws for a file that is not DICOM, or not a TID 1500 report. */
function naturalizedReport(bytes: ArrayBuffer): Record<string, unknown> {
  let dataset: unknown;
  try {
    dataset = data.DicomMetaDictionary.naturalizeDataset(data.DicomMessage.readFile(bytes).dict);
  } catch {
    throw new Error('The report is not a readable DICOM file.');
  }
  if (!isRecord(dataset)) throw new Error(NOT_TID_1500);
  const template = itemsOf(dataset['ContentTemplateSequence'])[0]?.['TemplateIdentifier'];
  if (template !== '1500') throw new Error(NOT_TID_1500);
  if (isUtf8(dataset)) repairUtf8(dataset);
  return dataset;
}

/**
 * The series the report says its shapes are on: those of its evidence. Only well-formed UIDs are
 * returned, as they go into a request path.
 */
export function readReportReferences(bytes: ArrayBuffer): readonly string[] {
  const dataset = naturalizedReport(bytes);
  const found = new Set<string>();
  for (const evidence of itemsOf(dataset['CurrentRequestedProcedureEvidenceSequence'])) {
    for (const series of itemsOf(evidence['ReferencedSeriesSequence'])) {
      const uid = series['SeriesInstanceUID'];
      if (typeof uid === 'string' && isDicomUid(uid)) found.add(uid);
    }
  }
  return [...found];
}

/**
 * Reads the shapes of a TID 1500 measurement report. `imageIdBySop` holds the images the report may
 * refer to, and Cornerstone must already know their metadata: the reader turns pixel positions
 * into patient millimetres with it. A shape on any other image is counted as unreadable. Throws
 * for a file that is not a TID 1500 report.
 */
export function readStructuredReport(
  bytes: ArrayBuffer,
  imageIdBySop: ReadonlyMap<string, string>,
): SrRead {
  const dataset = naturalizedReport(bytes);
  const groups = measurementGroups(dataset);
  const report = reportOf(dataset);
  liftSiblingCoordinates(dataset);

  // The reader looks an image up by its SOP instance and frame. Single-frame images are frame 1.
  const imageIds: Record<string, string> = {};
  for (const [sopInstanceUID, imageId] of imageIdBySop) imageIds[`${sopInstanceUID}:1`] = imageId;

  // One group at a time. The reader gives its shapes by kind, not in the order of the report, and
  // drops a group it fails on with only a log line. Alone, a group has its place in the report, and
  // one that gave nothing back is known to have failed.
  const shapes: SrShape[] = [];
  const unsupported: string[] = [];
  let unreadable = 0;
  for (const [position, group] of groups.entries()) {
    const alone = {
      ...dataset,
      ContentSequence: itemsOf(dataset['ContentSequence']).map((item) =>
        item === report ? { ...item, ContentSequence: [group] } : item,
      ),
    };
    let read: SrRead | undefined;
    try {
      const toolState: unknown = adaptersSR.Cornerstone3D.MeasurementReport.generateToolState(
        alone,
        imageIds,
        adapterMetadata,
        undefined,
      );
      read = shapesFromToolState(toolState, columnOfImage, position);
    } catch {
      read = undefined;
    }
    if (
      read === undefined ||
      read.shapes.length + read.unsupported.length + read.unreadable === 0
    ) {
      unreadable += 1;
      continue;
    }
    // A label longer than a code can hold is written whole as a Comment. It is the better source.
    const label = commentOf(group);
    shapes.push(
      ...(label === undefined ? read.shapes : read.shapes.map((shape) => ({ ...shape, label }))),
    );
    unsupported.push(...read.unsupported);
    unreadable += read.unreadable;
  }
  return { shapes, unreadable, unsupported };
}
