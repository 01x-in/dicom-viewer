import type { DataSource, LoadedSeriesData, SeriesStack, StudyData } from './data/types';
import { assertDicomUid } from './data/uid';
import type {
  RenderingPort,
  SegmentationHandle,
  StackPort,
  ViewSnapshot,
  WindowLevel,
} from './rendering-port';
import { createEmitter, type Unsubscribe } from './state/events';
import { createStore, type StateOrigin, type SubscribeOptions } from './state/store';
import {
  compactViewport,
  createInitialState,
  parseViewerState,
  type ViewerStateV1,
  type ViewportStateV1,
} from './state/viewer-state';
import {
  DEFAULT_PRIMARY_TOOL,
  isPrimaryTool,
  PRIMARY_TOOLS,
  type PrimaryTool,
  type ToolInfo,
} from './tools';
import { assertWindowPresets, DEFAULT_WINDOW_PRESETS, type WindowPreset } from './window-presets';
import { clampZoom, desiredView, sameWindow, sameZoom, viewChanges } from './view';

export interface ViewerEvents {
  'study:loaded': { readonly study: StudyData };
  'viewport:image': {
    readonly viewportId: string;
    readonly imageIndex: number;
    readonly imageCount: number;
    readonly sopInstanceUID: string | undefined;
    readonly origin: StateOrigin;
  };
  /** The window or the inversion changed. */
  'viewport:voi': {
    readonly viewportId: string;
    readonly window: WindowLevel;
    readonly defaultWindow: WindowLevel;
    readonly invert: boolean;
    readonly origin: StateOrigin;
  };
  /** The zoom changed. */
  'viewport:camera': {
    readonly viewportId: string;
    readonly zoom: number;
    readonly origin: StateOrigin;
  };
  /** The tool the left mouse button drives changed. */
  'tool:active': { readonly tool: PrimaryTool; readonly previous: PrimaryTool };
  'state:changed': {
    readonly state: ViewerStateV1;
    readonly previous: ViewerStateV1;
    readonly origin: StateOrigin;
  };
  /** A failure that no call is waiting for, such as restoring `initialState` once an element is attached. */
  error: { readonly error: Error; readonly context: 'attach' };
}

/** Fields to change. Viewports are matched by id; a field you leave out stays as it is. */
export interface ViewerStatePatch {
  readonly studyInstanceUID?: string;
  readonly viewports?: readonly ViewportStateV1[];
}

export interface SetViewportSeriesOptions {
  /** Which stack of the series, when it splits into several. Default 0. */
  readonly stackIndex?: number;
  /** Default: the middle slice. */
  readonly imageIndex?: number;
}

export interface ViewportSeriesInfo {
  readonly seriesInstanceUID: string;
  readonly stackIndex: number;
  readonly imageCount: number;
}

export interface ViewportApi {
  readonly id: string;
  /** What the viewport shows now. `undefined` until a series is displayed. */
  readonly series: ViewportSeriesInfo | undefined;
  /** 0 when no series is displayed. */
  readonly imageCount: number;
  getImageIndex(): number | undefined;
  /** Rejects with a `RangeError` for a slice that does not exist. */
  setImageIndex(index: number): Promise<void>;
  /** Moves by a number of slices and stops at the first or last one. */
  scrollBy(delta: number): Promise<void>;
  /** What the viewport looks like now. `undefined` until a series is displayed. */
  getView(): ViewSnapshot | undefined;
  /** Rejects with a `RangeError` unless `center` is finite and `width` is finite and above zero. */
  setWindow(center: number, width: number): Promise<void>;
  setInvert(invert: boolean): Promise<void>;
  toggleInvert(): Promise<void>;
  /** 1 fits the image to the viewport. Values outside 0.1 to 32 are clamped. Rejects with a `RangeError` unless `zoom` is above zero. */
  setZoom(zoom: number): Promise<void>;
  /** Multiplies the zoom, within the same limits. */
  zoomBy(factor: number): Promise<void>;
  /** Sets the window to one of `viewer.tools.windowPresets()`. Rejects with a `RangeError` for an id that is not one. */
  applyWindowPreset(presetId: string): Promise<void>;
  /** Back to the default window, no inversion, fit to the viewport, and centred. */
  resetView(): Promise<void>;
  /** Decodes one slice and returns the Hounsfield value of one pixel. */
  sampleHu(imageIndex: number, row: number, column: number): Promise<number>;
  /** M1 spike: retrieves a SEG of the study and parses it against the displayed series. Replaced in M6. */
  loadSegmentation(segSeriesInstanceUID: string): Promise<SegmentationHandle>;
}

