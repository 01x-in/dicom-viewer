import { z } from 'zod';
import { isDicomUid } from '../data/uid';

/** A point in patient space: millimetres in DICOM's LPS axes, the space the images' positions are in. */
export type Point3 = readonly [number, number, number];

export const MEASUREMENT_TYPES = [
  'length',
  'bidirectional',
  'ellipse',
  'rectangle',
  'probe',
  'angle',
] as const;

export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

/** The image a measurement was made on. */
export interface MeasurementReference {
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
  readonly sopInstanceUID: string;
  readonly frameOfReferenceUID?: string | undefined;
}

/** What the pixels inside an ellipse or a rectangle add up to. Hounsfield units, as the images store them. */
export interface RoiStats {
  /** Pixels whose centre is inside the shape. */
  readonly pixelCount: number;
  readonly meanHu: number;
  readonly stdDevHu: number;
  readonly minHu: number;
  readonly maxHu: number;
}

interface MeasurementBase {
  /** Unique within a viewer. Made by the viewer, or taken from an import. */
  readonly id: string;
  /** The name a person gave it. */
  readonly label?: string | undefined;
  readonly reference: MeasurementReference;
}

export interface LengthMeasurement extends MeasurementBase {
  readonly type: 'length';
  readonly points: readonly [Point3, Point3];
}

export interface BidirectionalMeasurement extends MeasurementBase {
  readonly type: 'bidirectional';
  /** The two ends of the first axis, then the two ends of the second. The longer axis is the length. */
  readonly points: readonly [Point3, Point3, Point3, Point3];
}

export interface EllipseMeasurement extends MeasurementBase {
  readonly type: 'ellipse';
  /** The ends of the vertical axis, then the ends of the horizontal axis, as Cornerstone keeps them. */
  readonly points: readonly [Point3, Point3, Point3, Point3];
  readonly stats?: RoiStats | undefined;
}

export interface RectangleMeasurement extends MeasurementBase {
  readonly type: 'rectangle';
  /** One corner, the corner along the width, the corner along the height, then the opposite corner. */
  readonly points: readonly [Point3, Point3, Point3, Point3];
  readonly stats?: RoiStats | undefined;
}

export interface ProbeMeasurement extends MeasurementBase {
  readonly type: 'probe';
  readonly points: readonly [Point3];
  /** The value of the pixel the point is in. */
  readonly hu?: number | undefined;
}

export interface AngleMeasurement extends MeasurementBase {
  readonly type: 'angle';
  /** The end of the first arm, the vertex, and the end of the second arm. */
  readonly points: readonly [Point3, Point3, Point3];
}

export type Measurement =
  | LengthMeasurement
  | BidirectionalMeasurement
  | EllipseMeasurement
  | RectangleMeasurement
  | ProbeMeasurement
  | AngleMeasurement;

export const MEASUREMENTS_FORMAT = 'measurements/v1';

/** What `exportJson` returns and `importJson` reads. Plain data, so `JSON.stringify` works on it. */
export interface MeasurementsDocumentV1 {
  readonly format: typeof MEASUREMENTS_FORMAT;
  readonly measurements: readonly Measurement[];
}

export const MAX_LABEL_LENGTH = 200;

const uid = z.string().refine(isDicomUid, 'Not a DICOM UID');
// Zod 4 numbers are finite already: NaN and the infinities are refused.
const finite = z.number();
const point = z.tuple([finite, finite, finite]);

const referenceSchema: z.ZodType<MeasurementReference> = z.object({
  studyInstanceUID: uid,
  seriesInstanceUID: uid,
  sopInstanceUID: uid,
  frameOfReferenceUID: uid.optional(),
});

const roiStatsSchema: z.ZodType<RoiStats> = z.object({
  // A statistic is of at least one pixel: a shape with none has no statistics at all.
  pixelCount: z.number().int().min(1),
  meanHu: finite,
  stdDevHu: finite.min(0),
  minHu: finite,
  maxHu: finite,
});

const base = {
  id: z.string().min(1).max(128),
  // An empty name is no name.
  label: z
    .string()
    .trim()
    .max(MAX_LABEL_LENGTH)
    .optional()
    .transform((label) => (label === '' ? undefined : label)),
  reference: referenceSchema,
};

export const measurementSchema: z.ZodType<Measurement> = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('length'),
    points: z.tuple([point, point]),
  }),
  z.object({
    ...base,
    type: z.literal('bidirectional'),
    points: z.tuple([point, point, point, point]),
  }),
  z.object({
    ...base,
    type: z.literal('ellipse'),
    points: z.tuple([point, point, point, point]),
    stats: roiStatsSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('rectangle'),
    points: z.tuple([point, point, point, point]),
    stats: roiStatsSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('probe'),
    points: z.tuple([point]),
    hu: finite.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('angle'),
    points: z.tuple([point, point, point]),
  }),
]);

// The values a reader of the file may find next to a measurement are derived, and are worked out
// again on import, so the schema does not ask for them and drops them.
export const measurementsDocumentSchema: z.ZodType<MeasurementsDocumentV1> = z
  .object({
    format: z.literal(MEASUREMENTS_FORMAT),
    measurements: z.array(measurementSchema).max(10_000),
  })
  .refine(
    (document) =>
      new Set(document.measurements.map((measurement) => measurement.id)).size ===
      document.measurements.length,
    { message: 'Measurement ids must be unique' },
  );

export type MeasurementParseResult =
  | { readonly ok: true; readonly measurements: readonly Measurement[] }
  | { readonly ok: false; readonly error: string };

/** Validates a document from a file or a host. Never throws. Accepts the document, or its JSON text. */
export function parseMeasurementsDocument(input: unknown): MeasurementParseResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, error: 'The measurements are not valid JSON.' };
    }
  }
  const parsed = measurementsDocumentSchema.safeParse(value);
  if (parsed.success) return { ok: true, measurements: parsed.data.measurements };
  return { ok: false, error: z.prettifyError(parsed.error) };
}

/** Validates one measurement, for `add`. Never throws. */
export function parseMeasurement(
  input: unknown,
):
  | { readonly ok: true; readonly measurement: Measurement }
  | { readonly ok: false; readonly error: string } {
  const parsed = measurementSchema.safeParse(input);
  if (parsed.success) return { ok: true, measurement: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error) };
}

export function isMeasurementType(value: unknown): value is MeasurementType {
  return MEASUREMENT_TYPES.some((type) => type === value);
}
