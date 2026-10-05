import { describe, expect, it } from 'vitest';
import type { ImagePlane } from './geometry';
import type { EllipseMeasurement, Point3, RectangleMeasurement } from './model';
import { type PixelSlice, probeHu, roiStats } from './stats';

const reference = {
  studyInstanceUID: '1.2.3',
  seriesInstanceUID: '1.2.3.1',
  sopInstanceUID: '1.2.3.1.0.0',
};

/** 1 mm pixels with the first pixel's centre at the origin: world x is the column and y the row. */
const plane: ImagePlane = {
  origin: [0, 0, 0],
  alongRow: [1, 0, 0],
  alongColumn: [0, 1, 0],
  columnSpacing: 1,
  rowSpacing: 1,
  rows: 10,
  columns: 10,
};

function slice(value: (row: number, column: number) => number): PixelSlice {
  return { rows: 10, columns: 10, at: value };
}

const p = (x: number, y: number): Point3 => [x, y, 0];

/** Corners as the tool keeps them: a corner, the one along the width, the one along the height, the opposite. */
function rectangle(left: number, top: number, right: number, bottom: number): RectangleMeasurement {
  return {
    id: 'r',
    type: 'rectangle',
    reference,
    points: [p(left, top), p(right, top), p(left, bottom), p(right, bottom)],
  };
}

/** Ends of the vertical axis, then of the horizontal one. */
function ellipse(
  centreX: number,
  centreY: number,
  halfX: number,
  halfY: number,
): EllipseMeasurement {
  return {
    id: 'e',
    type: 'ellipse',
    reference,
    points: [
      p(centreX, centreY + halfY),
      p(centreX, centreY - halfY),
      p(centreX - halfX, centreY),
      p(centreX + halfX, centreY),
    ],
  };
}

describe('roiStats of a rectangle', () => {
  it('counts the pixels whose centres are inside, edges included', () => {
    const stats = roiStats(
      slice(() => 7),
      plane,
      rectangle(2, 3, 4, 5),
    );
    // Columns 2 to 4 and rows 3 to 5: nine pixels.
    expect(stats).toEqual({
      pixelCount: 9,
      meanHu: 7,
      stdDevHu: 0,
      minHu: 7,
      maxHu: 7,
    });
  });

  it('leaves out a pixel whose centre is outside, however close the edge', () => {
    const stats = roiStats(
      slice(() => 1),
      plane,
      rectangle(2.2, 2.2, 4.8, 4.8),
    );
    // Centres at 3 and 4 only.
    expect(stats?.pixelCount).toBe(4);
  });

  it('gives the mean, the spread, and the range of what is inside', () => {
    // Row 0 and 1 hold 10 and 30: a 2 by 1 box on columns 0 to 0 spans both.
    const stats = roiStats(
      slice((row) => (row === 0 ? 10 : row === 1 ? 30 : 999)),
      plane,
      rectangle(0, 0, 0, 1),
    );
    expect(stats?.pixelCount).toBe(2);
    expect(stats?.meanHu).toBe(20);
    expect(stats?.stdDevHu).toBe(10);
    expect(stats?.minHu).toBe(10);
    expect(stats?.maxHu).toBe(30);
  });

  it('does not depend on which corner is which', () => {
    const shuffled: RectangleMeasurement = {
      ...rectangle(2, 3, 4, 5),
      points: [p(4, 5), p(2, 3), p(4, 3), p(2, 5)],
    };
    const value = slice((row, column) => row * 10 + column);
    expect(roiStats(value, plane, shuffled)).toEqual(roiStats(value, plane, rectangle(2, 3, 4, 5)));
  });

  it('keeps to the image when the shape runs off it', () => {
    const stats = roiStats(
      slice(() => 5),
      plane,
      rectangle(-5, -5, 1, 1),
    );
    // Columns 0 and 1, rows 0 and 1.
    expect(stats?.pixelCount).toBe(4);
  });

  it('is undefined when no pixel centre is inside', () => {
    const none = roiStats(
      slice(() => 5),
      plane,
      rectangle(2.1, 2.1, 2.9, 2.9),
    );
    expect(none).toBeUndefined();
    const outside = roiStats(
      slice(() => 5),
      plane,
      rectangle(20, 20, 30, 30),
    );
    expect(outside).toBeUndefined();
  });

  it('reads pixel spacing and an offset origin into account', () => {
    const scaled: ImagePlane = {
      ...plane,
      origin: [100, 200, 0],
      columnSpacing: 2,
      rowSpacing: 2,
    };
    // World x 104 to 108 is columns 2 to 4, and y 204 to 208 is rows 2 to 4.
    const stats = roiStats(
      slice((row, column) => (row >= 2 && row <= 4 && column >= 2 && column <= 4 ? 1 : 0)),
      scaled,
      rectangle(104, 204, 108, 208),
    );
    expect(stats).toMatchObject({
      pixelCount: 9,
      meanHu: 1,
      minHu: 1,
      maxHu: 1,
    });
  });
});

describe('roiStats of an ellipse', () => {
  it('counts the pixels whose centres are inside the curve', () => {
    // A circle of radius 2 around (5, 5): the centre, the 4 next to it, 4 diagonal at 1.41, the 4 at distance 2.
    const stats = roiStats(
      slice(() => 3),
      plane,
      ellipse(5, 5, 2, 2),
    );
    expect(stats?.pixelCount).toBe(13);
    expect(stats?.meanHu).toBe(3);
  });

  it('uses the two radii separately', () => {
    const wide = roiStats(
      slice(() => 1),
      plane,
      ellipse(5, 5, 3, 1),
    );
    // Row 5: columns 2 to 8 (7). Rows 4 and 6: |dx|/3 squared + 1 > 1 except at dx = 0 (1 each).
    expect(wide?.pixelCount).toBe(9);
  });

  it('is undefined with no width or no height', () => {
    expect(
      roiStats(
        slice(() => 1),
        plane,
        ellipse(5, 5, 0, 2),
      ),
    ).toBeUndefined();
  });

  it('weighs only what is inside, not the box around it', () => {
    // 1000 in the corners of the box and 40 elsewhere: the corners are outside the circle.
    const value = slice((row, column) => (Math.hypot(row - 5, column - 5) <= 3 ? 40 : 1000));
    const stats = roiStats(value, plane, ellipse(5, 5, 3, 3));
    expect(stats?.meanHu).toBe(40);
    expect(stats?.maxHu).toBe(40);
  });
});

describe('probeHu', () => {
  const value = slice((row, column) => row * 10 + column);

  it('reads the pixel the point is in', () => {
    expect(probeHu(value, plane, p(3, 4))).toBe(43);
    // 3.4 is still inside the pixel centred on 3, and 3.6 is inside the next.
    expect(probeHu(value, plane, p(3.4, 4.4))).toBe(43);
    expect(probeHu(value, plane, p(3.6, 4.6))).toBe(54);
  });

  it('is undefined outside the image', () => {
    expect(probeHu(value, plane, p(-1, 0))).toBeUndefined();
    expect(probeHu(value, plane, p(0, 10))).toBeUndefined();
    expect(probeHu(value, plane, p(9.4, 9.4))).toBe(99);
  });
});