export interface ViewportsApi {
  /** Draws the viewport into `element`, now or as soon as it has a series to show. */
  attach(viewportId: string, element: HTMLElement): void;
  /** Stops drawing. What the viewport should show stays in the state, so attaching again restores it. */
  detach(viewportId: string): void;
  get(viewportId: string): ViewportApi | undefined;
  list(): ViewportApi[];
}

export interface ToolsApi {
  /** The tools the left mouse button can drive. The middle button always pans, the right zooms, and the wheel scrolls. */
  list(): readonly ToolInfo[];
  getActive(): PrimaryTool;
  /** Rejects with a `RangeError` for a tool that does not exist. */
  setActive(tool: PrimaryTool): Promise<void>;
  /** The window presets of this viewer. */
  windowPresets(): readonly WindowPreset[];
}

export interface Viewer {
  /** Resolves once the engine is ready. Rejects if it cannot start. */
  readonly ready: Promise<void>;
  /** Lists the series of a study and makes it the current one. Loading another study empties the viewports. */
  loadStudy(studyInstanceUID: string): Promise<StudyData>;
  readonly viewports: ViewportsApi;
  readonly tools: ToolsApi;
  /** Resolves once the series is displayed, or, with no element attached yet, once it is recorded. */
  setViewportSeries(
    viewportId: string,
    seriesInstanceUID: string,
    options?: SetViewportSeriesOptions,
  ): Promise<void>;
  getState(): ViewerStateV1;
  /** Applies a patch and resolves once everything it asks for is displayed. Rejects if the result is not a valid state. */
  setState(patch: ViewerStatePatch, options?: { readonly origin?: 'api' | 'url' }): Promise<void>;
  subscribe<T>(
    selector: (state: ViewerStateV1) => T,
    listener: (value: T, previous: T) => void,
    options?: SubscribeOptions<T>,
  ): Unsubscribe;
  on<K extends keyof ViewerEvents>(
    event: K,
    handler: (payload: ViewerEvents[K]) => void,
  ): Unsubscribe;
  destroy(): void;
}

export interface ViewerCoreOptions {
  readonly dataSource: DataSource;
  /** A state to restore, for example one decoded from the URL. It is validated. */
  readonly initialState?: ViewerStateV1;
  readonly tools?: {
    /** The tool the left mouse button drives at the start. Default: window / level. */
    readonly active?: PrimaryTool;
  };
  /** Replaces the usual CT windows (lung, soft tissue, bone, brain, liver). */
  readonly windowLevelPresets?: readonly WindowPreset[];
}

interface Shown {
  readonly seriesInstanceUID: string;
  readonly stack: SeriesStack;
  readonly element: HTMLElement;
  readonly port: StackPort;
  off: Unsubscribe;
  /** The slice last reported, so a repeat is not announced twice. */
  lastIndex: number;
  /** The view last reported, so only what changed is announced. */
  view: ViewSnapshot;
}

interface Runtime {
  readonly id: string;
  /** The slice a call is moving this viewport to, and who asked, so the engine's change event can be told from the wheel. */
  pendingMove: { readonly index: number; readonly origin: StateOrigin } | undefined;
  /** Who is changing the view while a call runs, so the engine's report can be told from the mouse. */
  viewOrigin: StateOrigin | undefined;
  element: HTMLElement | undefined;
  shown: Shown | undefined;
  api: ViewportApi | undefined;
}

const noop = (): void => undefined;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The same array when nothing changed, so the store does not announce a change that is none. */
function withViewport(
  viewports: readonly ViewportStateV1[],
  id: string,
  patch: Partial<ViewportStateV1>,
): readonly ViewportStateV1[] {
  const index = viewports.findIndex((viewport) => viewport.id === id);
  const current = viewports[index];
  if (current === undefined) return viewports;
  const changed = (Object.keys(patch) as (keyof ViewportStateV1)[]).some(
    (key) => !Object.is(patch[key], current[key]),
  );
  if (!changed) return viewports;
  return viewports.map((viewport, at) =>
    at === index ? compactViewport({ ...viewport, ...patch }) : viewport,
  );
}

