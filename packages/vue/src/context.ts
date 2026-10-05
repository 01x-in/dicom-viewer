import type { Measurement, Viewer, ViewerStateV1 } from '@scope/viewer-core';
import {
  type InjectionKey,
  inject,
  onScopeDispose,
  provide,
  type Ref,
  type ShallowRef,
  shallowRef,
  watch,
} from 'vue';

/** What `<DicomViewer>` provides to everything it renders: its viewer, once ready. */
export const ViewerKey: InjectionKey<Readonly<ShallowRef<Viewer | undefined>>> =
  Symbol('dicom-viewer');

/**
 * Shares a viewer ref with the components below. `<DicomViewer>` does this itself for its slots and
 * panels; call it only to build your own wrapper.
 */
export function provideViewer(viewer: Readonly<ShallowRef<Viewer | undefined>>): void {
  provide(ViewerKey, viewer);
}

/**
 * The viewer of the enclosing `<DicomViewer>`, as a ref that is `undefined` until the viewer is
 * ready and again while it restarts. The viewer is marked raw, so Vue never wraps it in a Proxy.
 */
export function useViewer(): Readonly<ShallowRef<Viewer | undefined>> {
  return inject(ViewerKey, shallowRef<Viewer | undefined>(undefined));
}

/**
 * A part of the viewer's state, as a ref that follows it. `undefined` until the viewer is ready.
 * The selector should return a primitive or a piece of the state, so the ref changes only when it did.
 */
export function useViewerState<T>(
  selector: (state: ViewerStateV1) => T,
): Readonly<Ref<T | undefined>> {
  const viewer = useViewer();
  const value = shallowRef<T | undefined>(undefined);
  watch(
    viewer,
    (current, _previous, onCleanup) => {
      if (current === undefined) {
        value.value = undefined;
        return;
      }
      value.value = selector(current.getState());
      const stop = current.on('state:changed', ({ state }) => {
        value.value = selector(state);
      });
      onCleanup(stop);
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    value.value = undefined;
  });
  return value;
}

const MEASUREMENT_EVENTS = [
  'measurement:added',
  'measurement:updated',
  'measurement:removed',
] as const;

/**
 * Every measurement the viewer holds, as a ref that follows it. `undefined` until the viewer is
 * ready. Filter by `reference.studyInstanceUID` to keep to one study. The list is shallow: the
 * measurements are plain data that is never changed in place.
 */
export function useMeasurements(): Readonly<Ref<readonly Measurement[] | undefined>> {
  const viewer = useViewer();
  const value = shallowRef<readonly Measurement[] | undefined>(undefined);
  watch(
    viewer,
    (current, _previous, onCleanup) => {
      if (current === undefined) {
        value.value = undefined;
        return;
      }
      value.value = current.measurements.list();
      const stops = MEASUREMENT_EVENTS.map((event) =>
        current.on(event, () => {
          value.value = current.measurements.list();
        }),
      );
      onCleanup(() => {
        for (const stop of stops) stop();
      });
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    value.value = undefined;
  });
  return value;
}
