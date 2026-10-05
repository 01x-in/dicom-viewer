import { afterEach } from 'vitest';
import {
  createViewerCore,
  type Viewer,
  type ViewerCoreOptions,
  type ViewerEvents,
} from '../viewer-core';
import type { ViewerStateV1, ViewportStateV1 } from '../state/viewer-state';
import { fakePort, fakeSource, type FakePort, type FakeSource } from './fakes';

export interface Harness {
  readonly viewer: Viewer;
  readonly port: FakePort;
  readonly source: FakeSource;
  readonly element: HTMLElement;
  readonly events: { [K in keyof ViewerEvents]: ViewerEvents[K][] };
}

const open: Viewer[] = [];

/** A viewer on a fake source and a fake engine, recording every event it emits. Needs jsdom. */
export function harness(
  options: { initialState?: ViewerStateV1; viewer?: Partial<ViewerCoreOptions> } = {},
): Harness {
  const port = fakePort();
  const source = fakeSource();
  const viewer = createViewerCore(
    {
      dataSource: source,
      ...(options.initialState === undefined ? {} : { initialState: options.initialState }),
      ...options.viewer,
    },
    () => Promise.resolve(port),
  );
  open.push(viewer);
  const events: Harness['events'] = {
    'study:loaded': [],
    'viewport:image': [],
    'viewport:voi': [],
    'viewport:camera': [],
    'tool:active': [],
    'viewport:cine': [],
    'ui:panels': [],
    'state:changed': [],
    error: [],
  };
  viewer.on('study:loaded', (event) => events['study:loaded'].push(event));
  viewer.on('viewport:image', (event) => events['viewport:image'].push(event));
  viewer.on('viewport:voi', (event) => events['viewport:voi'].push(event));
  viewer.on('viewport:camera', (event) => events['viewport:camera'].push(event));
  viewer.on('viewport:cine', (event) => events['viewport:cine'].push(event));
  viewer.on('tool:active', (event) => events['tool:active'].push(event));
  viewer.on('ui:panels', (event) => events['ui:panels'].push(event));
  viewer.on('state:changed', (event) => events['state:changed'].push(event));
  viewer.on('error', (event) => events.error.push(event));
  return { viewer, port, source, element: document.createElement('div'), events };
}

/** Registers the cleanup that destroys every viewer a test made. Call it once per test file. */
export function destroyViewersAfterEach(): void {
  afterEach(() => {
    for (const viewer of open.splice(0)) viewer.destroy();
  });
}

/** Track a viewer made by hand, so it is destroyed after the test. */
export function track(viewer: Viewer): Viewer {
  open.push(viewer);
  return viewer;
}

export const vp0 = (viewer: Viewer): ViewportStateV1 | undefined => viewer.getState().viewports[0];
