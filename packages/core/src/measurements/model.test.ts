import { describe, expect, it } from 'vitest';
import {
  MAX_LABEL_LENGTH,
  type Measurement,
  type MeasurementsDocumentV1,
  parseMeasurement,
  parseMeasurementsDocument,
} from './model';

const reference = {
  studyInstanceUID: '1.2.3',
  seriesInstanceUID: '1.2.3.1',
  sopInstanceUID: '1.2.3.1.0.0',
  frameOfReferenceUID: '1.2.3.77',
};

const length: Measurement = {
  id: 'm-1',
  type: 'length',
  label: 'Aorta',
  reference,
  points: [
    [0, 0, 0],
    [3, 4, 0],
  ],
};

const roi: Measurement = {
  id: 'm-2',
  type: 'ellipse',
  reference,
  points: [
    [5, 2, 0],
    [5, -2, 0],
    [0, 0, 0],
    [10, 0, 0],
  ],
  stats: { pixelCount: 31, meanHu: 40.5, stdDevHu: 1.25, minHu: 38, maxHu: 44 },
};

const document = (measurements: readonly unknown[]): unknown => ({
  format: 'measurements/v1',
  measurements,
});

describe('parseMeasurementsDocument', () => {
  it('reads a document, and the JSON text of one', () => {
    const value: MeasurementsDocumentV1 = {
      format: 'measurements/v1',
      measurements: [length, roi],
    };
    const fromObject = parseMeasurementsDocument(value);
    expect(fromObject).toEqual({ ok: true, measurements: [length, roi] });
    expect(parseMeasurementsDocument(JSON.stringify(value))).toEqual(fromObject);
  });

  it('refuses text that is not JSON', () => {
    expect(parseMeasurementsDocument('{nope')).toEqual({
      ok: false,
      error: 'The measurements are not valid JSON.',
    });
  });

  it('refuses another format, or a version it does not know', () => {
    const other = parseMeasurementsDocument({
      format: 'measurements/v2',
      measurements: [],
    });
    expect(other.ok).toBe(false);
    expect(parseMeasurementsDocument({ measurements: [] }).ok).toBe(false);
  });

  it('refuses a document with a measurement it cannot hold, and says which', () => {
    const result = parseMeasurementsDocument(document([length, { ...roi, points: [[0, 0, 0]] }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/measurements/);
  });

  it('refuses a type it does not know', () => {
    expect(parseMeasurementsDocument(document([{ ...length, type: 'spline' }])).ok).toBe(false);
  });

  it('refuses ids that are used twice', () => {
    const result = parseMeasurementsDocument(document([length, length]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unique/);
  });

  it('refuses a UID that is not a DICOM UID, because it ends up in request paths', () => {
    const bad = {
      ...length,
      reference: { ...reference, sopInstanceUID: '../etc' },
    };
    expect(parseMeasurementsDocument(document([bad])).ok).toBe(false);
  });

  it('refuses a coordinate that is not a finite number', () => {
    const bad = {
      ...length,
      points: [
        [0, 0, 0],
        [Number.NaN, 0, 0],
      ],
    };
    expect(parseMeasurementsDocument(document([bad])).ok).toBe(false);
    // JSON has no NaN: it comes out as null, which is no number either.
    expect(
      parseMeasurementsDocument(
        '{"format":"measurements/v1","measurements":[{"id":"a","type":"probe","reference":{"studyInstanceUID":"1","seriesInstanceUID":"1","sopInstanceUID":"1"},"points":[[0,null,0]]}]}',
      ).ok,
    ).toBe(false);
  });

  it('drops what it does not know, such as the values an export adds', () => {
    const exported = { ...length, values: { lengthMm: 5 }, color: 'red' };
    expect(parseMeasurementsDocument(document([exported]))).toEqual({
      ok: true,
      measurements: [length],
    });
  });

  it('accepts a document with no measurements', () => {
    expect(parseMeasurementsDocument(document([]))).toEqual({
      ok: true,
      measurements: [],
    });
  });
});

describe('parseMeasurement', () => {
  it('keeps statistics that are present and does not need them', () => {
    expect(parseMeasurement(roi)).toEqual({ ok: true, measurement: roi });
    const bare = { ...roi, stats: undefined };
    expect(parseMeasurement(bare)).toEqual({ ok: true, measurement: bare });
  });

  it('trims the label and refuses one that is too long', () => {
    const trimmed = parseMeasurement({ ...length, label: '  Aorta  ' });
    expect(trimmed.ok && trimmed.measurement.label).toBe('Aorta');
    expect(parseMeasurement({ ...length, label: 'x'.repeat(MAX_LABEL_LENGTH + 1) }).ok).toBe(false);
  });

  it('takes an empty or blank label for no label', () => {
    for (const label of ['', '   ']) {
      const parsed = parseMeasurement({ ...length, label });
      expect(parsed.ok && parsed.measurement.label).toBeUndefined();
    }
  });

  it('wants the number of points the type has', () => {
    expect(parseMeasurement({ ...length, type: 'angle' }).ok).toBe(false);
    expect(parseMeasurement({ ...length, type: 'probe' }).ok).toBe(false);
  });

  it('refuses statistics that cannot be', () => {
    expect(parseMeasurement({ ...roi, stats: { ...roi.stats, stdDevHu: -1 } }).ok).toBe(false);
    expect(parseMeasurement({ ...roi, stats: { ...roi.stats, pixelCount: 1.5 } }).ok).toBe(false);
    // No pixel, no statistics: such a shape is left to be read, not shown with numbers no pixel gave.
    expect(parseMeasurement({ ...roi, stats: { ...roi.stats, pixelCount: 0 } }).ok).toBe(false);
  });
});
