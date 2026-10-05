import type { Viewer, ViewerStateV1 } from '@scope/viewer-core';
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
