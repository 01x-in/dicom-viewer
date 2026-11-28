import { describe, expect, it } from 'vitest';
import {
  REPORT_COLUMNS,
  REPORT_FOOTER,
  type ReportModel,
  type ReportRow,
} from '../measurements/report';
import { renderText } from './text';

const row = (name: string, overrides: Partial<ReportRow> = {}): ReportRow => ({
  name,
  type: 'Length',
  value: ['Length 14.2 mm'],
  series: 'CT, Axial 2.5 mm',
  slice: '22',
  source: 'Drawn',
  ...overrides,
});

function model(rows: readonly ReportRow[], overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    title: 'Measurement report',
    madeAt: '2026-11-08 09:14 UTC',
    studyLines: ['Study: CT chest', 'Study UID: 1.2.3'],
    patientLines: [],
    columns: REPORT_COLUMNS,
    rows,
    footer: REPORT_FOOTER,
    ...overrides,
  };
}

describe('renderText', () => {
  it('has the title, the study, when it was made, then one line for each measurement, in order, then the footer', () => {
    const text = renderText(
      model([
        row('Length 1'),
        row('Aorta', {
          type: 'Ellipse',
          value: ['Area 312.4 mm²', 'Mean 41.2 HU'],
          slice: '30',
          source: 'Imported',
        }),
      ]),
    );
    expect(text.split('\n')).toEqual([
      'Measurement report',
      'Study: CT chest',
      'Study UID: 1.2.3',
      'Made: 2026-11-08 09:14 UTC',
      '',
      'Length 1: Length 14.2 mm. CT, Axial 2.5 mm, slice 22 (Drawn)',
      'Aorta: Area 312.4 mm². Mean 41.2 HU. CT, Axial 2.5 mm, slice 30 (Imported)',
      '',
      REPORT_FOOTER,
    ]);
  });

  it('leaves out the series and the slice a measurement has none of', () => {
    const text = renderText(model([row('Length 1', { series: '', slice: '' })]));
    expect(text).toContain('\nLength 1: Length 14.2 mm (Drawn)\n');
    const noSlice = renderText(model([row('Length 1', { slice: '' })]));
    expect(noSlice).toContain('\nLength 1: Length 14.2 mm. CT, Axial 2.5 mm (Drawn)\n');
    const noSeries = renderText(model([row('Length 1', { series: '' })]));
    expect(noSeries).toContain('\nLength 1: Length 14.2 mm. slice 22 (Drawn)\n');
  });

  it('puts the patient lines in only when the model has them, and says nothing else about who they are', () => {
    const without = renderText(model([row('a')]));
    expect(without).not.toMatch(/Patient|Birth/);
    const withPatient = renderText(
      model([row('a')], { patientLines: ['Patient: Doe^Jane', 'Patient ID: 123'] }),
    );
    expect(withPatient).toContain('Patient: Doe^Jane\nPatient ID: 123\nMade:');
  });

  it('keeps a label as it is: not limited to Latin-1, and not cut', () => {
    const label = `Aorte ascendante ${'é'.repeat(100)} 肺 結節`;
    const text = renderText(model([row(label)]));
    expect(text).toContain(`${label}: Length 14.2 mm`);
  });

  it('is only the header and the footer with no measurements', () => {
    expect(renderText(model([])).split('\n')).toEqual([
      'Measurement report',
      'Study: CT chest',
      'Study UID: 1.2.3',
      'Made: 2026-11-08 09:14 UTC',
      '',
      REPORT_FOOTER,
    ]);
  });

  it('uses a title the model has, and puts a measurement with no numbers after its name alone', () => {
    const text = renderText(model([row('Odd', { value: [] })], { title: 'Follow-up 2' }));
    expect(text.startsWith('Follow-up 2\n')).toBe(true);
    expect(text).toContain('\nOdd: CT, Axial 2.5 mm, slice 22 (Drawn)\n');
  });
});
