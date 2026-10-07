// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DicomJsonInstance } from './data/types';
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
