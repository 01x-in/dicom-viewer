import { describe, expect, it } from 'vitest';
import type { DicomJsonInstance } from '../data/types';
import {
  angleAt,
  distance,
  geometryValues,
  type ImagePlane,
  pixelToWorld,
  planeOf,
  worldToPixel,
} from './geometry';
import type { Measurement, MeasurementReference, Point3 } from './model';

const reference: MeasurementReference = {
  studyInstanceUID: '1.2.3',
  seriesInstanceUID: '1.2.3.1',
  sopInstanceUID: '1.2.3.1.0.0',
};

function instance(overrides: Record<string, unknown[] | undefined> = {}): DicomJsonInstance {
  const tags: Record<string, unknown[] | undefined> = {
    '00200032': [-96, -96, 10],
    '00200037': [1, 0, 0, 0, 1, 0],
    '00280030': [1.5, 2],
    '00280010': [128],
    '00280011': [100],
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([, value]) => value !== undefined)
      .map(([tag, value]) => [tag, { vr: 'DS', Value: value }]),
  );
}

function plane(overrides: Record<string, unknown[] | undefined> = {}): ImagePlane {
  const found = planeOf(instance(overrides));
  if (found === undefined) throw new Error('No plane');
  return found;
}

describe('planeOf', () => {
  it('reads position, orientation, spacing, and size', () => {
    expect(plane()).toEqual({
      origin: [-96, -96, 10],
      alongRow: [1, 0, 0],
      alongColumn: [0, 1, 0],
      // PixelSpacing is [between rows, between columns].
      rowSpacing: 1.5,
      columnSpacing: 2,
      rows: 128,
      columns: 100,
    });
  });

  it('accepts numbers sent as strings, as DICOM JSON may', () => {
    expect(plane({ '00200032': ['-96', '-96', '10'] }).origin).toEqual([-96, -96, 10]);
  });

  it.each(['00200032', '00200037', '00280030', '00280010', '00280011'])(
    'is undefined without %s, because a pixel then has no place',
    (tag) => {
      expect(planeOf(instance({ [tag]: undefined }))).toBeUndefined();
    },
  );

  it('is undefined for a spacing of zero or an orientation with no length', () => {
    expect(planeOf(instance({ '00280030': [0, 1] }))).toBeUndefined();
    expect(planeOf(instance({ '00200037': [0, 0, 0, 0, 1, 0] }))).toBeUndefined();
  });
});

describe('worldToPixel and pixelToWorld', () => {
  it('put pixel centres on whole numbers', () => {
    const found = plane();
    expect(worldToPixel(found, [-96, -96, 10])).toEqual({ row: 0, column: 0 });
    // Column 3 is 6 mm along x, and row 4 is 6 mm along y.
    expect(worldToPixel(found, [-90, -90, 10])).toEqual({ row: 4, column: 3 });
    expect(pixelToWorld(found, { row: 4, column: 3 })).toEqual([-90, -90, 10]);
  });

  it("are each other's inverse on a tilted image", () => {
    const tilted = plane({
      // An oblique slice: the row and column directions are at right angles, as DICOM requires.
      '00200037': [0.6, 0.8, 0, 0, 0, 1],
      '00200032': [10, 20, 30],
    });
    const world = pixelToWorld(tilted, { row: 12.25, column: 7.5 });
    const back = worldToPixel(tilted, world);
    expect(back.row).toBeCloseTo(12.25, 9);
    expect(back.column).toBeCloseTo(7.5, 9);
  });

  it('ignore how far a point is from the plane', () => {
    expect(worldToPixel(plane(), [-90, -90, 99])).toEqual({
      row: 4,
      column: 3,
    });
  });
});

describe('angleAt', () => {
  it('measures the angle between the arms at the vertex', () => {
    expect(angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90, 9);
    expect(angleAt([1, 0, 0], [0, 0, 0], [1, 1, 0])).toBeCloseTo(45, 9);
  });

  it('is 180 for a straight line and 0 for arms that lie on each other', () => {
    expect(angleAt([-1, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(180, 9);
    expect(angleAt([1, 0, 0], [0, 0, 0], [2, 0, 0])).toBeCloseTo(0, 9);
  });

  it("does not depend on which arm comes first, or on the arms' lengths", () => {
    expect(angleAt([0, 5, 0], [0, 0, 0], [3, 0, 0])).toBeCloseTo(90, 9);
  });

  it('is undefined when an arm has no length', () => {
    expect(angleAt([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBeUndefined();
  });

  it('works in three dimensions', () => {
    expect(angleAt([0, 0, 2], [0, 0, 0], [3, 0, 0])).toBeCloseTo(90, 9);
  });
});

const p = (x: number, y: number, z = 0): Point3 => [x, y, z];

describe('geometryValues', () => {
  it('gives the length of a length', () => {
    const length: Measurement = {
      id: 'a',
      type: 'length',
      reference,
      points: [p(0, 0), p(3, 4)],
    };
    expect(geometryValues(length)).toEqual({ lengthMm: 5 });
  });

  it('gives a bidirectional measurement its longer axis as the length, whichever it was drawn first', () => {
    const drawnLongFirst: Measurement = {
      id: 'a',
      type: 'bidirectional',
      reference,
      points: [p(0, 0), p(10, 0), p(5, -2), p(5, 2)],
    };
    const drawnShortFirst: Measurement = {
      ...drawnLongFirst,
      points: [p(5, -2), p(5, 2), p(0, 0), p(10, 0)],
    };
    expect(geometryValues(drawnLongFirst)).toEqual({
      lengthMm: 10,
      widthMm: 4,
    });
    expect(geometryValues(drawnShortFirst)).toEqual({
      lengthMm: 10,
      widthMm: 4,
    });
  });

  it('gives an ellipse the area of its two axes, as Cornerstone does', () => {
    const ellipse: Measurement = {
      id: 'a',
      type: 'ellipse',
      reference,
      // Bottom, top (4 apart), left, right (10 apart).
      points: [p(5, 2), p(5, -2), p(0, 0), p(10, 0)],
    };
    expect(geometryValues(ellipse).areaMm2).toBeCloseTo(Math.PI * 5 * 2, 9);
  });

  it('gives a rectangle the product of its width and height', () => {
    const rectangle: Measurement = {
      id: 'a',
      type: 'rectangle',
      reference,
      points: [p(0, 0), p(10, 0), p(0, 4), p(10, 4)],
    };
    expect(geometryValues(rectangle)).toEqual({ areaMm2: 40 });
  });

  it('gives an angle in degrees, and a probe nothing', () => {
    const angle: Measurement = {
      id: 'a',
      type: 'angle',
      reference,
      points: [p(1, 0), p(0, 0), p(0, 1)],
    };
    expect(geometryValues(angle).degrees).toBeCloseTo(90, 9);
    const probe: Measurement = {
      id: 'b',
      type: 'probe',
      reference,
      points: [p(0, 0)],
    };
    expect(geometryValues(probe)).toEqual({});
  });
});

describe('distance', () => {
  it('is the straight line between two points', () => {
    expect(distance(p(1, 2, 3), p(4, 6, 3))).toBe(5);
  });
});
