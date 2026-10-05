import { type ImagePlane, worldToPixel } from './geometry';
import type { EllipseMeasurement, RectangleMeasurement, RoiStats, Point3 } from './model';

/** One decoded slice, in Hounsfield units. The engine makes it; nothing here knows how. */
export interface PixelSlice {
  readonly rows: number;
  readonly columns: number;
  /** The value at one pixel. The caller keeps `row` and `column` inside the image. */
  at(row: number, column: number): number;
}

interface Box {
  readonly minRow: number;
  readonly maxRow: number;
  readonly minColumn: number;
  readonly maxColumn: number;
}

/** The smallest box in pixel positions that holds every handle. Both ROI shapes are axis-aligned in the image. */
function boxOf(plane: ImagePlane, points: readonly Point3[]): Box {
  const positions = points.map((point) => worldToPixel(plane, point));
  const rows = positions.map((position) => position.row);
  const columns = positions.map((position) => position.column);
  return {
    minRow: Math.min(...rows),
    maxRow: Math.max(...rows),
    minColumn: Math.min(...columns),
    maxColumn: Math.max(...columns),
  };
}

/**
 * The mean, spread and range of the pixels whose centre is inside an ellipse or a rectangle. The
 * spread is the population standard deviation. `undefined` when no pixel centre is inside, such as
 * a shape smaller than a pixel or one wholly outside the image.
 */
export function roiStats(
  slice: PixelSlice,
  plane: ImagePlane,
  measurement: EllipseMeasurement | RectangleMeasurement,
): RoiStats | undefined {
  const box = boxOf(plane, measurement.points);
  const centreRow = (box.minRow + box.maxRow) / 2;
  const centreColumn = (box.minColumn + box.maxColumn) / 2;
  const halfRows = (box.maxRow - box.minRow) / 2;
  const halfColumns = (box.maxColumn - box.minColumn) / 2;
  const isEllipse = measurement.type === 'ellipse';
  // An ellipse with no width or no height has no inside.
  if (isEllipse && (halfRows === 0 || halfColumns === 0)) return undefined;

  const firstRow = Math.max(0, Math.ceil(box.minRow));
  const lastRow = Math.min(slice.rows - 1, Math.floor(box.maxRow));
  const firstColumn = Math.max(0, Math.ceil(box.minColumn));
  const lastColumn = Math.min(slice.columns - 1, Math.floor(box.maxColumn));

  let count = 0;
  let mean = 0;
  let sumOfSquares = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (isEllipse) {
        const across = (column - centreColumn) / halfColumns;
        const down = (row - centreRow) / halfRows;
        if (across * across + down * down > 1) continue;
      }
      const value = slice.at(row, column);
      count += 1;
      // Welford's method: stable for the long runs of near-equal values a CT has.
      const delta = value - mean;
      mean += delta / count;
      sumOfSquares += delta * (value - mean);
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (count === 0) return undefined;
  return {
    pixelCount: count,
    meanHu: mean,
    stdDevHu: Math.sqrt(sumOfSquares / count),
    minHu: min,
    maxHu: max,
  };
}

/** The value of the pixel a point is in, or `undefined` when the point is outside the image. */
export function probeHu(slice: PixelSlice, plane: ImagePlane, point: Point3): number | undefined {
  const position = worldToPixel(plane, point);
  const row = Math.round(position.row);
  const column = Math.round(position.column);
  if (row < 0 || row >= slice.rows || column < 0 || column >= slice.columns) return undefined;
  return slice.at(row, column);
}
