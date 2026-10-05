import { describe, expect, it } from 'vitest';
import type { ViewSnapshot } from './rendering-port';
import { clampZoom, desiredView, MAX_ZOOM, MIN_ZOOM, sameWindow, viewChanges } from './view';

const view: ViewSnapshot = {
  window: { center: 40, width: 400 },
  defaultWindow: { center: 40, width: 400 },
  invert: false,
  zoom: 1,
};

describe('clampZoom', () => {
  it('keeps the zoom the engine can show', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });
});

describe('sameWindow', () => {
  it('ignores float noise from the center and range round trip', () => {
    expect(sameWindow({ center: 40, width: 400 }, { center: 40.0000000001, width: 400 })).toBe(
      true,
    );
    expect(sameWindow({ center: 40, width: 400 }, { center: 41, width: 400 })).toBe(false);
    expect(sameWindow({ center: 40, width: 400 }, undefined)).toBe(false);
    expect(sameWindow(undefined, undefined)).toBe(true);
  });
});

describe('viewChanges', () => {
  it('has nothing to say about a view that is the default', () => {
    expect(viewChanges({ id: 'vp-0' }, view)).toEqual({});
  });

  it('records what differs from the default, and nothing that does not', () => {
    const changed: ViewSnapshot = {
      ...view,
      window: { center: -600, width: 1500 },
      invert: true,
      zoom: 2,
    };
    expect(viewChanges({ id: 'vp-0' }, changed)).toEqual({
      window: { center: -600, width: 1500 },
      invert: true,
      zoom: 2,
    });
  });

  it('clears a field once the view is back at its default', () => {
    const state = { id: 'vp-0', window: { center: 1, width: 2 }, invert: true, zoom: 3 };
    expect(viewChanges(state, view)).toEqual({
      window: undefined,
      invert: undefined,
      zoom: undefined,
    });
  });

  it('leaves out a field whose value the state already has', () => {
    const state = { id: 'vp-0', window: { center: -600, width: 1500 }, zoom: 2 };
    const changed: ViewSnapshot = { ...view, window: { center: -600, width: 1500 }, zoom: 2 };
    expect(viewChanges(state, changed)).toEqual({});
  });
});

describe('desiredView', () => {
  it('fills what the state leaves out with the engine defaults', () => {
    expect(desiredView({ id: 'vp-0' }, view)).toEqual({
      window: view.defaultWindow,
      invert: false,
      zoom: 1,
    });
    expect(
      desiredView({ id: 'vp-0', window: { center: 1, width: 2 }, invert: true, zoom: 4 }, view),
    ).toEqual({ window: { center: 1, width: 2 }, invert: true, zoom: 4 });
  });
});
