import type {
  NavigateTarget,
  PanelPlacement,
  Viewer,
  ViewerOptions,
  ViewerStateV1,
  ViewportApi,
} from '@scope/viewer-core';
import type {
  DvViewerElement,
  ThemeName,
  ToolbarItem,
  ViewerErrorDetail,
  ViewerReadyDetail,
} from '@scope/viewer-elements';
import {
  createElement,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ViewerContext } from './context';

/** A side panel written in React. It is drawn into a portal, so it keeps the host's context. */
export interface ReactPanel {
  readonly title: string;
  /** Default `right`. */
  readonly placement?: PanelPlacement;
  readonly render: () => ReactNode;
}

export interface DicomViewerProps {
  /**
   * A new object restarts the viewer: keep it stable (`useMemo`, or a module constant). `initialState`
   * is merged into it when the viewer starts.
   */
  readonly options: ViewerOptions;
  readonly studyInstanceUID: string;
  /** Default: the series a restored `initialState` had, else the first with pictures. */
  readonly seriesInstanceUID?: string | undefined;
  /** Shows an instance, now and whenever the target changes, once the viewer is ready. */
  readonly navigate?: NavigateTarget | undefined;
  /** Read when the viewer starts. Later changes are ignored: use the viewer's API to change the view. */
  readonly initialState?: ViewerStateV1 | undefined;
  /** Called after every change of the state, with who made it. */
  readonly onStateChange?: ((state: ViewerStateV1, origin: string) => void) | undefined;
  /** Items for the toolbar, or `false` for none. Default: the built-in tools, actions and presets. */
  readonly toolbar?: readonly ToolbarItem[] | false | undefined;
  /** Extra side panels, by id. The series browser is built in. */
  readonly panels?: Readonly<Record<string, ReactPanel>> | undefined;
  readonly hideSeriesPanel?: boolean | undefined;
  readonly theme?: ThemeName | undefined;
  /** Slots of the shell. `panelLeft` and `panelRight` are plain content beside the tabbed panels. */
  readonly banner?: ReactNode;
  readonly panelLeft?: ReactNode;
  readonly panelRight?: ReactNode;
  readonly toolbarStart?: ReactNode;
  readonly toolbarEnd?: ReactNode;
  readonly viewportOverlay?: ReactNode;
  readonly emptyState?: ReactNode;
  /** Set to the viewer when it is ready, and to `null` when it goes. */
  readonly viewerRef?: Ref<Viewer | null> | undefined;
  readonly onReady?: ((viewer: Viewer, viewport: ViewportApi | undefined) => void) | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (typeof ref === 'function') ref(value);
  else if (ref !== undefined && ref !== null) ref.current = value;
}

function targetKey(target: NavigateTarget | undefined): string {
  return target === undefined
    ? ''
    : JSON.stringify([
        target.seriesInstanceUID,
        target.sopInstanceUID,
        target.frameNumber,
        target.viewportId,
      ]);
}

/**
 * The styled viewer for React: `<dv-viewer>` with React props and slots. Nothing touches the browser
 * during server rendering, so Next.js hosts need no `dynamic(..., { ssr: false })`: the element and
 * the engine are loaded in an effect.
 */
