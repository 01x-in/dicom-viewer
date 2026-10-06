import type { Measurement, SegmentationInfo, Viewer, ViewerStateV1 } from '@scope/viewer-core';
import { type Context, createContext, useContext, useRef, useSyncExternalStore } from 'react';

/** The viewer of the nearest `<DicomViewer>`, once it is ready. Set by the component, not by hosts. */
export const ViewerContext: Context<Viewer | undefined> = createContext<Viewer | undefined>(
  undefined,
);

/**
 * The viewer of the enclosing `<DicomViewer>`: its panels, slots, and overlay are rendered inside
 * its tree, so they can call this. `undefined` until the viewer is ready, and again while it restarts.
 */
export function useViewer(): Viewer | undefined {
  return useContext(ViewerContext);
}

/**
 * A part of the viewer's state, re-read when it changes. `undefined` until the viewer is ready.
 * The selector must return a value that is the same when the state it reads is the same: a number,
 * a string, or a piece of the state, not a fresh object.
 */
export function useViewerState<T>(selector: (state: ViewerStateV1) => T): T | undefined {
  const viewer = useViewer();
  // One read per state object, so React's double check of the snapshot sees the same value.
  const cache = useRef<{ state: ViewerStateV1; selector: typeof selector; value: T } | undefined>(
    undefined,
  );
  const read = (): T | undefined => {
    if (viewer === undefined) return undefined;
    const state = viewer.getState();
    if (cache.current?.state === state && cache.current.selector === selector) {
      return cache.current.value;
    }
    const value = selector(state);
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(
    (notify) => {
      if (viewer === undefined) return () => undefined;
      return viewer.on('state:changed', notify);
    },
    read,
    () => undefined,
  );
}

const MEASUREMENT_EVENTS = [
  'measurement:added',
  'measurement:updated',
  'measurement:removed',
] as const;

/**
 * The measurements of the study on screen, re-read when one is added, changed, or removed, and when
 * another study is shown. `undefined` until the viewer is ready. Measurements of other studies are
 * kept by the viewer: `viewer.measurements.list()` has all of them.
 */
export function useMeasurements(): readonly Measurement[] | undefined {
  const viewer = useViewer();
  // One list per change, so React's double check of the snapshot sees the same array.
  const version = useRef(0);
  const cache = useRef<
    | { viewer: Viewer; version: number; study: string | undefined; value: readonly Measurement[] }
    | undefined
  >(undefined);
  const read = (): readonly Measurement[] | undefined => {
    if (viewer === undefined) return undefined;
    const study = viewer.getState().studyInstanceUID;
    if (
      cache.current?.viewer === viewer &&
      cache.current.version === version.current &&
      cache.current.study === study
    ) {
      return cache.current.value;
    }
    const value = study === undefined ? [] : viewer.measurements.list({ studyInstanceUID: study });
    cache.current = { viewer, version: version.current, study, value };
    return value;
  };
  return useSyncExternalStore(
    (notify) => {
      if (viewer === undefined) return () => undefined;
      let shown = viewer.getState().studyInstanceUID;
      const stops = [
        ...MEASUREMENT_EVENTS.map((event) =>
          viewer.on(event, () => {
            version.current += 1;
            notify();
          }),
        ),
        // The state changes at the pace of the mouse: only another study is news.
        viewer.on('state:changed', ({ state }) => {
          if (state.studyInstanceUID === shown) return;
          shown = state.studyInstanceUID;
          notify();
        }),
      ];
      return (): void => {
        for (const stop of stops) stop();
      };
    },
    read,
    () => undefined,
  );
}

const SEGMENTATION_EVENTS = [
  'segmentation:loaded',
  'segmentation:unloaded',
  'segmentation:updated',
] as const;

/**
 * The SEGs that are loaded, re-read when one is loaded, unloaded, or changed (shown, hidden,
 * recoloured, made more or less opaque, highlighted). They belong to the study on screen: loading
 * another study unloads them. `undefined` until the viewer is ready.
 */
export function useSegmentations(): readonly SegmentationInfo[] | undefined {
  const viewer = useViewer();
  // One list per change, so React's double check of the snapshot sees the same array.
  const version = useRef(0);
  const cache = useRef<
    { viewer: Viewer; version: number; value: readonly SegmentationInfo[] } | undefined
  >(undefined);
  const read = (): readonly SegmentationInfo[] | undefined => {
    if (viewer === undefined) return undefined;
    if (cache.current?.viewer === viewer && cache.current.version === version.current) {
      return cache.current.value;
    }
    const value = viewer.segmentations.list();
    cache.current = { viewer, version: version.current, value };
    return value;
  };
  return useSyncExternalStore(
    (notify) => {
      if (viewer === undefined) return () => undefined;
      const stops = SEGMENTATION_EVENTS.map((event) =>
        viewer.on(event, () => {
          version.current += 1;
          notify();
        }),
      );
      return (): void => {
        for (const stop of stops) stop();
      };
    },
    read,
    () => undefined,
  );
}
