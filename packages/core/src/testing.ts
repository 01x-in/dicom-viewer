import type { DataSource } from './data/types';
import {
  CT,
  CT_TWO_STACKS,
  type FakePort,
  type FakeSource,
  type FakeStackPort,
  fakePort,
  fakeSource,
  SEG,
  STUDY,
} from './testing/fakes';
import { createViewerCore, type Viewer, type ViewerCoreOptions } from './viewer-core';

export type { FakePort, FakeSource, FakeStackPort };

/** The study and series the fake source serves. */
export const FAKE_IDS: {
  readonly study: string;
  readonly ct: string;
  readonly ctTwoStacks: string;
  readonly seg: string;
} = { study: STUDY, ct: CT, ctTwoStacks: CT_TWO_STACKS, seg: SEG };

export interface FakeViewer {
  readonly viewer: Viewer;
  /** The engine behind the viewer: what it was asked to draw, and a way to simulate the mouse. */
  readonly port: FakePort;
  /** The data source behind the viewer: what it was asked for. */
  readonly source: FakeSource;
}

/**
 * A real viewer on a fake data source and a fake engine, for tests of a host or an adapter that
 * run without a browser engine, WebGL, or a server. The source has a 10-slice CT, a CT that splits
 * into stacks of 6 and 3, and a one-instance SEG (`FAKE_IDS`). Not part of the semver contract.
 */
export function createFakeViewer(
  options: Partial<Omit<ViewerCoreOptions, 'dataSource'>> = {},
): FakeViewer {
  const port = fakePort();
  const source: FakeSource = fakeSource();
  const dataSource: DataSource = source;
  const viewer = createViewerCore({ ...options, dataSource }, () => Promise.resolve(port));
  return { viewer, port, source };
}
