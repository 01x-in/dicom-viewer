import { describe, expect, it } from 'vitest';
import {
  buildReport,
  REPORT_COLUMNS,
  REPORT_FOOTER,
  type ReportInput,
  type ReportSeries,
} from './report';
import type { Measurement, MeasurementReference } from './model';

const STUDY = '1.2.3';
const reference = (series: string, index: number): MeasurementReference => ({
  studyInstanceUID: STUDY,
  seriesInstanceUID: series,
  sopInstanceUID: `${series}.0.${index.toString()}`,
});

const length = (id: string, index: number, label?: string): Measurement => ({
  id,
  type: 'length',
  ...(label === undefined ? {} : { label }),
  reference: reference('1.2.3.1', index),
  points: [
    [0, 0, 0],
    [3, 4, 0],
  ],
});
const probe: Measurement = {
  id: 'p',
  type: 'probe',
  reference: reference('1.2.3.2', 1),
  points: [[1, 1, 1]],
  hu: 42,
};
const angle: Measurement = {
  id: 'a',
  type: 'angle',
  reference: reference('1.2.3.1', 9),
  points: [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
  ],
};

const series = (uid: string, count: number, description?: string): [string, ReportSeries] => [
  uid,
  {
    modality: 'CT',
    description,
    slices: new Map(
      Array.from({ length: count }, (_, index) => [`${uid}.0.${index.toString()}`, index + 1]),
    ),
  },
];

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    generatedAt: new Date(Date.UTC(2026, 10, 7, 14, 5, 59)),
    studyInstanceUID: STUDY,
    studyDescription: 'CT chest',
    measurements: [length('a1', 4), probe],
    origins: new Map([
      ['a1', 'user'],
      ['p', 'import'],
    ]),
    series: new Map([series('1.2.3.1', 10, 'Axial 2.5 mm'), series('1.2.3.2', 4)]),
    patient: { name: 'DOE JANE', id: 'ID-7', birthDate: '19700102' },
    showPatientInfo: false,
    ...overrides,
  };
}

describe('buildReport', () => {
  it('has one row for each measurement, in the order they were made', () => {
    const report = buildReport(input());
    expect(report.columns).toEqual(REPORT_COLUMNS);
    expect(report.rows.map((row) => row.name)).toEqual(['Length 1', 'Probe 1']);
  });

  it('gives the numbers the panel shows, one to a line', () => {
    const [first, second] = buildReport(input()).rows;
    expect(first?.value).toEqual(['Length 5.0 mm']);
    expect(second?.value).toEqual(['Value 42.0 HU']);
  });

  it('names an unnamed measurement as the panel does, and keeps a name a person gave', () => {
    const report = buildReport(
      input({ measurements: [length('x', 0), length('y', 1, 'Aorta'), length('z', 2)] }),
    );
    expect(report.rows.map((row) => row.name)).toEqual(['Length 1', 'Aorta', 'Length 3']);
  });

  it('says which series and which slice, counting slices from 1', () => {
    const [first, second] = buildReport(input()).rows;
    expect(first).toMatchObject({ series: 'CT, Axial 2.5 mm', slice: '5' });
    expect(second).toMatchObject({ series: 'CT', slice: '2' });
  });

  it('says where each came from', () => {
    const [first, second] = buildReport(input()).rows;
    expect(first?.source).toBe('Drawn');
    expect(second?.source).toBe('Imported');
    const code = buildReport(input({ origins: new Map([['a1', 'api']]) })).rows[0];
    expect(code?.source).toBe('API');
  });

  it('numbers a slice as the stack it is shown in does, not by the order of the series', () => {
    const reversed: ReportSeries = {
      modality: 'CT',
      description: undefined,
      // The first instance of the series is the last slice of the stack.
      slices: new Map([
        ['1.2.3.1.0.0', 10],
        ['1.2.3.1.0.4', 6],
      ]),
    };
    const row = buildReport(input({ series: new Map([['1.2.3.1', reversed]]) })).rows[0];
    expect(row?.slice).toBe('6');
  });

  it('leaves a slice blank when the image is in no stack', () => {
    const nothing: ReportSeries = { modality: 'CT', description: undefined, slices: new Map() };
    expect(buildReport(input({ series: new Map([['1.2.3.1', nothing]]) })).rows[0]?.slice).toBe('');
  });

  it('leaves a slice blank when the series is not known', () => {
    const row = buildReport(input({ series: new Map() })).rows[0];
    expect(row).toMatchObject({ series: '', slice: '' });
  });

  it('leaves out a number that was not worked out', () => {
    const row = buildReport(input({ measurements: [{ ...probe, hu: undefined }] })).rows[0];
    expect(row?.value).toEqual([]);
  });

  it('puts the study and the time in the head, and the footer on the page', () => {
    const report = buildReport(input());
    expect(report.title).toBe('Measurement report');
    expect(report.madeAt).toBe('2026-11-07 14:05 UTC');
    expect(report.studyLines).toEqual(['Study: CT chest', 'Study UID: 1.2.3']);
    expect(report.footer).toBe(REPORT_FOOTER);
    expect(REPORT_FOOTER).toBe('Software for building viewers. Not for diagnosis.');
  });

  it('uses the title a host gives', () => {
    expect(buildReport(input({ title: 'Follow-up 2' })).title).toBe('Follow-up 2');
  });

  it('leaves out who the patient is unless it is asked to show them', () => {
    const hidden = buildReport(input());
    expect(hidden.patientLines).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain('DOE');
    expect(JSON.stringify(hidden)).not.toContain('ID-7');
    expect(JSON.stringify(hidden)).not.toContain('1970');

    const shown = buildReport(input({ showPatientInfo: true }));
    expect(shown.patientLines).toEqual([
      'Patient: DOE JANE',
      'Patient ID: ID-7',
      'Birth date: 1970-01-02',
    ]);
  });

  it('shows no patient line for what the study does not say', () => {
    const report = buildReport(input({ showPatientInfo: true, patient: { name: 'DOE JANE' } }));
    expect(report.patientLines).toEqual(['Patient: DOE JANE']);
  });

  it('keeps an angle with its degrees', () => {
    expect(buildReport(input({ measurements: [angle] })).rows[0]?.value).toEqual(['Angle 90.0°']);
  });
});