/**
 * The viewer's logic, with the engine behind a `RenderingPort` so it can be tested without a
 * browser. The state is what the viewer should show; every change to it is applied to the engine
 * one at a time, in the order it was made.
 */
export function createViewerCore(
  options: ViewerCoreOptions,
  loadPort: () => Promise<RenderingPort>,
): Viewer {
  const initial =
    options.initialState === undefined ? undefined : parseViewerState(options.initialState);
  if (initial !== undefined && !initial.ok) {
    throw new Error(`Invalid initialState: ${initial.error}`);
  }
  const { dataSource } = options;
  const initialTool = options.tools?.active ?? DEFAULT_PRIMARY_TOOL;
  if (!isPrimaryTool(initialTool)) {
    throw new RangeError(`There is no tool ${String(initialTool)}.`);
  }
  let activeTool: PrimaryTool = initialTool;
  const windowPresets = options.windowLevelPresets ?? DEFAULT_WINDOW_PRESETS;
  assertWindowPresets(windowPresets);
  const store = createStore<ViewerStateV1>(initial?.state ?? createInitialState());
  const events = createEmitter<ViewerEvents>();
  store.onChange((state, previous, origin) => {
    events.emit('state:changed', { state, previous, origin });
  });

  const portPromise = loadPort();
  const ready = portPromise.then(() => undefined);
  // A host that never reads `ready` must not get an unhandled rejection when the engine fails.
  ready.catch(noop);

  const runtimes = new Map<string, Runtime>();
  const seriesCache = new Map<string, Promise<LoadedSeriesData>>();
  let destroyed = false;
  let queue: Promise<void> = Promise.resolve();

  function assertAlive(): void {
    if (destroyed) throw new Error('The viewer was destroyed.');
  }

  /** Runs one change at a time, in call order. A failure reaches its caller and no one else. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(() => {
      assertAlive();
      return task();
    });
    queue = run.then(noop, noop);
    return run;
  }

  function viewportState(id: string): ViewportStateV1 | undefined {
    return store.getState().viewports.find((viewport) => viewport.id === id);
  }

  function requireViewport(id: string): ViewportStateV1 {
    const found = viewportState(id);
    if (found === undefined) {
      const known = store
        .getState()
        .viewports.map((viewport) => viewport.id)
        .join(', ');
      throw new Error(`There is no viewport ${id}. This viewer has: ${known}.`);
    }
    return found;
  }

  function updateViewport(id: string, patch: Partial<ViewportStateV1>, origin: StateOrigin): void {
    store.update((state) => ({ viewports: withViewport(state.viewports, id, patch) }), origin);
  }

  function teardown(runtime: Runtime): void {
    const { shown } = runtime;
    if (shown === undefined) return;
    runtime.shown = undefined;
    shown.off();
    shown.port.destroy();
  }

  function reportImage(
    runtime: Runtime,
    shown: Shown,
    index: number,
    origin: StateOrigin,
    alsoInState: Partial<ViewportStateV1> = {},
  ): void {
    if (shown.lastIndex === index) return;
    shown.lastIndex = index;
    updateViewport(runtime.id, { ...alsoInState, imageIndex: index }, origin);
    events.emit('viewport:image', {
      viewportId: runtime.id,
      imageIndex: index,
      imageCount: shown.stack.imageIds.length,
      sopInstanceUID: shown.stack.instances[index]?.sopInstanceUID,
      origin,
    });
  }

  /** Records a change of view in the state and announces what changed. */
  function reportView(
    runtime: Runtime,
    shown: Shown,
    view: ViewSnapshot,
    origin: StateOrigin,
  ): void {
    const previous = shown.view;
    shown.view = view;
    const changes = viewChanges(viewportState(runtime.id) ?? { id: runtime.id }, view);
    if (Object.keys(changes).length > 0) updateViewport(runtime.id, changes, origin);
    if (!sameWindow(previous.window, view.window) || previous.invert !== view.invert) {
      events.emit('viewport:voi', {
        viewportId: runtime.id,
        window: view.window,
        defaultWindow: view.defaultWindow,
        invert: view.invert,
        origin,
      });
    }
    if (!sameZoom(previous.zoom, view.zoom)) {
      events.emit('viewport:camera', { viewportId: runtime.id, zoom: view.zoom, origin });
    }
  }

  /** Runs one change of the view, remembering who asked while the engine reports it. */
  function changeView(
    runtime: Runtime,
    origin: StateOrigin,
    change: (port: StackPort) => void,
  ): void {
    const { shown } = runtime;
    if (shown === undefined) return;
    runtime.viewOrigin = origin;
    try {
      change(shown.port);
    } finally {
      runtime.viewOrigin = undefined;
    }
  }

  /** Makes the engine show the window, inversion, and zoom the state asks for. */
  function applyView(runtime: Runtime, desired: ViewportStateV1, origin: StateOrigin): void {
    const { shown } = runtime;
    if (shown === undefined) return;
    const have = shown.port.getView();
    const want = desiredView(desired, have);
    changeView(runtime, origin, (port) => {
      if (!sameWindow(want.window, have.window)) port.setWindow(want.window);
      if (want.invert !== have.invert) port.setInvert(want.invert);
      if (!sameZoom(want.zoom, have.zoom)) port.setZoom(want.zoom);
    });
  }

  function getSeries(
    studyInstanceUID: string,
    seriesInstanceUID: string,
  ): Promise<LoadedSeriesData> {
    const key = `${studyInstanceUID}/${seriesInstanceUID}`;
    let cached = seriesCache.get(key);
    if (cached === undefined) {
      cached = dataSource.getSeries(studyInstanceUID, seriesInstanceUID);
      seriesCache.set(key, cached);
      // A failure is not remembered: asking again asks the source again.
      cached.catch(() => seriesCache.delete(key));
    }
    return cached;
  }

  /** Moves the engine to a slice, remembering who asked for it while the engine reports the change. */
  async function moveTo(
    runtime: Runtime,
    shown: Shown,
    index: number,
    origin: StateOrigin,
  ): Promise<void> {
    runtime.pendingMove = { index, origin };
    try {
      await shown.port.setImageIndex(index);
    } finally {
      // The engine reports the change before the call resolves.
      runtime.pendingMove = undefined;
    }
    reportImage(runtime, shown, shown.port.getImageIndex(), origin);
  }

  /** Makes the engine show what the state says this viewport should show. Runs inside the queue. */
  async function syncViewport(id: string, origin: StateOrigin = 'api'): Promise<void> {
    const runtime = runtimes.get(id);
    const element = runtime?.element;
    if (runtime === undefined || element === undefined) return;
    const { studyInstanceUID } = store.getState();
    const desired = viewportState(id);
    const seriesInstanceUID = desired?.seriesInstanceUID;

    if (
      desired === undefined ||
      studyInstanceUID === undefined ||
      seriesInstanceUID === undefined
    ) {
      teardown(runtime);
      return;
    }
    const stackIndex = desired.stackIndex ?? 0;
    const { shown } = runtime;
    if (
      shown?.seriesInstanceUID === seriesInstanceUID &&
      shown.stack.index === stackIndex &&
      shown.element === element
    ) {
      const wanted = desired.imageIndex;
      if (wanted !== undefined && wanted !== shown.port.getImageIndex()) {
        const index = Math.min(Math.max(0, Math.trunc(wanted)), shown.port.imageCount - 1);
        await moveTo(runtime, shown, index, origin);
      }
      applyView(runtime, desired, origin);
      return;
    }

    teardown(runtime);
    try {
      const series = await getSeries(studyInstanceUID, seriesInstanceUID);
      assertAlive();
      const stack = series.stacks[stackIndex];
      if (stack === undefined) {
        throw new Error(
          series.stacks.length === 0
            ? `Series ${seriesInstanceUID} (${series.modality}) has no images to display.`
            : `Series ${seriesInstanceUID} has ${series.stacks.length.toString()} stack(s); stack ${stackIndex.toString()} does not exist.`,
        );
      }
      const port = await portPromise;
      const stackPort = await port.renderStack(element, stack, { imageIndex: desired.imageIndex });
      if (destroyed || runtime.element !== element) {
        // Detached or destroyed while the render was in flight.
        stackPort.destroy();
        return;
      }
      const next: Shown = {
        seriesInstanceUID,
        stack,
        element,
        port: stackPort,
        off: noop,
        lastIndex: -1,
        view: stackPort.getView(),
      };
      const offImage = stackPort.onImageChange((index) => {
        reportImage(
          runtime,
          next,
          index,
          runtime.pendingMove?.index === index ? runtime.pendingMove.origin : 'user',
        );
      });
      const offView = stackPort.onViewChange((view) => {
        reportView(runtime, next, view, runtime.viewOrigin ?? 'user');
      });
      next.off = (): void => {
        offImage();
        offView();
      };
      runtime.shown = next;
      stackPort.setPrimaryTool(activeTool);
      // The state describes what is on screen: the stack and the slice that are showing now.
      reportImage(runtime, next, stackPort.getImageIndex(), origin, { stackIndex: stack.index });
      applyView(runtime, viewportState(id) ?? desired, origin);
    } catch (error) {
      // A viewport that failed shows nothing, and the state must not claim otherwise.
      if (!destroyed) {
        updateViewport(
          id,
          {
            seriesInstanceUID: undefined,
            stackIndex: undefined,
            imageIndex: undefined,
            window: undefined,
            invert: undefined,
            zoom: undefined,
          },
          origin,
        );
      }
      throw error;
    }
  }

  function apiFor(runtime: Runtime): ViewportApi {
    const requireShown = (): Shown => {
      assertAlive();
      if (runtime.shown === undefined) {
        throw new Error(`Viewport ${runtime.id} shows no series.`);
      }
      return runtime.shown;
    };
    const moveApiTo = (index: number): Promise<void> =>
      enqueue(() => moveTo(runtime, requireShown(), index, 'api'));
    const viewApi = (change: (port: StackPort) => void): Promise<void> =>
      enqueue(() => {
        requireShown();
        changeView(runtime, 'api', change);
        return Promise.resolve();
      });
    return {
      id: runtime.id,
      get series(): ViewportSeriesInfo | undefined {
        const { shown } = runtime;
        return shown === undefined
          ? undefined
          : {
              seriesInstanceUID: shown.seriesInstanceUID,
              stackIndex: shown.stack.index,
              imageCount: shown.stack.imageIds.length,
            };
      },
      get imageCount(): number {
        return runtime.shown?.stack.imageIds.length ?? 0;
      },
      getImageIndex: () => runtime.shown?.port.getImageIndex(),
      setImageIndex(index): Promise<void> {
        const count = runtime.shown?.stack.imageIds.length ?? 0;
        if (
          runtime.shown !== undefined &&
          !(Number.isInteger(index) && index >= 0 && index < count)
        ) {
          return Promise.reject(
            new RangeError(
              `Slice ${index.toString()} does not exist: the series has ${count.toString()}.`,
            ),
          );
        }
        return moveApiTo(index);
      },
      scrollBy(delta): Promise<void> {
        return enqueue(() => {
          const shown = requireShown();
          const target = Math.min(
            Math.max(0, shown.port.getImageIndex() + Math.trunc(delta)),
            shown.stack.imageIds.length - 1,
          );
          return moveTo(runtime, shown, target, 'api');
        });
      },
      getView: () => runtime.shown?.port.getView(),
      setWindow(center, width): Promise<void> {
        if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 0) {
          return Promise.reject(
            new RangeError(
              `A window needs a finite center and a width above zero, not ${center.toString()}/${width.toString()}.`,
            ),
          );
        }
        return viewApi((port) => {
          port.setWindow({ center, width });
        });
      },
      setInvert: (invert) =>
        viewApi((port) => {
          port.setInvert(invert);
        }),
      toggleInvert: () =>
        viewApi((port) => {
          port.setInvert(!port.getView().invert);
        }),
      setZoom(zoom): Promise<void> {
        if (!Number.isFinite(zoom) || zoom <= 0) {
          return Promise.reject(
            new RangeError(`A zoom must be above zero, not ${zoom.toString()}.`),
          );
        }
        return viewApi((port) => {
          port.setZoom(clampZoom(zoom));
        });
      },
      zoomBy(factor): Promise<void> {
        if (!Number.isFinite(factor) || factor <= 0) {
          return Promise.reject(
            new RangeError(`A zoom factor must be above zero, not ${factor.toString()}.`),
          );
        }
        return viewApi((port) => {
          port.setZoom(clampZoom(port.getView().zoom * factor));
        });
      },
      applyWindowPreset(presetId): Promise<void> {
        const preset = windowPresets.find((candidate) => candidate.id === presetId);
        if (preset === undefined) {
          return Promise.reject(new RangeError(`There is no window preset "${presetId}".`));
        }
        return viewApi((port) => {
          port.setWindow({ center: preset.center, width: preset.width });
        });
      },
      resetView: () =>
        viewApi((port) => {
          port.resetView();
        }),
      sampleHu(imageIndex, row, column): Promise<number> {
        // Queued like every engine call, so a sample asked for after a series switch is taken from the new series.
        return enqueue(() => requireShown().port.sampleHu(imageIndex, row, column));
      },
      loadSegmentation(segSeriesInstanceUID): Promise<SegmentationHandle> {
        return enqueue(async () => {
          const shown = requireShown();
          assertDicomUid(segSeriesInstanceUID, 'SeriesInstanceUID');
          const { studyInstanceUID } = store.getState();
          if (studyInstanceUID === undefined) throw new Error('No study is loaded.');
          const segSeries = await dataSource.getSeries(studyInstanceUID, segSeriesInstanceUID);
          const sop = segSeries.instances[0]?.sopInstanceUID;
          if (sop === undefined) {
            throw new Error(`Series ${segSeriesInstanceUID} has no instances.`);
          }
          const bytes = await dataSource.getInstanceBytes(
            studyInstanceUID,
            segSeriesInstanceUID,
            sop,
            segSeries.modality,
          );
          assertAlive();
          return (await portPromise).loadSegmentation(shown.stack.imageIds, bytes);
        });
      },
    };
  }

  function emptyViewports(state: ViewerStateV1): readonly ViewportStateV1[] {
    return state.viewports.map((viewport) => ({ id: viewport.id }));
  }

  async function loadStudy(studyInstanceUID: string): Promise<StudyData> {
    assertAlive();
    assertDicomUid(studyInstanceUID, 'StudyInstanceUID');
    return enqueue(async () => {
      // Fetch first: if it fails, nothing has changed.
      const study = await dataSource.getStudy(studyInstanceUID);
      assertAlive();
      if (store.getState().studyInstanceUID !== studyInstanceUID) {
        for (const runtime of runtimes.values()) teardown(runtime);
        seriesCache.clear();
        store.update((state) => ({ studyInstanceUID, viewports: emptyViewports(state) }), 'api');
      }
      events.emit('study:loaded', { study });
      return study;
    });
  }

  function setViewportSeries(
    viewportId: string,
    seriesInstanceUID: string,
    seriesOptions: SetViewportSeriesOptions = {},
  ): Promise<void> {
    try {
      assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
    } catch (error) {
      return Promise.reject(toError(error));
    }
    // The state changes inside the queue, so each call is checked against, and applied on top of,
    // the calls made before it.
    return enqueue(async () => {
      requireViewport(viewportId);
      if (store.getState().studyInstanceUID === undefined) {
        throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
      }
      // Asking for what is already on screen, without a slice, must not forget the slice.
      const shown = runtimes.get(viewportId)?.shown;
      const sameStack =
        shown?.seriesInstanceUID === seriesInstanceUID &&
        shown.stack.index === (seriesOptions.stackIndex ?? 0);
      updateViewport(
        viewportId,
        {
          seriesInstanceUID,
          stackIndex: seriesOptions.stackIndex,
          imageIndex:
            seriesOptions.imageIndex ?? (sameStack ? shown.port.getImageIndex() : undefined),
          // Another series starts with its own window, no inversion, and fit to the viewport.
          ...(sameStack ? {} : { window: undefined, invert: undefined, zoom: undefined }),
        },
        'api',
      );
      await syncViewport(viewportId);
    });
  }

  function setState(
    patch: ViewerStatePatch,
    stateOptions: { readonly origin?: 'api' | 'url' } = {},
  ): Promise<void> {
    const origin = stateOptions.origin ?? 'api';
    return enqueue(async () => {
      const current = store.getState();
      const studyChanged =
        patch.studyInstanceUID !== undefined && patch.studyInstanceUID !== current.studyInstanceUID;
      const base = studyChanged ? emptyViewports(current) : current.viewports;
      const merged = base.map((viewport) => {
        const change = patch.viewports?.find((candidate) => candidate.id === viewport.id);
        if (change === undefined) return viewport;
        const sameStack =
          (change.seriesInstanceUID ?? viewport.seriesInstanceUID) === viewport.seriesInstanceUID &&
          (change.stackIndex ?? viewport.stackIndex ?? 0) === (viewport.stackIndex ?? 0);
        // Another series starts with its own view, unless the patch says otherwise.
        return compactViewport({
          ...viewport,
          ...(sameStack ? {} : { window: undefined, invert: undefined, zoom: undefined }),
          ...change,
        });
      });
      const unmatched = patch.viewports?.find(
        (change) => !merged.some((viewport) => viewport.id === change.id),
      );
      if (unmatched !== undefined) requireViewport(unmatched.id);
      const candidate = parseViewerState({
        ...current,
        ...(patch.studyInstanceUID === undefined
          ? {}
          : { studyInstanceUID: patch.studyInstanceUID }),
        viewports: merged,
      });
      if (!candidate.ok) throw new Error(`Invalid state: ${candidate.error}`);

      if (studyChanged) seriesCache.clear();
      store.update(
        {
          studyInstanceUID: candidate.state.studyInstanceUID,
          viewports: candidate.state.viewports,
        },
        origin,
      );
      for (const viewport of candidate.state.viewports) await syncViewport(viewport.id, origin);
    });
  }

  const tools: ToolsApi = {
    list: () => PRIMARY_TOOLS,
    getActive: () => activeTool,
    windowPresets: () => windowPresets,
    setActive(tool): Promise<void> {
      if (!isPrimaryTool(tool)) {
        return Promise.reject(new RangeError(`There is no tool ${String(tool)}.`));
      }
      return enqueue(() => {
        const previous = activeTool;
        if (tool === previous) return Promise.resolve();
        activeTool = tool;
        for (const runtime of runtimes.values()) runtime.shown?.port.setPrimaryTool(tool);
        events.emit('tool:active', { tool, previous });
        return Promise.resolve();
      });
    },
  };

  const viewports: ViewportsApi = {
    attach(viewportId, element): void {
      assertAlive();
      requireViewport(viewportId);
      let runtime = runtimes.get(viewportId);
      if (runtime === undefined) {
        runtime = {
          id: viewportId,
          pendingMove: undefined,
          viewOrigin: undefined,
          element: undefined,
          shown: undefined,
          api: undefined,
        };
        runtimes.set(viewportId, runtime);
      }
      if (runtime.element === element) return;
      runtime.element = element;
      runtime.api ??= apiFor(runtime);
      // Anything drawn into a previous element is replaced when this runs.
      enqueue(() => syncViewport(viewportId)).catch((error: unknown) => {
        if (!destroyed) events.emit('error', { error: toError(error), context: 'attach' });
      });
    },
    detach(viewportId): void {
      const runtime = runtimes.get(viewportId);
      if (runtime === undefined) return;
      runtimes.delete(viewportId);
      runtime.element = undefined;
      runtime.api = undefined;
      if (!destroyed) {
        enqueue(() => {
          teardown(runtime);
          return Promise.resolve();
        }).catch(noop);
      }
    },
    get: (viewportId) => runtimes.get(viewportId)?.api,
    list: () =>
      [...runtimes.values()].flatMap((runtime) => (runtime.api === undefined ? [] : [runtime.api])),
  };

  return {
    ready,
    loadStudy,
    viewports,
    tools,
    setViewportSeries,
    getState: () => store.getState(),
    setState,
    subscribe: (selector, listener, subscribeOptions) =>
      store.subscribe(selector, listener, subscribeOptions),
    on: (event, handler) => events.on(event, handler),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const runtime of runtimes.values()) teardown(runtime);
      runtimes.clear();
      seriesCache.clear();
      events.clear();
      // If the engine never started there is nothing to destroy; the failure reached `ready`.
      portPromise.then((port) => {
        port.destroy();
      }, noop);
    },
  };
}
