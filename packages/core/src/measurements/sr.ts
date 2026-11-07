import {
  type Measurement,
  type MeasurementReference,
  type MeasurementType,
  type Point3,
  parseMeasurement,
} from './model';

/** A shape read from a Structured Report: millimetres in patient space, on one image. */
export interface SrShape {
  readonly type: MeasurementType;
  readonly points: readonly Point3[];
  readonly label?: string | undefined;
  /** The image the shape is drawn on. */
  readonly sopInstanceUID: string;
  /** The place of its measurement group in the report, whatever the others did. It makes the id. */
  readonly position: number;
}

/** What the engine made of a report: the shapes it read, and what it could not. */
export interface SrRead {
  readonly shapes: readonly SrShape[];
  /** Measurement groups the reader failed on, or had no reader for. */
  readonly unreadable: number;
  /** The reader's names for shapes of a kind the model has no place for, one for each shape. */
  readonly unsupported: readonly string[];
}

export interface SrSkip {
  readonly reason: string;
  readonly count: number;
}

export interface SrMapInput {
  readonly srSopInstanceUID: string;
  readonly shapes: readonly SrShape[];
  /** Where an image is, or `undefined` for one the viewer does not have. */
  readonly referenceOf: (sopInstanceUID: string) => MeasurementReference | undefined;
  /** Measurement groups the reader failed on. */
  readonly unreadable: number;
  /** The reader's names for shapes of a kind the model has no place for, one for each shape. */
  readonly unsupported: readonly string[];
}

export interface SrMapResult {
  readonly measurements: readonly Measurement[];
  readonly skipped: readonly SrSkip[];
}

/**
 * The id of the measurement a report's shape becomes. It follows the report and the shape's place
 * in it, so loading a report again replaces its measurements instead of adding them twice.
 */
export function srMeasurementId(srSopInstanceUID: string, index: number): string {
  return `sr:${srSopInstanceUID}:${String(index)}`;
}

/**
 * Turns what the engine read from a report into measurements. A shape that cannot become one is
 * counted by reason, not thrown: a report comes from outside, and part of it may be no use.
 */
export function measurementsFromSr(input: SrMapInput): SrMapResult {
  const measurements: Measurement[] = [];
  let notInStudy = 0;
  let rejected = 0;
  for (const shape of input.shapes) {
    const reference = input.referenceOf(shape.sopInstanceUID);
    if (reference === undefined) {
      notInStudy += 1;
      continue;
    }
    const parsed = parseMeasurement({
      id: srMeasurementId(input.srSopInstanceUID, shape.position),
      type: shape.type,
      label: shape.label,
      reference,
      points: shape.points,
    });
    if (parsed.ok) measurements.push(parsed.measurement);
    else rejected += 1;
  }

  const skipped: SrSkip[] = [];
  const skip = (reason: string, count: number): void => {
    if (count > 0) skipped.push({ reason, count });
  };
  skip('The report refers to an image that is not in this study.', notInStudy);
  skip('The shape is not one the viewer can keep.', rejected);
  skip('The reader could not read the shape.', input.unreadable);
  skip(
    `The viewer has no place for this kind of shape (${[...new Set(input.unsupported)].join(', ')}).`,
    input.unsupported.length,
  );
  return { measurements, skipped };
}

export type EllipsePoints = readonly [Point3, Point3, Point3, Point3];

function verticality(from: Point3, to: Point3, column: Point3): number {
  const axis = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const;
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  const down = Math.hypot(column[0], column[1], column[2]);
  if (length === 0 || down === 0) return 0;
  return (
    Math.abs(axis[0] * column[0] + axis[1] * column[1] + axis[2] * column[2]) / (length * down)
  );
}

/**
 * The model keeps an ellipse as the ends of its vertical axis, then the ends of its horizontal one.
 * A report writes the longer axis first, so the reader gives either order. `column` is the direction
 * of increasing row in patient space (down the picture). Axes at the same angle stay as they came.
 */
export function orderEllipseAxes(points: EllipsePoints, column: Point3): EllipsePoints {
  const [a0, a1, b0, b1] = points;
  return verticality(b0, b1, column) > verticality(a0, a1, column) ? [b0, b1, a0, a1] : points;
}
