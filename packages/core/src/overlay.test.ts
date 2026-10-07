// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DicomJsonInstance } from './data/types';
import type { OverlayItemConfig } from './config/types';
import {
  createOverlayView,
  describeOverlay,
  OVERLAY_STYLE,
  overlayLines,
  type OverlayInfo,
} from './overlay';

const info: OverlayInfo = {
  modality: 'CT',
  seriesDescription: 'Chest 2.5 mm',
  rows: 512,
  columns: 512,
  imageIndex: 11,
  imageCount: 64,
  window: { center: 40, width: 400 },
  invert: false,
  zoom: 1,
  patientName: 'Doe, Jane',
  patientId: 'ID-7',
};

describe('overlayLines', () => {
  it('puts the slice indicator, the window, the series, and the image size in the corners', () => {
    expect(overlayLines(info, { showPatientInfo: false })).toEqual({
      topLeft: ['Chest 2.5 mm'],
      topRight: ['CT', '512 × 512'],
      bottomLeft: ['W 400  L 40'],
      bottomRight: ['Image 12 / 64'],
    });
  });

  it('keeps the patient out of the overlay unless it was asked for', () => {
    const hidden = JSON.stringify(overlayLines(info, { showPatientInfo: false }));
    expect(hidden).not.toContain('Jane');
    expect(hidden).not.toContain('ID-7');
    expect(overlayLines(info, { showPatientInfo: true }).topLeft).toEqual([
      'Doe, Jane',
      'ID-7',
      'Chest 2.5 mm',
    ]);
  });

  it('says what is not the default, and nothing about what is', () => {
    const lines = overlayLines(
      { ...info, zoom: 2.5, invert: true, window: { center: -600.4, width: 1500 } },
      { showPatientInfo: false },
    );
    expect(lines.bottomLeft).toEqual(['W 1500  L -600', 'Zoom 250%', 'Inverted']);
  });

  it('shows fractions of a unit when the window is narrow', () => {
    const lines = overlayLines(
      { ...info, window: { center: 0.25, width: 1.5 } },
      { showPatientInfo: false },
    );
    expect(lines.bottomLeft[0]).toBe('W 1.5  L 0.3');
  });

  it('leaves out what the series does not say', () => {
    const lines = overlayLines(
      { ...info, seriesDescription: undefined, rows: undefined, columns: undefined },
      { showPatientInfo: false },
    );
    expect(lines.topLeft).toEqual([]);
    expect(lines.topRight).toEqual(['CT']);
  });
});

describe('describeOverlay', () => {
  const metadata: DicomJsonInstance = {
    '00280010': { vr: 'US', Value: [256] },
    '00280011': { vr: 'US', Value: [512] },
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JANE^^^' }] },
    '00100020': { vr: 'LO', Value: ['ID-7'] },
  };
  const view = {
    window: { center: 40, width: 400 },
    defaultWindow: { center: 40, width: 400 },
    invert: false,
    zoom: 1,
  };

  it('reads the size and the patient from the slice on screen', () => {
    expect(
      describeOverlay({
        modality: 'CT',
        seriesDescription: 'Chest',
        metadata,
        imageIndex: 0,
        imageCount: 3,
        view,
      }),
    ).toMatchObject({
      rows: 256,
      columns: 512,
      patientName: 'DOE JANE',
      patientId: 'ID-7',
      imageIndex: 0,
    });
  });

  it('copes with metadata that is not there, or not the shape DICOM JSON promises', () => {
    expect(
      describeOverlay({
        modality: 'CT',
        seriesDescription: undefined,
        metadata: { '00100010': { vr: 'PN', Value: [42] } },
        imageIndex: 0,
        imageCount: 1,
        view,
      }),
    ).toMatchObject({ rows: undefined, patientName: undefined, patientId: undefined });
  });
});

describe('the look of the overlay', () => {
  it('takes its font from the shell tokens, and falls back to the system font without them', () => {
    expect(OVERLAY_STYLE).toContain('var(--dv-font-family,system-ui');
  });

  it('keeps digits the same width, so the numbers do not jitter while the slices scroll', () => {
    expect(OVERLAY_STYLE).toContain('font-variant-numeric:tabular-nums');
  });
});

const tagInfo: OverlayInfo = {
  ...info,
  metadata: {
    '00180060': { vr: 'DS', Value: ['120'] },
    '00181151': { vr: 'IS', Value: [250.456] },
    '00080020': { vr: 'DA', Value: ['20240229'] },
    '00080031': { vr: 'TM', Value: ['134502.123'] },
    '00181030': { vr: 'LO', Value: ['CHEST', 'ROUTINE'] },
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JANE^^^' }] },
    '00100030': { vr: 'DA', Value: ['19800101'] },
    '00091001': { vr: 'LO', Value: ['private secret'] },
    '00080050': { vr: 'SH', Value: ['ACC-1'] },
    '00080090': { vr: 'PN', Value: [{ Alphabetic: 'ROE^RICHARD' }] },
  },
};

