import { numbers } from '../data/dicom-json';
import type { DicomJsonInstance } from '../data/types';
import type { Measurement, Point3 } from './model';

export function subtract(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm(a: Point3): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Point3, b: Point3): number {
  return norm(subtract(a, b));
}

/** Where the pixels of one image are in patient space. */
export interface ImagePlane {
  /** The centre of the first pixel (row 0, column 0), in millimetres. */
  readonly origin: Point3;
  /** The direction in which the column number grows, along a row. A unit vector. */
  readonly alongRow: Point3;
  /** The direction in which the row number grows, down a column. A unit vector. */
  readonly alongColumn: Point3;
  /** Millimetres from one column to the next. */
  readonly columnSpacing: number;
  /** Millimetres from one row to the next. */
  readonly rowSpacing: number;
  readonly rows: number;
  readonly columns: number;
}

/** A place in an image. Whole numbers are the centres of pixels, so 0.5 is the edge between two. */
export interface PixelPosition {
  readonly row: number;
  readonly column: number;
}

function triple(values: readonly number[], offset: number): Point3 | undefined {
  const [x, y, z] = values.slice(offset, offset + 3);
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
}

function unit(vector: Point3): Point3 | undefined {
  const length = norm(vector);
  return length === 0 ? undefined : [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Reads where an instance's pixels are from its DICOM JSON. `undefined` when it does not say
 * (position, orientation, pixel spacing, or size), because then a pixel has no place in space.
 */
export function planeOf(metadata: DicomJsonInstance): ImagePlane | undefined {
  const position = triple(numbers(metadata, '00200032'), 0);
  const orientation = numbers(metadata, '00200037');
  const alongRow = triple(orientation, 0);
  const alongColumn = triple(orientation, 3);
  const [rowSpacing, columnSpacing] = numbers(metadata, '00280030');
  const rows = numbers(metadata, '00280010')[0];
  const columns = numbers(metadata, '00280011')[0];
  if (
    position === undefined ||
    alongRow === undefined ||
    alongColumn === undefined ||
    rowSpacing === undefined ||
    columnSpacing === undefined ||
    rows === undefined ||
    columns === undefined ||
    rowSpacing <= 0 ||
    columnSpacing <= 0
  ) {
    return undefined;
  }
  const row = unit(alongRow);
  const column = unit(alongColumn);
  if (row === undefined || column === undefined) return undefined;
  return {
    origin: position,
    alongRow: row,
    alongColumn: column,
    columnSpacing,
    rowSpacing,
    rows,
    columns,
  };
}

/** Where a point of patient space falls in the image, projected onto its plane. */
export function worldToPixel(plane: ImagePlane, point: Point3): PixelPosition {
  const offset = subtract(point, plane.origin);
  return {
    column: dot(offset, plane.alongRow) / plane.columnSpacing,
    row: dot(offset, plane.alongColumn) / plane.rowSpacing,
  };
}

export function pixelToWorld(plane: ImagePlane, position: PixelPosition): Point3 {
  const along = position.column * plane.columnSpacing;
  const down = position.row * plane.rowSpacing;
  return [
    plane.origin[0] + plane.alongRow[0] * along + plane.alongColumn[0] * down,
    plane.origin[1] + plane.alongRow[1] * along + plane.alongColumn[1] * down,
    plane.origin[2] + plane.alongRow[2] * along + plane.alongColumn[2] * down,
  ];
}

/** The angle at `vertex` between the two arms, in degrees from 0 to 180. `undefined` if an arm has no length. */
export function angleAt(armA: Point3, vertex: Point3, armB: Point3): number | undefined {
  const a = subtract(armA, vertex);
  const b = subtract(armB, vertex);
  const lengths = norm(a) * norm(b);
  if (lengths === 0) return undefined;
  // Rounding can take the cosine a hair outside the range acos accepts.
  const cosine = Math.min(1, Math.max(-1, dot(a, b) / lengths));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** What the shape of a measurement says, before any pixel is read. Lengths are millimetres. */
export interface GeometryValues {
  /** A length, or the longer axis of a bidirectional measurement. */
  readonly lengthMm?: number | undefined;
  /** The shorter axis of a bidirectional measurement. */
  readonly widthMm?: number | undefined;
  readonly areaMm2?: number | undefined;
  readonly degrees?: number | undefined;
}

/** Worked out from the points alone, the way Cornerstone shows them on the image. */
export function geometryValues(measurement: Measurement): GeometryValues {
  switch (measurement.type) {
    case 'length': {
      const [a, b] = measurement.points;
      return { lengthMm: distance(a, b) };
    }
    case 'bidirectional': {
      const [a, b, c, d] = measurement.points;
      const first = distance(a, b);
      const second = distance(c, d);
      return {
        lengthMm: Math.max(first, second),
        widthMm: Math.min(first, second),
      };
    }
    case 'ellipse': {
      const [bottom, top, left, right] = measurement.points;
      return {
        areaMm2: Math.PI * (distance(left, right) / 2) * (distance(bottom, top) / 2),
      };
    }
    case 'rectangle': {
      const [corner, alongWidth, alongHeight] = measurement.points;
      return {
        areaMm2: distance(corner, alongWidth) * distance(corner, alongHeight),
      };
    }
    case 'angle': {
      const [armA, vertex, armB] = measurement.points;
      return { degrees: angleAt(armA, vertex, armB) };
    }
    case 'probe':
      return {};
  }
}
