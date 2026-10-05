import type { ViewSnapshot } from './rendering-port';
import type { ViewportStateV1, WindowLevel } from './state/viewer-state';

/** The range of zoom factors the viewer accepts. 1 fits the image to the viewport. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 32;

// The engine stores a window as a range, so a center and width that went in come back with
// rounding noise. Differences below this are not changes.
const EPSILON = 1e-6;

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

export function sameWindow(a: WindowLevel | undefined, b: WindowLevel | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a.center - b.center) < EPSILON && Math.abs(a.width - b.width) < EPSILON;
}

export function sameZoom(a: number | undefined, b: number): boolean {
  return a !== undefined && Math.abs(a - b) < EPSILON;
}

/**
 * What a viewport's state must record to match `view`. The state keeps only what differs from the
 * default, so a link stays short and a series keeps its own default window. Fields that already
 * match are left out, so applying the result changes nothing that did not change.
 */
export function viewChanges(
  current: ViewportStateV1,
  view: ViewSnapshot,
): Partial<ViewportStateV1> {
  const changes: {
    window?: WindowLevel | undefined;
    invert?: boolean | undefined;
    zoom?: number | undefined;
  } = {};
  const window = sameWindow(view.window, view.defaultWindow) ? undefined : view.window;
  if (!sameWindow(current.window, window)) changes.window = window;
  const invert = view.invert ? true : undefined;
  if (current.invert !== invert) changes.invert = invert;
  const zoom = sameZoom(view.zoom, 1) ? undefined : view.zoom;
  if (zoom === undefined ? current.zoom !== undefined : !sameZoom(current.zoom, zoom)) {
    changes.zoom = zoom;
  }
  return changes;
}

/** What the state asks the engine to show, with the defaults filled in. */
export function desiredView(
  state: ViewportStateV1,
  view: ViewSnapshot,
): { window: WindowLevel; invert: boolean; zoom: number } {
  return {
    window: state.window ?? view.defaultWindow,
    invert: state.invert ?? false,
    zoom: state.zoom ?? 1,
  };
}