export function DicomViewer(props: DicomViewerProps): JSX.Element {
  const { options, studyInstanceUID, seriesInstanceUID, className, style, theme } = props;
  const elementRef = useRef<DvViewerElement | null>(null);
  // Callbacks and render functions change identity every render; nothing may restart for them.
  const latest = useRef(props);
  latest.current = props;
  const [defined, setDefined] = useState(false);
  const [viewer, setViewer] = useState<Viewer | undefined>(undefined);
  const [containers, setContainers] = useState<ReadonlyMap<string, HTMLElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    import('@scope/viewer-elements/define').then(
      () => {
        if (!cancelled) setDefined(true);
      },
      (error: unknown) => {
        if (!cancelled) {
          latest.current.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, []);

  // The inputs go in together, so the element starts once.
  useEffect(() => {
    const element = elementRef.current;
    if (!defined || element === null) return;
    const { initialState } = latest.current;
    element.options = initialState === undefined ? options : { ...options, initialState };
    element.studyInstanceUid = studyInstanceUID;
    element.seriesInstanceUid = seriesInstanceUID;
  }, [defined, options, studyInstanceUID, seriesInstanceUID]);

  const { toolbar, hideSeriesPanel } = props;
  useEffect(() => {
    const element = elementRef.current;
    if (!defined || element === null) return;
    element.theme = theme ?? 'dark';
    element.hideToolbar = toolbar === false;
    element.toolbarItems = toolbar === undefined || toolbar === false ? undefined : toolbar;
    element.hideSeriesPanel = hideSeriesPanel === true;
  }, [defined, theme, toolbar, hideSeriesPanel]);

  useEffect(() => {
    const element = elementRef.current;
    if (!defined || element === null) return;
    const onReady = (event: Event): void => {
      const { viewer: ready, viewport } = (event as CustomEvent<ViewerReadyDetail>).detail;
      setViewer(ready);
      latest.current.onReady?.(ready, viewport);
    };
    const onTeardown = (): void => {
      setViewer(undefined);
    };
    const onError = (event: Event): void => {
      latest.current.onError?.((event as CustomEvent<ViewerErrorDetail>).detail.error);
    };
    element.addEventListener('dv-ready', onReady);
    element.addEventListener('dv-teardown', onTeardown);
    element.addEventListener('dv-error', onError);
    return (): void => {
      element.removeEventListener('dv-ready', onReady);
      element.removeEventListener('dv-teardown', onTeardown);
      element.removeEventListener('dv-error', onError);
    };
  }, [defined]);

  // The ref holds the viewer while there is one. A different ref gets it, and the old one lets go.
  const { viewerRef } = props;
  useEffect(() => {
    if (viewer === undefined) return;
    assignRef(viewerRef, viewer);
    return (): void => {
      assignRef(viewerRef, null);
    };
  }, [viewer, viewerRef]);

  useEffect(() => {
    if (viewer === undefined) return;
    return viewer.on('state:changed', ({ state, origin }) => {
      latest.current.onStateChange?.(state, origin);
    });
  }, [viewer]);

  const navigateKey = targetKey(props.navigate);
  useEffect(() => {
    const target = latest.current.navigate;
    if (viewer === undefined || target === undefined) return;
    viewer.navigateTo(target).catch((error: unknown) => {
      latest.current.onError?.(error instanceof Error ? error : new Error(String(error)));
    });
  }, [viewer, navigateKey]);

  // Panels are registered by id, title, and side. Their content is a portal, drawn again on every render.
  const panelKey = JSON.stringify(
    Object.entries(props.panels ?? {}).map(([id, panel]) => [
      id,
      panel.title,
      panel.placement ?? 'right',
    ]),
  );
  useEffect(() => {
    if (viewer === undefined) return;
    const removers = Object.entries(latest.current.panels ?? {}).map(([id, panel]) =>
      viewer.ui.registerPanel({
        id,
        title: panel.title,
        placement: panel.placement ?? 'right',
        mount: (container) => {
          setContainers((current) => new Map(current).set(id, container));
          return (): void => {
            setContainers((current) => {
              const next = new Map(current);
              next.delete(id);
              return next;
            });
          };
        },
      }),
    );
    return (): void => {
      for (const remove of removers) remove();
    };
  }, [viewer, panelKey]);

  const slot = (name: string, content: ReactNode): ReactNode =>
    content === undefined || content === null || content === false
      ? null
      : createElement('div', { slot: name, key: name }, content);

  return (
    <ViewerContext.Provider value={viewer}>
      {createElement(
        'dv-viewer',
        {
          ref: elementRef,
          className,
          style: { display: 'block', width: '100%', height: '100%', ...style },
        },
        slot('banner', props.banner),
        slot('toolbar-start', props.toolbarStart),
        slot('panel-left', props.panelLeft),
        slot('panel-right', props.panelRight),
        slot('toolbar-end', props.toolbarEnd),
        slot('viewport-overlay', props.viewportOverlay),
        slot('empty-state', props.emptyState),
      )}
      {Object.entries(props.panels ?? {}).map(([id, panel]) => {
        const container = containers.get(id);
        return container === undefined ? null : createPortal(panel.render(), container, id);
      })}
    </ViewerContext.Provider>
  );
}
