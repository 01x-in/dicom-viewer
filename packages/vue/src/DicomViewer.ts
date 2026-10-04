import {
  createViewer,
  type Viewer,
  type ViewerOptions,
  type ViewportApi,
} from '@scope/viewer-core';
import {
  type Component,
  defineComponent,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  shallowRef,
  watch,
} from 'vue';

export interface DicomViewerProps {
  readonly options: ViewerOptions;
  readonly studyInstanceUid: string;
  readonly seriesInstanceUid: string;
}

/**
 * M1 spike of the Vue adapter. The viewer is held in a `shallowRef` and marked raw, so Vue never
 * wraps it or anything Cornerstone-related in a Proxy. It is created in `onMounted`, so SSR (Nuxt)
 * never runs it. A new `options` object restarts the viewer: keep it stable in the host.
 */
export const DicomViewer: Component<DicomViewerProps> = defineComponent({
  name: 'DicomViewer',
  props: {
    options: { type: Object as PropType<ViewerOptions>, required: true },
    studyInstanceUid: { type: String, required: true },
    seriesInstanceUid: { type: String, required: true },
  },
  emits: {
    ready: (viewport: ViewportApi): boolean => viewport.imageCount > 0,
    error: (error: Error): boolean => error instanceof Error,
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement | null>(null);
    const viewer = shallowRef<Viewer | undefined>(undefined);
    let cancel: (() => void) | undefined;

    function start(element: HTMLElement): void {
      stop();
      let cancelled = false;
      const created = markRaw(createViewer(props.options));
      viewer.value = created;
      created.viewports.attach('vp-0', element);
      created
        .setState({
          studyInstanceUID: props.studyInstanceUid,
          viewports: [{ id: 'vp-0', seriesInstanceUID: props.seriesInstanceUid }],
        })
        .then(
          () => {
            const viewport = created.viewports.get('vp-0');
            if (!cancelled && viewport !== undefined) emit('ready', markRaw(viewport));
          },
          (error: unknown) => {
            if (!cancelled)
              emit('error', error instanceof Error ? error : new Error(String(error)));
          },
        );
      cancel = (): void => {
        cancelled = true;
      };
    }

    function stop(): void {
      cancel?.();
      cancel = undefined;
      viewer.value?.destroy();
      viewer.value = undefined;
    }

    onMounted(() => {
      if (host.value !== null) start(host.value);
    });
    watch(
      () => [props.options, props.studyInstanceUid, props.seriesInstanceUid],
      () => {
        if (host.value !== null) start(host.value);
      },
    );
    onBeforeUnmount(stop);

    return () => h('div', { ref: host, style: 'width:100%;height:100%' });
  },
});
