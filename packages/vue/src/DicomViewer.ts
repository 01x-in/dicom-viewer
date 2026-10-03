import { createViewer, type LoadedSeries, type ViewerOptions } from '@scope/viewer-core';
import {
  type Component,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  watch,
} from 'vue';

export interface DicomViewerProps {
  readonly options: ViewerOptions;
  readonly studyInstanceUid: string;
  readonly seriesInstanceUid: string;
}

/**
 * M1 spike of the Vue adapter. The viewer lives in a plain variable, never a `ref`, so Vue does not
 * wrap Cornerstone objects in Proxies. It is created in `onMounted`, so SSR (Nuxt) never runs it.
 */
export const DicomViewer: Component<DicomViewerProps> = defineComponent({
  name: 'DicomViewer',
  props: {
    options: { type: Object as PropType<ViewerOptions>, required: true },
    studyInstanceUid: { type: String, required: true },
    seriesInstanceUid: { type: String, required: true },
  },
  emits: {
    ready: (series: LoadedSeries): boolean => series.imageCount > 0,
    error: (error: Error): boolean => error instanceof Error,
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement | null>(null);
    let stop: (() => void) | undefined;

    function start(element: HTMLElement): void {
      stop?.();
      let cancelled = false;
      const viewer = createViewer(props.options);
      viewer.loadSeries(element, props.studyInstanceUid, props.seriesInstanceUid).then(
        (series) => {
          if (!cancelled) emit('ready', series);
        },
        (error: unknown) => {
          if (!cancelled) emit('error', error instanceof Error ? error : new Error(String(error)));
        },
      );
      stop = (): void => {
        cancelled = true;
        viewer.destroy();
      };
    }

    onMounted(() => {
      if (host.value !== null) start(host.value);
    });
    watch(
      () => [props.studyInstanceUid, props.seriesInstanceUid],
      () => {
        if (host.value !== null) start(host.value);
      },
    );
    onBeforeUnmount(() => {
      stop?.();
    });

    return () => h('div', { ref: host, style: 'width:100%;height:100%' });
  },
});
