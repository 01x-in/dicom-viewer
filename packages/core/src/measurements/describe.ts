import { geometryValues, type GeometryValues } from './geometry';
import type { Measurement, MeasurementType, RoiStats } from './model';

/** Every number a measurement has: from its shape, and from the pixels inside it when they have been read. */
export interface MeasurementValues extends GeometryValues, Partial<RoiStats> {
  /** A probe's value. */
  readonly hu?: number | undefined;
}

export const MEASUREMENT_NAMES: Readonly<Record<MeasurementType, string>> = {
  length: 'Length',
  bidirectional: 'Bidirectional',
  ellipse: 'Ellipse',
  rectangle: 'Rectangle',
  probe: 'Probe',
  angle: 'Angle',
};

export function measurementValues(measurement: Measurement): MeasurementValues {
  const shape = geometryValues(measurement);
  switch (measurement.type) {
    case 'ellipse':
    case 'rectangle':
      return { ...shape, ...measurement.stats };
    case 'probe':
      return { hu: measurement.hu };
    default:
      return shape;
  }
}

/** One decimal, and never "-0.0". */
function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

/**
 * The lines to show for a measurement, such as `Area 123.4 mm²`. A number that has not been worked
 * out (the pixels of a shape that has not been read) leaves its line out.
 */
export function measurementLines(measurement: Measurement): readonly string[] {
  const values = measurementValues(measurement);
  const lines: string[] = [];
  const add = (name: string, value: number | undefined, unit: string): void => {
    if (value !== undefined && Number.isFinite(value)) {
      lines.push(`${name} ${oneDecimal(value)}${unit}`);
    }
  };
  switch (measurement.type) {
    case 'length':
      add('Length', values.lengthMm, ' mm');
      break;
    case 'bidirectional':
      add('Long', values.lengthMm, ' mm');
      add('Short', values.widthMm, ' mm');
      break;
    case 'ellipse':
    case 'rectangle':
      add('Area', values.areaMm2, ' mm²');
      add('Mean', values.meanHu, ' HU');
      add('SD', values.stdDevHu, ' HU');
      add('Min', values.minHu, ' HU');
      add('Max', values.maxHu, ' HU');
      break;
    case 'probe':
      add('Value', values.hu, ' HU');
      break;
    case 'angle':
      add('Angle', values.degrees, '°');
      break;
  }
  return lines;
}

/** What a list calls a measurement: its label, or its kind when nobody named it. */
export function measurementTitle(measurement: Measurement): string {
  return measurement.label ?? MEASUREMENT_NAMES[measurement.type];
}
