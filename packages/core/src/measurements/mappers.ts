import type { EngineMeasurement } from '../rendering-port';
import { type Measurement, type MeasurementReference, parseMeasurement } from './model';

/**
 * A measurement as the engine draws it, on one slice. The label and the statistics stay with the
 * viewer: the engine draws a shape and nothing else.
 */
export function toEngineShape(measurement: Measurement, imageIndex: number): EngineMeasurement {
  return {
    id: measurement.id,
    type: measurement.type,
    imageIndex,
    points: measurement.points,
  };
}

/**
 * The measurement a shape the person drew is, once it is known which image it is on. `undefined`
 * if the engine's shape is not one the model can hold (a wrong number of points, a point that is
 * not finite, a reference that is not made of UIDs).
 */
export function fromEngineShape(
  shape: EngineMeasurement,
  reference: MeasurementReference,
): Measurement | undefined {
  const parsed = parseMeasurement({
    id: shape.id,
    type: shape.type,
    reference,
    points: shape.points,
  });
  return parsed.ok ? parsed.measurement : undefined;
}
