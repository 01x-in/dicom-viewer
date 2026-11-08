import type { SeriesInstance } from '../data/types';
import type { MeasurementValues } from './describe';
import type { MeasurementType, Point3 } from './model';

/** One measurement as the SR writer takes it: plain data, with the numbers the viewer holds. */
export interface SrWriteMeasurement {
  readonly id: string;
  readonly type: MeasurementType;
  /** Patient millimetres, as the measurement keeps them. */
  readonly points: readonly Point3[];
  readonly label?: string | undefined;
  /** The image it is on. */
  readonly sopInstanceUID: string;
  /** What the viewer has worked out. A number that is not there is left out of the report, not written as zero. */
  readonly values: MeasurementValues;
}

/** What the engine needs to write a report. */
export interface SrWriteInput {
  /** In the order of the list, which is the order of the report. */
  readonly measurements: readonly SrWriteMeasurement[];
  /** The images the measurements are on, each once. */
  readonly instances: readonly SeriesInstance[];
  readonly seriesInstanceUID: string;
  readonly sopInstanceUID: string;
  readonly seriesDescription: string;
  readonly seriesNumber: number;
  /** The clock is given, so a test can fix it. */
  readonly madeAt: Date;
}
