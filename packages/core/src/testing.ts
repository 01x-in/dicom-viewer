import type { DataSource } from './data/types';
import {
  CT,
  CT_TWO_STACKS,
  FRAME_OF_REFERENCE,
  type FakePort,
  type FakeSource,
  type FakeStackPort,
  fakePort,
  fakeSource,
  NO_PIXELS,
  ONLY_SEG_STUDY,
  SEG,
  SEG_OFF,
  SEG_ON_SECOND_STACK,
  SEG_OVERLAP,
  SEG_SECOND,
  SEG_UNREADABLE,
  STUDY,
} from './testing/fakes';
import { createViewerCore, type Viewer, type ViewerCoreOptions } from './viewer-core';

export type { FakePort, FakeSource, FakeStackPort };

/** The study and series the fake source serves. */
export const FAKE_IDS: {
  readonly study: string;
  readonly ct: string;
  readonly ctTwoStacks: string;
  /** A SEG of `ct` with two segments, `Body` (1) and `Lesion` (2). */
  readonly seg: string;
  /** A second SEG of `ct`, with three segments. */
  readonly segSecond: string;
  /** A SEG of `ct` whose segments 1 and 2 share pixels, so it has two layers. */
  readonly segOverlap: string;
  /** A SEG of `ct` in another frame of reference, so it comes with a warning. */
  readonly segOff: string;
  /** A SEG of the second stack of `ctTwoStacks`, which has three images. */
  readonly segOnSecondStack: string;
  /** A SEG whose bytes cannot be read. */
  readonly segUnreadable: string;
  /** Not a SEG, but with nothing to show: automatic series choice has to skip it. */
  readonly noPixels: string;
  /** A study whose only series is the SEG: nothing in it can be shown. */
  readonly onlySegStudy: string;
  /** The frame of reference of every instance. */
  readonly frameOfReference: string;
} = {
  study: STUDY,
  ct: CT,
  ctTwoStacks: CT_TWO_STACKS,
  seg: SEG,
  segSecond: SEG_SECOND,
  segOverlap: SEG_OVERLAP,
  segOff: SEG_OFF,
  segOnSecondStack: SEG_ON_SECOND_STACK,
  segUnreadable: SEG_UNREADABLE,
  noPixels: NO_PIXELS,
  onlySegStudy: ONLY_SEG_STUDY,
  frameOfReference: FRAME_OF_REFERENCE,
};

export interface FakeViewer {
  readonly viewer: Viewer;
  /** The engine behind the viewer: what it was asked to draw, and a way to simulate the mouse. */
  readonly port: FakePort;
  /** The data source behind the viewer: what it was asked for. */
  readonly source: FakeSource;
}

/**
 * A real viewer on a fake data source and a fake engine, for tests of a host or an adapter that
 * run without a browser engine, WebGL, or a server. The source has a series with nothing to show, a 10-slice CT, a CT that splits
 * into stacks of 6 and 3, and several SEGs (`FAKE_IDS`). Not part of the semver contract.
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
