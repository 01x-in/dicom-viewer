import { describe, expect, it } from 'vitest';
import type { MeasurementReference, Point3 } from './model';
import { measurementsFromSr, orderEllipseAxes, srMeasurementId, type SrShape } from './sr';

const p = (x: number, y: number, z = 12.5): Point3 => [x, y, z];

const SR_SOP = '1.2.3.9.1';
const reference: MeasurementReference = {
  studyInstanceUID: '1.2.3',
  seriesInstanceUID: '1.2.3.1',
  sopInstanceUID: '1.2.3.1.0.5',
  frameOfReferenceUID: '1.2.3.77',
};
const referenceOf = (sopInstanceUID: string): MeasurementReference | undefined =>
  sopInstanceUID === reference.sopInstanceUID ? reference : undefined;

const length: SrShape = {
  type: 'length',
  points: [p(0, 0), p(3, 4)],
  sopInstanceUID: reference.sopInstanceUID,
};

describe('srMeasurementId', () => {
  it('is the same for the same report and position, and differs by position', () => {
    expect(srMeasurementId(SR_SOP, 0)).toBe(srMeasurementId(SR_SOP, 0));
    expect(srMeasurementId(SR_SOP, 0)).not.toBe(srMeasurementId(SR_SOP, 1));
    expect(srMeasurementId('1.2.3.9.2', 0)).not.toBe(srMeasurementId(SR_SOP, 0));
  });

  it('fits the id the model accepts', () => {
    expect(srMeasurementId(`1.${'2'.repeat(60)}`, 99).length).toBeLessThanOrEqual(128);
  });
});

describe('measurementsFromSr', () => {
  it('turns a shape into a measurement that points at its image', () => {
    const result = measurementsFromSr({
      srSopInstanceUID: SR_SOP,
      shapes: [{ ...length, label: 'Aorta' }],
      referenceOf,
      unreadable: 0,
      unsupported: [],
    });
    expect(result.measurements).toEqual([
      {
        id: srMeasurementId(SR_SOP, 0),
        type: 'length',
        label: 'Aorta',
        reference,
        points: [p(0, 0), p(3, 4)],
      },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('keeps one measurement per shape, in the order of the report', () => {
    const second: SrShape = {
      type: 'probe',
      points: [p(7, 2)],
      sopInstanceUID: reference.sopInstanceUID,
    };
    const result = measurementsFromSr({
      srSopInstanceUID: SR_SOP,
      shapes: [length, second],
      referenceOf,
      unreadable: 0,
      unsupported: [],
    });
    expect(result.measurements.map((m) => m.type)).toEqual(['length', 'probe']);
    expect(result.measurements[1]?.id).toBe(srMeasurementId(SR_SOP, 1));
  });

  it('skips a shape on an image that is not in the study, and says so', () => {
    const elsewhere: SrShape = { ...length, sopInstanceUID: '9.9.9' };
    const result = measurementsFromSr({
      srSopInstanceUID: SR_SOP,
      shapes: [elsewhere, length],
      referenceOf,
      unreadable: 0,
      unsupported: [],
    });
    expect(result.measurements).toHaveLength(1);
    // The position in the report is kept, so ids stay the same whatever is skipped.
    expect(result.measurements[0]?.id).toBe(srMeasurementId(SR_SOP, 1));
    expect(result.skipped).toEqual([
      { reason: 'The report refers to an image that is not in this study.', count: 1 },
    ]);
  });

  it('skips a shape the model rejects', () => {
    const bad: SrShape = {
      type: 'length',
      points: [p(0, 0)],
      sopInstanceUID: reference.sopInstanceUID,
    };
    const notFinite: SrShape = { ...length, points: [p(0, 0), p(Number.NaN, 1)] };
    const result = measurementsFromSr({
      srSopInstanceUID: SR_SOP,
      shapes: [bad, notFinite],
      referenceOf,
      unreadable: 0,
      unsupported: [],
    });
    expect(result.measurements).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: 'The shape is not one the viewer can keep.', count: 2 },
    ]);
  });

  it('counts what the reader could not read and the kinds it has no place for', () => {
    const result = measurementsFromSr({
      srSopInstanceUID: SR_SOP,
      shapes: [length],
      referenceOf,
      unreadable: 2,
      unsupported: ['ArrowAnnotate', 'PlanarFreehandROI', 'ArrowAnnotate'],
    });
    expect(result.skipped).toEqual([
      { reason: 'The reader could not read the shape.', count: 2 },
      {
        reason:
          'The viewer has no place for this kind of shape (ArrowAnnotate, PlanarFreehandROI).',
        count: 3,
      },
    ]);
  });

  it('makes a measurement whose label is empty one without a label', () => {
    const result = measurementsFromSr({
      srSopInstanceUID: SR_SOP,
      shapes: [{ ...length, label: '  ' }],
      referenceOf,
      unreadable: 0,
      unsupported: [],
    });
    expect(result.measurements[0]?.label).toBeUndefined();
  });
});

describe('orderEllipseAxes', () => {
  // The direction of increasing row, down the picture.
  const column: Point3 = [0, 1, 0];
  const vertical = [p(0, -3), p(0, 3)] as const;
  const horizontal = [p(-5, 0), p(5, 0)] as const;

  it('leaves the vertical axis first', () => {
    expect(orderEllipseAxes([...vertical, ...horizontal], column)).toEqual([
      ...vertical,
      ...horizontal,
    ]);
  });

  it('swaps the axes when the horizontal one comes first, as the report writes the longer axis first', () => {
    expect(orderEllipseAxes([...horizontal, ...vertical], column)).toEqual([
      ...vertical,
      ...horizontal,
    ]);
  });

  it('uses the image direction, not the patient axes', () => {
    // An image turned a quarter: down the picture is x in the patient.
    expect(orderEllipseAxes([...vertical, ...horizontal], [1, 0, 0])).toEqual([
      ...horizontal,
      ...vertical,
    ]);
  });

  it('keeps the order it was given when the axes are at the same angle', () => {
    const a = [p(-1, -1), p(1, 1)] as const;
    const b = [p(-1, 1), p(1, -1)] as const;
    expect(orderEllipseAxes([...a, ...b], column)).toEqual([...a, ...b]);
  });
});