const tag = (id: string, spec: string, extra: object = {}): OverlayItemConfig => ({
  id,
  kind: 'tag',
  tag: spec,
  ...extra,
});

describe('overlay items', () => {
  it('show a tag of the image with a label, and format it', () => {
    const lines = overlayLines(tagInfo, {
      corners: {
        topRight: [
          tag('kvp', 'KVP', { label: 'kVp', format: 'number' }),
          tag('ma', 'XRayTubeCurrent', { label: 'mA', format: 'number', decimals: 1 }),
          tag('ma0', '00181151', { format: 'number', decimals: 0 }),
          tag('date', 'StudyDate', { format: 'date' }),
          tag('time', 'SeriesTime', { format: 'time' }),
          tag('protocol', 'ProtocolName'),
        ],
      },
    });
    expect(lines.topRight).toEqual([
      'CT',
      '512 × 512',
      'kVp 120',
      'mA 250.5',
      '250',
      '2024-02-29',
      '13:45:02',
      'CHEST ROUTINE',
    ]);
  });

  it('leave out a line the image has no value for, and a label with no value', () => {
    const lines = overlayLines(tagInfo, {
      corners: { topRight: [tag('te', 'EchoTime', { label: 'TE' }), tag('nope', '0099,0099')] },
    });
    expect(lines.topRight).toEqual(['CT', '512 × 512']);
  });

  it('take a line out, change one, and add one, by id', () => {
    const lines = overlayLines(info, {
      corners: {
        topRight: [{ id: 'size', remove: true }],
        bottomRight: [{ id: 'image', kind: 'builtin', name: 'modality' }],
        bottomLeft: [
          { id: 'zoom', remove: true },
          { id: 'inverted', remove: true },
        ],
      },
    });
    expect(lines.topRight).toEqual(['CT']);
    expect(lines.bottomRight).toEqual(['CT']);
    expect(lines.bottomLeft).toEqual(['W 400  L 40']);
  });

  it('never show a tag that can identify a patient unless asked to, whatever the items say', () => {
    const corners = {
      topLeft: [
        tag('name', 'PatientName', { format: 'person-name' }),
        tag('born', 'PatientBirthDate', { format: 'date' }),
        tag('acc', 'AccessionNumber'),
        tag('doctor', 'ReferringPhysicianName', { format: 'person-name' }),
        tag('private', '0009,1001'),
        tag('sample', 'PatientID'),
      ],
    };
    const hidden = JSON.stringify(overlayLines(tagInfo, { showPatientInfo: false, corners }));
    for (const secret of ['Jane', 'DOE', '1980', 'ACC-1', 'ROE', 'private secret']) {
      expect(hidden, secret).not.toContain(secret);
    }
    const shown = overlayLines(tagInfo, { showPatientInfo: true, corners });
    expect(shown.topLeft).toEqual(
      expect.arrayContaining(['DOE JANE', '1980-01-01', 'ACC-1', 'ROE RICHARD', 'private secret']),
    );
  });

  it('cut a long value, so a tag with a paragraph does not cover the picture', () => {
    const long: OverlayInfo = {
      ...info,
      metadata: { '00181030': { vr: 'LO', Value: ['x'.repeat(500)] } },
    };
    const [line] = overlayLines(long, {
      corners: { topLeft: [tag('p', 'ProtocolName')] },
    }).topLeft.slice(-1);
    expect(line?.length).toBe(120);
    expect(line?.endsWith('\u2026')).toBe(true);
  });
});

describe('the corners of the overlay', () => {
  it('tint the series line and keep the text exactly as overlayLines wrote it', () => {
    const element = document.createElement('div');
    const view = createOverlayView(element);
    view.update({
      topLeft: ['Chest 2.5 mm'],
      topRight: ['CT', '512 × 512'],
      bottomLeft: ['W 400  L 40'],
      bottomRight: ['Image 12 / 64'],
    });
    const corner = (name: string): HTMLElement | null =>
      element.querySelector<HTMLElement>(`[data-dv-corner="${name}"]`);
    expect(corner('top-left')?.style.color).toContain('--dv-color-overlay-accent');
    expect(corner('top-right')?.textContent).toBe('CT\n512 × 512');
    expect(corner('bottom-right')?.textContent).toBe('Image 12 / 64');
    view.destroy();
  });
});
