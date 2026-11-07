import { measurementLines, measurementName } from './describe';
import type { Measurement } from './model';
import type { MeasurementOrigin } from './registry';

export const REPORT_FOOTER = 'Software for building viewers. Not for diagnosis.';
export const REPORT_COLUMNS = ['Name', 'Type', 'Value', 'Series', 'Slice', 'Source'] as const;

const TYPE_NAMES: Readonly<Record<Measurement['type'], string>> = {
  length: 'Length',
  bidirectional: 'Bidirectional',
  ellipse: 'Ellipse',
  rectangle: 'Rectangle',
  probe: 'Probe',
  angle: 'Angle',
};

const SOURCE_NAMES: Readonly<Record<MeasurementOrigin, string>> = {
  user: 'Drawn',
  api: 'API',
  import: 'Imported',
};

/** What the report says about a series that measurements are on. */
export interface ReportSeries {
  readonly modality: string;
  readonly description: string | undefined;
  /** The SOP instance UIDs of the series, in the order of its slices. */
  readonly sopInstanceUIDs: readonly string[];
}

/** Who the patient is, as the images say. Only used when the report is asked to show it. */
export interface ReportPatient {
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  /** As DICOM writes it: `YYYYMMDD`. */
  readonly birthDate?: string | undefined;
}

/** What the viewer knows about the study and the series the measurements are on, for the report. */
export interface ReportContext {
  readonly studyDescription?: string | undefined;
  readonly series: ReadonlyMap<string, ReportSeries>;
  readonly patient?: ReportPatient | undefined;
  /** Whether the viewer is set to show who the patient is, as its overlay is. */
  readonly showPatientInfo: boolean;
}

export interface ReportInput {
  /** The name of the report. Default `Measurement report`. */
  readonly title?: string | undefined;
  readonly generatedAt: Date;
  readonly studyInstanceUID: string;
  readonly studyDescription?: string | undefined;
  readonly measurements: readonly Measurement[];
  /** How each measurement came to be. One that is not here is shown as drawn. */
  readonly origins: ReadonlyMap<string, MeasurementOrigin>;
  readonly series: ReadonlyMap<string, ReportSeries>;
  readonly patient?: ReportPatient | undefined;
  /** Without it the report says nothing that could tell who the patient is, whatever `patient` holds. */
  readonly showPatientInfo: boolean;
}

export interface ReportRow {
  readonly name: string;
  readonly type: string;
  /** The numbers, one to a line. */
  readonly value: readonly string[];
  readonly series: string;
  readonly slice: string;
  readonly source: string;
}

/** A report as plain data, which `report/pdf.ts` puts on pages. */
export interface ReportModel {
  readonly title: string;
  readonly madeAt: string;
  readonly studyLines: readonly string[];
  readonly patientLines: readonly string[];
  readonly columns: typeof REPORT_COLUMNS;
  readonly rows: readonly ReportRow[];
  readonly footer: string;
}

function two(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `2026-11-07 14:05 UTC`: the same in every locale and time zone. */
function timeOf(date: Date): string {
  return `${date.getUTCFullYear().toString()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC`;
}

function dateOf(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
}

export function buildReport(input: ReportInput): ReportModel {
  const rows = input.measurements.map((measurement): ReportRow => {
    const series = input.series.get(measurement.reference.seriesInstanceUID);
    const at = series?.sopInstanceUIDs.indexOf(measurement.reference.sopInstanceUID) ?? -1;
    return {
      name: measurementName(measurement, input.measurements),
      type: TYPE_NAMES[measurement.type],
      value: measurementLines(measurement),
      series:
        series === undefined
          ? ''
          : [series.modality, series.description].filter(Boolean).join(', '),
      slice: at < 0 ? '' : (at + 1).toString(),
      source: SOURCE_NAMES[input.origins.get(measurement.id) ?? 'user'],
    };
  });

  const patient = input.showPatientInfo ? input.patient : undefined;
  const patientLines: string[] = [];
  if (patient?.name !== undefined) patientLines.push(`Patient: ${patient.name}`);
  if (patient?.id !== undefined) patientLines.push(`Patient ID: ${patient.id}`);
  if (patient?.birthDate !== undefined) {
    patientLines.push(`Birth date: ${dateOf(patient.birthDate)}`);
  }

  return {
    title: input.title ?? 'Measurement report',
    madeAt: timeOf(input.generatedAt),
    studyLines: [
      ...(input.studyDescription === undefined ? [] : [`Study: ${input.studyDescription}`]),
      `Study UID: ${input.studyInstanceUID}`,
    ],
    patientLines,
    columns: REPORT_COLUMNS,
    rows,
    footer: REPORT_FOOTER,
  };
}
