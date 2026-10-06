import { describe, expect, it } from 'vitest';
import { measurementLines, measurementTitle, measurementValues } from './describe';
import type { EllipseMeasurement, Measurement, Point3 } from './model';

const reference = {
  studyInstanceUID: '1.2.3',
  seriesInstanceUID: '1.2.3.1',
  sopInstanceUID: '1.2.3.1.0.0',
};
const p = (x: number, y: number): Point3 => [x, y, 0];

const length: Measurement = {
  id: 'a',
  type: 'length',
  reference,
  points: [p(0, 0), p(3, 4)],
};
const ellipse: EllipseMeasurement = {
  id: 'b',
  type: 'ellipse',
  reference,
  points: [p(5, 2), p(5, -2), p(0, 0), p(10, 0)],
};
const stats = {
  pixelCount: 31,
  meanHu: 40.04,
  stdDevHu: 1.25,
  minHu: -3.5,
  maxHu: 44,
};

describe('measurementLines', () => {
  it('says the length of a length', () => {
    expect(measurementLines(length)).toEqual(['Length 5.0 mm']);
  });

  it('says both axes of a bidirectional measurement, the longer first', () => {
    const bi: Measurement = {
      id: 'c',
      type: 'bidirectional',
      reference,
      points: [p(5, -2), p(5, 2), p(0, 0), p(10, 0)],
    };
    expect(measurementLines(bi)).toEqual(['Long 10.0 mm', 'Short 4.0 mm']);
  });

  it('says the area of a shape, and its pixels once they are read', () => {
    expect(measurementLines(ellipse)).toEqual(['Area 31.4 mm²']);
    expect(measurementLines({ ...ellipse, stats })).toEqual([
      'Area 31.4 mm²',
      'Mean 40.0 HU',
      'SD 1.3 HU',
      'Min -3.5 HU',
      'Max 44.0 HU',
    ]);
  });

  it('says the value of a probe once it is read', () => {
    const probe: Measurement = {
      id: 'd',
      type: 'probe',
      reference,
      points: [p(1, 1)],
    };
    expect(measurementLines(probe)).toEqual([]);
    expect(measurementLines({ ...probe, hu: 1000 })).toEqual(['Value 1000.0 HU']);
  });

  it('says an angle in degrees', () => {
    const angle: Measurement = {
      id: 'e',
      type: 'angle',
      reference,
      points: [p(1, 0), p(0, 0), p(0, 1)],
    };
    expect(measurementLines(angle)).toEqual(['Angle 90.0°']);
  });

  it('says nothing for an angle with an arm of no length, rather than NaN', () => {
    const angle: Measurement = {
      id: 'e',
      type: 'angle',
      reference,
      points: [p(0, 0), p(0, 0), p(0, 1)],
    };
    expect(measurementLines(angle)).toEqual([]);
  });

  it('never writes a negative zero', () => {
    expect(
      measurementLines({
        ...ellipse,
        stats: { ...stats, meanHu: -0.04 },
      }),
    ).toContain('Mean 0.0 HU');
  });
});

describe('measurementValues', () => {
  it('joins the shape with the pixels', () => {
    const values = measurementValues({ ...ellipse, stats });
    expect(values.areaMm2).toBeCloseTo(31.4159, 3);
    expect(values).toMatchObject({ meanHu: 40.04, pixelCount: 31 });
  });
});

describe('measurementTitle', () => {
  it('is the label, or the kind of measurement', () => {
    expect(measurementTitle(length)).toBe('Length');
    expect(measurementTitle({ ...length, label: 'Aorta' })).toBe('Aorta');
  });
});
