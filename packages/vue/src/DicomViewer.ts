import type {
  CommandInput,
  NavigateTarget,
  PanelPlacement,
  Viewer,
  ViewerConfigV1,
  ViewerOptions,
  ViewerStateV1,
  ViewportApi,
} from '@scope/viewer-core';
import type {
  DvViewerElement,
  PaletteName,
  ThemeName,
  ToolbarLabels,
  ToolbarItem,
  ViewerErrorDetail,
  ViewerReadyDetail,
} from '@scope/viewer-elements';
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
  Teleport,
  toRaw,
  type VNodeChild,
  watch,
} from 'vue';
import { provideViewer } from './context';

/** A side panel of the host's own. Its content is the slot `panel-<id>`. */
export interface VuePanel {
  readonly id: string;
  readonly title: string;
  /** The name of one of the shell's pictures for the tab. Without one the tab shows its title only. */
  readonly icon?: string;
  /** Default `right`. */
  readonly placement?: PanelPlacement;
}

export interface DicomViewerProps {
  /** A new object restarts the viewer: keep it stable. `initialState` is merged into it when the viewer starts. */
  readonly options: ViewerOptions;
  readonly studyInstanceUid: string;
  /** Default: the series a restored `initialState` had, else the first with pictures. */
  readonly seriesInstanceUid?: string;
  /** Shows an instance, now and whenever the target changes, once the viewer is ready. */
  readonly navigate?: NavigateTarget;
  /** Read when the viewer starts. */
  readonly initialState?: ViewerStateV1;
  /** Items for the toolbar, or `false` for none. */
  readonly toolbar?: readonly ToolbarItem[] | false;
  /** Extra side panels. Each one's content is the slot `panel-<id>`. The series browser, the measurements list, and the segments list are built in. */
  readonly panels?: readonly VuePanel[];
  readonly hideSeriesPanel?: boolean;
  /** Hides the built-in list of measurements, a tab in the right-hand dock. */
  readonly hideMeasurementsPanel?: boolean;
  /** Hides the built-in list of SEGs and their segments, a tab in the right-hand dock. */
  readonly hideSegmentationsPanel?: boolean;
  readonly theme?: ThemeName;
  /** The colours of the chrome: `default`, `navy`, or `graphite`. */
  readonly palette?: PaletteName;
  /** `tooltip` (default): buttons show a picture, and the name in a tooltip. `inline`: the name beside the picture. */
  readonly toolbarLabels?: ToolbarLabels;
  /**
   * Settings as data: a `ViewerConfigV1`, or several (the last one wins). The props `theme`,
   * `palette`, and `toolbar` win over it. A config with a problem is refused whole and reported
   * as an `error` event.
   */
  readonly config?: ViewerConfigV1 | readonly ViewerConfigV1[];
  /** A config file to fetch. Off unless `configOrigins` lists its origin; see `<dv-viewer config-url>`. */
  readonly configUrl?: string;
  /** The origins `configUrl` may be on. */
  readonly configOrigins?: readonly string[];
  /** Commands of your own, for a config to name. */
  readonly commands?: Readonly<Record<string, CommandInput>>;
  readonly onReady?: (viewer: Viewer, viewport: ViewportApi | undefined) => void;
  readonly onError?: (error: Error) => void;
  readonly onStateChange?: (state: ViewerStateV1, origin: string) => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const SLOTS = [
  ['banner', 'banner'],
  ['toolbar-start', 'toolbar-start'],
  ['toolbar-end', 'toolbar-end'],
  ['panel-left', 'panel-left'],
  ['panel-right', 'panel-right'],
  ['viewport-overlay', 'viewport-overlay'],
  ['empty-state', 'empty-state'],
] as const;

/**
 * The styled viewer for Vue and Nuxt: `<dv-viewer>` with props, emits, and slots. The element and
 * the engine load in `onMounted`, so server rendering never runs them. The viewer is held in a
 * `shallowRef` and marked raw, so Vue never wraps it, or anything Cornerstone-related, in a Proxy.
 *
 * Slots: `banner`, `toolbar-start`, `toolbar-end`, `panel-left`, `panel-right` (plain content beside the
 * tabbed panels), `viewport-overlay`, `empty-state`, and
 * `panel-<id>` for each entry of `panels` (a panel with the id `left` or `right` takes that plain slot over).
 */
export const DicomViewer: Component<DicomViewerProps> = defineComponent({
  name: 'DicomViewer',
  props: {
    options: { type: Object as PropType<ViewerOptions>, required: true },
    studyInstanceUid: { type: String, required: true },
    seriesInstanceUid: { type: String, default: undefined },
    navigate: { type: Object as PropType<NavigateTarget>, default: undefined },
    initialState: { type: Object as PropType<ViewerStateV1>, default: undefined },
    toolbar: {
      type: [Array, Boolean] as PropType<readonly ToolbarItem[] | false>,
      default: undefined,
    },
    panels: { type: Array as PropType<readonly VuePanel[]>, default: undefined },
    hideSeriesPanel: { type: Boolean, default: false },
    hideMeasurementsPanel: { type: Boolean, default: false },
    hideSegmentationsPanel: { type: Boolean, default: false },
    theme: { type: String as PropType<ThemeName>, default: undefined },
    palette: { type: String as PropType<PaletteName>, default: undefined },
    toolbarLabels: { type: String as PropType<ToolbarLabels>, default: undefined },
    config: {
      type: [Object, Array] as PropType<ViewerConfigV1 | readonly ViewerConfigV1[]>,
      default: undefined,
    },
    commands: {
      type: Object as PropType<Readonly<Record<string, CommandInput>>>,
      default: undefined,
    },
    configUrl: { type: String, default: undefined },
    configOrigins: { type: Array as PropType<readonly string[]>, default: undefined },
  },
  // Payloads: ready(viewer, viewport), error(error), state-change(state, origin).
  emits: ['ready', 'error', 'state-change'],
  setup(props, { emit, slots }) {
    const element = ref<DvViewerElement | null>(null);
    const viewer = shallowRef<Viewer | undefined>(undefined);
    const defined = ref(false);
    const containers = shallowRef<ReadonlyMap<string, HTMLElement>>(new Map());
    provideViewer(viewer);

    let unmounted = false;
    let stopState: (() => void) | undefined;
    let removePanels: (() => void)[] = [];

    function apply(): void {
      const target = element.value;
      if (!defined.value || target === null) return;
      const options = toRaw(props.options);
      const initialState = props.initialState === undefined ? undefined : toRaw(props.initialState);
      target.options = initialState === undefined ? options : { ...options, initialState };
      target.config = props.config === undefined ? undefined : toRaw(props.config);
      target.commands = props.commands === undefined ? undefined : toRaw(props.commands);
      target.configUrl = props.configUrl;
      target.configOrigins =
        props.configOrigins === undefined ? undefined : toRaw(props.configOrigins);
      target.studyInstanceUid = props.studyInstanceUid;
      target.seriesInstanceUid = props.seriesInstanceUid;
    }

    function applyAppearance(): void {
      const target = element.value;
      if (!defined.value || target === null) return;
      target.theme = props.theme;
      target.palette = props.palette;
      target.hideToolbar = props.toolbar === false;
      target.toolbarLabels = props.toolbarLabels;
      target.toolbarItems =
        props.toolbar === undefined || props.toolbar === false ? undefined : toRaw(props.toolbar);
      target.hideSeriesPanel = props.hideSeriesPanel === true;
      target.hideMeasurementsPanel = props.hideMeasurementsPanel === true;
      target.hideSegmentationsPanel = props.hideSegmentationsPanel === true;
    }

    function stopWatching(): void {
      stopState?.();
      stopState = undefined;
      for (const remove of removePanels.splice(0)) remove();
    }

    function registerPanels(current: Viewer): void {
      for (const remove of removePanels.splice(0)) remove();
      removePanels = (props.panels ?? []).map((panel) =>
        current.ui.registerPanel({
          id: panel.id,
          title: panel.title,
          ...(panel.icon === undefined ? {} : { icon: panel.icon }),
          placement: panel.placement ?? 'right',
          mount: (container) => {
            containers.value = new Map(containers.value).set(panel.id, container);
            return (): void => {
              const next = new Map(containers.value);
              next.delete(panel.id);
              containers.value = next;
            };
          },
        }),
      );
    }

    const onReady = (event: Event): void => {
      const detail = (event as CustomEvent<ViewerReadyDetail>).detail;
      const ready = markRaw(detail.viewer);
      viewer.value = ready;
      stopWatching();
      stopState = ready.on('state:changed', ({ state, origin }) => {
        emit('state-change', state, origin);
      });
      registerPanels(ready);
      emit('ready', ready, detail.viewport === undefined ? undefined : markRaw(detail.viewport));
    };
    const onTeardown = (): void => {
      stopWatching();
      viewer.value = undefined;
    };
    const onError = (event: Event): void => {
      emit('error', (event as CustomEvent<ViewerErrorDetail>).detail.error);
    };

    onMounted(() => {
      import('@scope/viewer-elements/define').then(
        () => {
          if (unmounted) return;
          defined.value = true;
        },
        (error: unknown) => {
          if (!unmounted) emit('error', toError(error));
        },
      );
    });

    watch(
      () => [defined.value, element.value] as const,
      ([isDefined, target], _previous, onCleanup) => {
        if (!isDefined || target === null) return;
        target.addEventListener('dv-ready', onReady);
        target.addEventListener('dv-teardown', onTeardown);
        target.addEventListener('dv-error', onError);
        onCleanup(() => {
          target.removeEventListener('dv-ready', onReady);
          target.removeEventListener('dv-teardown', onTeardown);
          target.removeEventListener('dv-error', onError);
        });
      },
      { flush: 'post' },
    );
    // The listeners are on before the inputs are set, so the first `dv-ready` is not missed.
    watch(
      [
        defined,
        () => props.options,
        () => props.config,
        () => props.commands,
        () => props.configUrl,
        () => props.configOrigins,
        () => props.studyInstanceUid,
        () => props.seriesInstanceUid,
      ],
      apply,
      { flush: 'post' },
    );
    watch(
      [
        defined,
        () => props.theme,
        () => props.palette,
        () => props.toolbar,
        () => props.toolbarLabels,
        () => props.hideSeriesPanel,
        () => props.hideMeasurementsPanel,
        () => props.hideSegmentationsPanel,
      ],
      applyAppearance,
      {
        flush: 'post',
      },
    );
    watch(
      () =>
        (props.panels ?? [])
          .map(
            (panel) =>
              `${panel.id}|${panel.title}|${panel.placement ?? 'right'}|${panel.icon ?? ''}`,
          )
          .join(),
      () => {
        if (viewer.value !== undefined) registerPanels(viewer.value);
      },
    );
    watch(
      () =>
        [
          viewer.value,
          props.navigate?.seriesInstanceUID,
          props.navigate?.sopInstanceUID,
          props.navigate?.frameNumber,
          props.navigate?.viewportId,
        ] as const,
      ([current]) => {
        const target = props.navigate === undefined ? undefined : toRaw(props.navigate);
        if (current === undefined || target === undefined) return;
        current.navigateTo(target).catch((error: unknown) => {
          emit('error', toError(error));
        });
      },
    );

    onBeforeUnmount(() => {
      unmounted = true;
      stopWatching();
    });

    return () => {
      const children: VNodeChild[] = [];
      const panelSlots = new Set((props.panels ?? []).map((panel) => `panel-${panel.id}`));
      for (const [slotName, name] of SLOTS) {
        // A panel with the id `left` owns the slot `panel-left`: it is not also plain content.
        if (panelSlots.has(slotName)) continue;
        const content = slots[slotName]?.();
        if (content !== undefined && content.length > 0) {
          children.push(h('div', { slot: name, key: name }, content));
        }
      }
      for (const panel of props.panels ?? []) {
        const container = containers.value.get(panel.id);
        const content = slots[`panel-${panel.id}`]?.();
        if (container !== undefined && content !== undefined) {
          children.push(h(Teleport, { to: container, key: `panel-${panel.id}` }, content));
        }
      }
      return h(
        'dv-viewer',
        { ref: element, style: 'display:block;width:100%;height:100%' },
        children,
      );
    };
  },
});
