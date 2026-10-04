import { describe, expect, it } from 'vitest';
import { createInitialState, parseViewerState, type ViewerStateV1 } from './viewer-state';

const full: ViewerStateV1 = {
  version: 1,
  studyInstanceUID: '1.2.3',
  layout: '1x1',
  viewports: [{ id: 'vp-0', seriesInstanceUID: '1.2.3.4', stackIndex: 1, imageIndex: 12 }],
};

describe('createInitialState', () => {
  it('has one empty viewport and no study', () => {
    expect(createInitialState()).toEqual({
      version: 1,
      layout: '1x1',
      viewports: [{ id: 'vp-0' }],
    });
  });
});

describe('parseViewerState', () => {
  it('accepts a full state, and returns it unchanged', () => {
    const result = parseViewerState(full);
    expect(result).toEqual({ ok: true, state: full });
  });

  it('strips unknown keys, so a newer writer can add fields', () => {
    const result = parseViewerState({ ...full, theme: 'light' });
    expect(result).toEqual({ ok: true, state: full });
  });

  it('defaults a missing layout and viewport list', () => {
    expect(parseViewerState({ version: 1 })).toEqual({
      ok: true,
      state: createInitialState(),
    });
  });

  it.each([
    ['another version', { ...full, version: 2 }],
    ['no version', { layout: '1x1' }],
    ['a layout this version cannot show', { ...full, layout: '2x2' }],
    ['a study UID that is a path', { ...full, studyInstanceUID: '../../etc' }],
    [
      'a series UID with a query',
      { ...full, viewports: [{ id: 'vp-0', seriesInstanceUID: '1.2?x' }] },
    ],
    ['a negative image index', { ...full, viewports: [{ id: 'vp-0', imageIndex: -1 }] }],
    ['a fractional image index', { ...full, viewports: [{ id: 'vp-0', imageIndex: 1.5 }] }],
    ['a viewport id past vp-3', { ...full, viewports: [{ id: 'vp-0' }, { id: 'vp-4' }] }],
    ['a viewport id outside vp-N', { ...full, viewports: [{ id: 'main' }] }],
    ['no viewports', { ...full, viewports: [] }],
    ['viewports without vp-0', { ...full, viewports: [{ id: 'vp-1' }] }],
    ['repeated viewport ids', { ...full, viewports: [{ id: 'vp-0' }, { id: 'vp-0' }] }],
    [
      'more than four viewports',
      { ...full, viewports: [0, 1, 2, 3, 4].map((n) => ({ id: `vp-${n.toString()}` })) },
    ],
    ['a non-object', 'nope'],
    ['null', null],
  ])('rejects %s', (_name, input) => {
    const result = parseViewerState(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
