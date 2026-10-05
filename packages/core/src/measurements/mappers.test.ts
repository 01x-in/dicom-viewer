import { describe, expect, it } from 'vitest';
import type { EngineMeasurement } from '../rendering-port';
import { fromEngineShape, toEngineShape } from './mappers';
import type { Measurement, MeasurementReference, Point3 } from './model';

const reference: MeasurementReference = {
  studyInstanceUID: '1.2.3',
  seriesInstanceUID: '1.2.3.1',
  sopInstanceUID: '1.2.3.1.0.5',
  frameOfReferenceUID: '1.2.3.77',
};

const p = (x: number, y: number, z = 12.5): Point3 => [x, y, z];

/** One of each kind, with a label and the numbers the viewer adds, which the engine never sees. */
const EVERY_KIND: readonly Measurement[] = [
  { id: 'a', type: 'length', reference, points: [p(0, 0), p(3, 4)], label: 'Aorta' },
  {
    id: 'b',
    type: 'bidirectional',
    reference,
    points: [p(0, 0), p(10, 0), p(5, -2), p(5, 2)],
  },
  {
    id: 'c',
    type: 'ellipse',
    reference,
    points: [p(5, 2), p(5, -2), p(0, 0), p(10, 0)],
    stats: { pixelCount: 31, meanHu: 40, stdDevHu: 1, minHu: 38, maxHu: 44 },
  },
  {
    id: 'd',
    type: 'rectangle',
    reference,
    points: [p(0, 0), p(10, 0), p(0, 4), p(10, 4)],
  },
  { id: 'e', type: 'probe', reference, points: [p(7, 2)], hu: 1000 },
  { id: 'f', type: 'angle', reference, points: [p(1, 0), p(0, 0), p(0, 1)] },
];

describe('toEngineShape', () => {
  it.each(EVERY_KIND)('keeps what the engine draws of a $type, and nothing else', (measurement) => {
    expect(toEngineShape(measurement, 4)).toEqual({
      id: measurement.id,
      type: measurement.type,
      imageIndex: 4,
      points: measurement.points,
    });
  });
});

describe('fromEngineShape', () => {
  it.each(EVERY_KIND)(
    'gives back what was drawn, as a $type on the image it is on',
    (measurement) => {
      const shape = toEngineShape(measurement, 4);
      const back = fromEngineShape(shape, reference);
      // The label and the statistics were never the engine's: they are worked out again.
      expect(back).toEqual({
        id: measurement.id,
        type: measurement.type,
        reference,
        points: measurement.points,
      });
    },
  );

  it('is the other way of toEngineShape: drawing and reading again changes nothing that is geometry', () => {
    for (const measurement of EVERY_KIND) {
      const again = fromEngineShape(toEngineShape(measurement, 0), reference);
      expect(again?.points).toEqual(measurement.points);
      expect(again && toEngineShape(again, 0)).toEqual(toEngineShape(measurement, 0));
    }
  });

  const shape = (overrides: Partial<EngineMeasurement>): EngineMeasurement => ({
    id: 'x',
    type: 'length',
    imageIndex: 0,
    points: [p(0, 0), p(1, 1)],
    ...overrides,
  });

  it('refuses a shape with the wrong number of handles', () => {
    expect(fromEngineShape(shape({ points: [p(0, 0)] }), reference)).toBeUndefined();
    expect(fromEngineShape(shape({ type: 'angle' }), reference)).toBeUndefined();
    expect(fromEngineShape(shape({ type: 'probe' }), reference)).toBeUndefined();
  });

  it('refuses a handle that is not a finite point', () => {
    expect(
      fromEngineShape(shape({ points: [p(0, 0), [Number.NaN, 0, 0]] }), reference),
    ).toBeUndefined();
    expect(
      fromEngineShape(shape({ points: [p(0, 0), [0, Number.POSITIVE_INFINITY, 0]] }), reference),
    ).toBeUndefined();
  });

  it('refuses a reference that is not made of UIDs', () => {
    expect(
      fromEngineShape(shape({}), { ...reference, sopInstanceUID: '../etc/passwd' }),
    ).toBeUndefined();
  });

  it('refuses an id that is empty', () => {
    expect(fromEngineShape(shape({ id: '' }), reference)).toBeUndefined();
  });
});
