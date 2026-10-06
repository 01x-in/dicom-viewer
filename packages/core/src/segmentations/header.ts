import { z } from 'zod';
import { isDicomUid } from '../data/uid';
import type { Point3 } from '../measurements/model';

/** A colour as red, green, and blue, each 0 to 255. */
export type Rgb = readonly [number, number, number];

/** What a SEG says about one of its segments. */
export interface SegmentHeader {
  readonly number: number;
  readonly label: string;
  /** The colour the SEG recommends, if it has one. */
  readonly color?: Rgb | undefined;
  readonly description?: string | undefined;
}

/** What a SEG says about one of its frames. */
export interface FrameHeader {
  readonly segmentNumber?: number | undefined;
  /** The image this frame is derived from. */
  readonly referencedSopInstanceUID?: string | undefined;
  /** Where the frame's first pixel is, in patient millimetres. */
  readonly position?: Point3 | undefined;
}

/** What a SEG says about itself and about the images it segments, read before any pixel is. */
export interface SegmentationHeader {
  readonly sopInstanceUID: string;
  readonly seriesInstanceUID: string;
  readonly studyInstanceUID: string;
  readonly seriesDescription?: string | undefined;
  readonly frameOfReferenceUID?: string | undefined;
  readonly rows: number;
  readonly columns: number;
  readonly segments: readonly SegmentHeader[];
  /** The series the SEG segments. */
  readonly referencedSeriesInstanceUID?: string | undefined;
  /** The instances the SEG says it segments, in the order it lists them. */
  readonly referencedSopInstanceUIDs: readonly string[];
  /** One for each frame of the SEG, in order. */
  readonly frames: readonly FrameHeader[];
  /** How the rows and columns lie in patient space, if the SEG says it for all its frames. */
  readonly orientation?: readonly [number, number, number, number, number, number] | undefined;
  /** Millimetres between rows, then between columns, if the SEG says. */
  readonly pixelSpacing?: readonly [number, number] | undefined;
}

const uid = z.string().refine(isDicomUid, 'Not a DICOM UID');
const finite = z.number();
const point = z.tuple([finite, finite, finite]);
const channel = z.number().int().min(0).max(255);

const segmentSchema: z.ZodType<SegmentHeader> = z.object({
  number: z.number().int().min(1).max(65535),
  label: z.string(),
  color: z.tuple([channel, channel, channel]).optional(),
  description: z.string().optional(),
});

const frameSchema: z.ZodType<FrameHeader> = z.object({
  segmentNumber: z.number().int().min(1).optional(),
  referencedSopInstanceUID: uid.optional(),
  position: point.optional(),
});

export const segmentationHeaderSchema: z.ZodType<SegmentationHeader> = z.object({
  sopInstanceUID: uid,
  seriesInstanceUID: uid,
  studyInstanceUID: uid,
  seriesDescription: z.string().optional(),
  frameOfReferenceUID: uid.optional(),
  rows: z.number().int().min(1),
  columns: z.number().int().min(1),
  segments: z.array(segmentSchema).min(1, 'The SEG has no segments.'),
  referencedSeriesInstanceUID: uid.optional(),
  referencedSopInstanceUIDs: z.array(uid),
  frames: z.array(frameSchema),
  orientation: z.tuple([finite, finite, finite, finite, finite, finite]).optional(),
  pixelSpacing: z.tuple([finite, finite]).optional(),
});

/** Checks what was read from a SEG file. Throws an `Error` that says what is wrong. */
export function parseSegmentationHeader(raw: unknown): SegmentationHeader {
  const parsed = segmentationHeaderSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`The SEG is not readable: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// DICOM PS3.3 C.10.7.1.1: three unsigned 16-bit values for L*, a*, b*, against the D50 white point.
const D50_WHITE: Point3 = [0.9642, 1, 0.8249];
// XYZ (D50) to linear sRGB, with the Bradford adaptation (Bruce Lindbloom).
const XYZ_D50_TO_LINEAR_SRGB: readonly (readonly [number, number, number])[] = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.033454],
  [0.0719453, -0.2289914, 1.4052427],
];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

function labToXyz(l: number, a: number, b: number): Point3 {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const cube = (value: number): number => value ** 3;
  const xr = cube(fx) > EPSILON ? cube(fx) : (116 * fx - 16) / KAPPA;
  const yr = l > KAPPA * EPSILON ? cube(fy) : l / KAPPA;
  const zr = cube(fz) > EPSILON ? cube(fz) : (116 * fz - 16) / KAPPA;
  return [xr * D50_WHITE[0], yr * D50_WHITE[1], zr * D50_WHITE[2]];
}

function gamma(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/**
 * The sRGB colour for a `RecommendedDisplayCIELabValue` of a segment: three unsigned 16-bit
 * numbers. `undefined` when it is not three numbers in range.
 */
export function cielabToRgb(values: readonly number[]): Rgb | undefined {
  const [rawL, rawA, rawB] = values;
  if (values.length !== 3 || rawL === undefined || rawA === undefined || rawB === undefined) {
    return undefined;
  }
  if (
    ![rawL, rawA, rawB].every((value) => Number.isInteger(value) && value >= 0 && value <= 65535)
  ) {
    return undefined;
  }
  const xyz = labToXyz(
    (rawL * 100) / 65535,
    (rawA * 255) / 65535 - 128,
    (rawB * 255) / 65535 - 128,
  );
  const [red, green, blue] = XYZ_D50_TO_LINEAR_SRGB.map((row) =>
    gamma(row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]),
  );
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  return [Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255)];
}
