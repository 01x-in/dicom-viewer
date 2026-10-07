import { describe, expect, it } from 'vitest';
import { hasSeriesDrag, readSeriesDrag, SERIES_DRAG_TYPE, seriesDragData } from './series-drag';

const study = '1.2.840.113619.2.1';
const series = '1.2.840.113619.2.1.7';

describe('the series drag payload', () => {
  it('uses one custom type, so nothing else on the page takes it for text', () => {
    expect(SERIES_DRAG_TYPE).toBe('application/x-dv-series');
  });

  it('round-trips a series and its study', () => {
    expect(readSeriesDrag(seriesDragData(study, series))).toEqual({
      studyInstanceUID: study,
      seriesInstanceUID: series,
    });
  });

  it.each([
    ['text that is not JSON', 'nope'],
    ['an empty string', ''],
    ['JSON that is not an object', '[1,2]'],
    ['a missing series', JSON.stringify({ studyInstanceUID: study })],
    ['a missing study', JSON.stringify({ seriesInstanceUID: series })],
    [
      'a series that is a path',
      JSON.stringify({ studyInstanceUID: study, seriesInstanceUID: '../x' }),
    ],
    [
      'a study with a query',
      JSON.stringify({ studyInstanceUID: '1.2?x', seriesInstanceUID: series }),
    ],
    ['numbers for UIDs', JSON.stringify({ studyInstanceUID: 1, seriesInstanceUID: 2 })],
    ['a payload far too long', 'x'.repeat(5000)],
  ])('refuses %s, since a drop can come from any page', (_name, text) => {
    expect(readSeriesDrag(text)).toBeUndefined();
  });
});

describe('hasSeriesDrag', () => {
  it('is true when the dragged data has the custom type, even before it can be read', () => {
    expect(hasSeriesDrag({ types: ['text/plain', SERIES_DRAG_TYPE] })).toBe(true);
  });

  it('is false for files, text, and nothing', () => {
    expect(hasSeriesDrag({ types: ['Files'] })).toBe(false);
    expect(hasSeriesDrag({ types: ['text/plain'] })).toBe(false);
    expect(hasSeriesDrag(null)).toBe(false);
    expect(hasSeriesDrag(undefined)).toBe(false);
  });
});
