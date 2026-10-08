import { describe, expect, it } from 'vitest';
import { layoutViewportIds } from '../layouts';
import {
  createInitialState,
  parseViewerState,
  sameViewState,
  type ViewerStateV1,
  viewStatePatch,
} from './viewer-state';

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

  it.each(['1x2', '2x2', '1+3'] as const)(
    'accepts the layout %s and adds the viewports it shows',
    (layout) => {
      const result = parseViewerState({ ...full, layout });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.state.layout).toBe(layout);
      expect(result.state.viewports.map((viewport) => viewport.id)).toEqual(
        layoutViewportIds(layout),
      );
      // What the link said about vp-0 is kept.
      expect(result.state.viewports[0]).toEqual(full.viewports[0]);
    },
  );

  it('keeps the viewports a link gives for a bigger layout, in the layout order', () => {
    const result = parseViewerState({
      ...full,
      layout: '1x2',
      viewports: [{ id: 'vp-1', seriesInstanceUID: '1.2.9' }, { id: 'vp-0' }],
    });
    expect(result).toEqual({
      ok: true,
      state: {
        ...full,
        layout: '1x2',
        viewports: [{ id: 'vp-0' }, { id: 'vp-1', seriesInstanceUID: '1.2.9' }],
      },
    });
  });

  it.each([
    ['another version', { ...full, version: 2 }],
    ['no version', { layout: '1x1' }],
    ['a layout that does not exist', { ...full, layout: '3x3' }],
    [
      'a viewport the layout does not show',
      { ...full, layout: '1x2', viewports: [{ id: 'vp-0' }, { id: 'vp-2' }] },
    ],
    ['a study UID that is a path', { ...full, studyInstanceUID: '../../etc' }],
    [
      'a series UID with a query',
      { ...full, viewports: [{ id: 'vp-0', seriesInstanceUID: '1.2?x' }] },
    ],
    ['a negative image index', { ...full, viewports: [{ id: 'vp-0', imageIndex: -1 }] }],
    ['a fractional image index', { ...full, viewports: [{ id: 'vp-0', imageIndex: 1.5 }] }],
    [
      'a viewport id past vp-3',
      { ...full, layout: '2x2', viewports: [{ id: 'vp-0' }, { id: 'vp-4' }] },
    ],
    ['a viewport id outside vp-N', { ...full, viewports: [{ id: 'main' }] }],
    ['no viewports', { ...full, viewports: [] }],
    ['viewports without vp-0', { ...full, layout: '1x2', viewports: [{ id: 'vp-1' }] }],
    ['repeated viewport ids', { ...full, viewports: [{ id: 'vp-0' }, { id: 'vp-0' }] }],
    [
      'more than four viewports',
      {
        ...full,
        layout: '2x2',
        viewports: [0, 1, 2, 3, 4].map((n) => ({ id: `vp-${n.toString()}` })),
      },
    ],
    ['a non-object', 'nope'],
    ['null', null],
  ])('rejects %s', (_name, input) => {
    const result = parseViewerState(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe('the view of a viewport', () => {
  const withView = (view: object): unknown => ({
    ...full,
    viewports: [{ id: 'vp-0', ...view }],
  });

  it('accepts a window, an inversion, and a zoom', () => {
    const view = { window: { center: -600, width: 1500 }, invert: true, zoom: 2.5 };
    expect(parseViewerState(withView(view))).toEqual({
      ok: true,
      state: { ...full, viewports: [{ id: 'vp-0', ...view }] },
    });
  });

  it.each([
    ['a window with no width', { window: { center: 0, width: 0 } }],
    ['a window that is not finite', { window: { center: Number.POSITIVE_INFINITY, width: 1 } }],
    ['a zoom of zero', { zoom: 0 }],
    ['a zoom beyond what the viewer supports', { zoom: 64 }],
    ['an inversion that is not a boolean', { invert: 'yes' }],
  ])('rejects %s', (_name, view) => {
    expect(parseViewerState(withView(view)).ok).toBe(false);
  });
});

describe('viewStatePatch', () => {
  const state: ViewerStateV1 = {
    version: 1,
    studyInstanceUID: '1.2.3',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', seriesInstanceUID: '1.2.3.4', orientation: 'coronal', imageIndex: 3, zoom: 2 },
      { id: 'vp-1' },
    ],
  };

  it('is the layout and the viewports, without the study, which a page sets in its own way', () => {
    const patch = viewStatePatch(state);
    expect(patch.layout).toBe('1x2');
    expect(patch).not.toHaveProperty('studyInstanceUID');
    expect(patch.viewports.map((viewport) => viewport.id)).toEqual(['vp-0', 'vp-1']);
  });

  it('names every field of a viewport, so one the state leaves out is cleared', () => {
    const [first, second] = viewStatePatch(state).viewports;
    expect(first).toEqual({
      id: 'vp-0',
      seriesInstanceUID: '1.2.3.4',
      stackIndex: undefined,
      orientation: 'coronal',
      imageIndex: 3,
      window: undefined,
      invert: undefined,
      zoom: 2,
    });
    expect(Object.keys(second ?? {}).sort()).toEqual(
      [
        'id',
        'imageIndex',
        'invert',
        'orientation',
        'seriesInstanceUID',
        'stackIndex',
        'window',
        'zoom',
      ].sort(),
    );
  });
});

describe('sameViewState', () => {
  const base: ViewerStateV1 = {
    version: 1,
    studyInstanceUID: '1.2.3',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', seriesInstanceUID: '1.2.3.4', window: { center: 40, width: 400 } },
      { id: 'vp-1' },
    ],
  };

  it('is true for a copy, and for one with another study, which is not part of the view', () => {
    expect(sameViewState(base, structuredClone(base))).toBe(true);
    expect(sameViewState(base, { ...base, studyInstanceUID: '9.9' })).toBe(true);
  });

  it('is false for another layout, series, plane, slice, window, or zoom', () => {
    const [first, second] = base.viewports;
    if (first === undefined || second === undefined) throw new Error('fixture');
    expect(sameViewState(base, { ...base, layout: '2x2' })).toBe(false);
    for (const change of [
      { seriesInstanceUID: '1.2.3.5' },
      { orientation: 'axial' as const },
      { imageIndex: 1 },
      { window: { center: 40, width: 401 } },
      { zoom: 2 },
    ]) {
      expect(sameViewState(base, { ...base, viewports: [{ ...first, ...change }, second] })).toBe(
        false,
      );
    }
  });

  it('does not care in which order the keys of a viewport are written', () => {
    const other: ViewerStateV1 = {
      ...base,
      viewports: [
        { window: { width: 400, center: 40 }, seriesInstanceUID: '1.2.3.4', id: 'vp-0' },
        { id: 'vp-1' },
      ],
    };
    expect(sameViewState(base, other)).toBe(true);
  });
});
