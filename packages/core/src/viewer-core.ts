import type {
  DataSource,
  LoadedSeriesData,
  SeriesStack,
  SeriesSummary,
  StudyData,
} from './data/types';
import { assertDicomUid } from './data/uid';
import {
  type HangingMatch,
  type HangingProtocol,
  matchHangingProtocol,
  parseHangingProtocols,
} from './hanging';
import { assertLayout, type LayoutId, layoutViewportIds } from './layouts';
import {
  type RenderingPort,
  type StackPort,
  type ViewSnapshot,
  VolumeUnsupportedError,
  type WindowLevel,
} from './rendering-port';
import {
  decideMpr,
  isMprOrientation,
  type MprFallbackReason,
  type MprOrientation,
  resolveMaxCacheBytes,
} from './mpr';
import { createEmitter, type Emitter, type Unsubscribe } from './state/events';
import { createStore, type StateOrigin, type SubscribeOptions } from './state/store';
import { type CommandsApi, createCommands, type CommandInput } from './commands';
import { findCommandProblems } from './config/commands-check';
import { resolveConfig } from './config/merge';
import { parseViewerConfig } from './config/schema';
import type { ConfigBody, ResolvedViewerConfig, ViewerConfigV1 } from './config/types';
import {
  compactViewport,
  createInitialState,
  parseViewerState,
  sameViewState,
  type ViewerStateV1,
  type ViewportStateV1,
} from './state/viewer-state';
import { isPrimaryTool, PRIMARY_TOOLS, type PrimaryTool, type ToolInfo } from './tools';
import { assertWindowPresets, type WindowPreset } from './window-presets';
import {
  buildKeymap,
  chordOf,
  isTypingTarget,
  type KeyAction,
  type KeybindingOverrides,
} from './keyboard';
import {
  createOverlayView,
  describeOverlay,
  type OverlayOptions,
  renderOverlay,
  type OverlayView,
} from './overlay';
import { assertCineFps, type CineApi, type CineController, createCine } from './cine';
import { clampZoom, desiredView, sameWindow, sameZoom, viewChanges } from './view';
import { createThumbnails, type ThumbnailsApi } from './thumbnails';
import { createUiRegistry, type PanelDefinition, type UiApi } from './ui';
import {
  createMeasurementsRegistry,
  type MeasurementEvents,
  type MeasurementsApi,
} from './measurements/registry';
import {
  assertNavigateSegmentations,
  createSegmentationsRegistry,
  type NavigateSegmentation,
  type SegmentationEvents,
  type SegmentationsApi,
} from './segmentations/registry';

export interface ViewerEvents extends MeasurementEvents, SegmentationEvents {
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
  /** A viewport that asked for a plane is drawn: as a volume, or as slices with the reason. */
  'viewport:mpr': ViewportMprInfo & { readonly viewportId: string };
  /** Another viewport became the one the toolbar and the commands act on. */
  'viewport:active': { readonly viewportId: string; readonly previous: string };
  /** The tool the left mouse button drives changed. */
  'tool:active': { readonly tool: PrimaryTool; readonly previous: PrimaryTool };
  /** Cine started or stopped, or changed its rate. */
  'viewport:cine': { readonly viewportId: string; readonly playing: boolean; readonly fps: number };
  /** A panel was registered or removed. */
  'ui:panels': { readonly panels: readonly PanelDefinition[] };
  'state:changed': {
    readonly state: ViewerStateV1;
    readonly previous: ViewerStateV1;
    readonly origin: StateOrigin;
  };
  /** A layer was put on, or taken off: what is in force now. */
  'config:changed': { readonly config: ResolvedViewerConfig };
  /** A failure that no call is waiting for, such as restoring `initialState` once an element is attached. */
  error: {
    readonly error: Error;
    readonly context: 'attach' | 'cine' | 'keyboard' | 'measurement' | 'segmentation';
  };
}

/** Fields to change. Viewports are matched by id; a field you leave out stays as it is. */
export interface ViewerStatePatch {
  readonly studyInstanceUID?: string;
  /** Changes which viewports there are. Those the new layout keeps stay as they are; new ones start empty. */
  readonly layout?: LayoutId;
  readonly viewports?: readonly ViewportStateV1[];
}

export interface SetViewportSeriesOptions {
  /** Which stack of the series, when it splits into several. Default 0. */
  readonly stackIndex?: number;
  /**
   * A plane to reformat the series in. A series that cannot be (see `viewport.mpr`) is shown as
   * slices. Without one the slices are shown as they were acquired. Then `imageIndex` counts slices
   * along the plane.
   */
  readonly orientation?: MprOrientation;
  /** Default: the middle slice. */
  readonly imageIndex?: number;
}

export interface ViewportSeriesInfo {
  readonly seriesInstanceUID: string;
  readonly stackIndex: number;
  readonly imageCount: number;
}

export interface NavigateTarget {
  readonly seriesInstanceUID: string;
  readonly sopInstanceUID: string;
  /** 1-based. Only frame 1 exists until multi-frame images are supported. */
  readonly frameNumber?: number;
  /** Default `vp-0`. */
  readonly viewportId?: string;
  /**
   * SEGs to show, hide, or highlight once the slice is on screen. One that is not loaded is loaded.
   * One that cannot be loaded does not stop the others or the navigation: it is in the result and
   * reported as an `error`. A SEG that is not listed is left as it is.
   */
  readonly segmentations?: readonly NavigateSegmentation[];
}

export interface NavigateResult {
  readonly viewportId: string;
  readonly seriesInstanceUID: string;
  readonly stackIndex: number;
  readonly imageIndex: number;
  readonly sopInstanceUID: string;
  /** Only with `segmentations` in the target: the SEGs that could not be loaded. */
  readonly failedSegmentations?: readonly {
    readonly seriesInstanceUID: string;
    readonly error: Error;
  }[];
}

/** What a viewport that asked for a plane got. */
export interface ViewportMprInfo {
  readonly requested: MprOrientation;
  /** `volume`: reformatted in the plane. `stack`: the slices are shown, and `reason` says why. */
  readonly mode: 'volume' | 'stack';
  readonly reason?: MprFallbackReason;
}

export interface ViewportApi {
  readonly id: string;
  /** Set when the viewport asked for a plane: whether it got one. `undefined` for plain slices. */
  readonly mpr: ViewportMprInfo | undefined;
  /** What the viewport shows now. `undefined` until a series is displayed. */
  readonly series: ViewportSeriesInfo | undefined;
  /** 0 when no series is displayed. */
  readonly imageCount: number;
  getImageIndex(): number | undefined;
  /** Rejects with a `RangeError` for a slice that does not exist. */
  setImageIndex(index: number): Promise<void>;
  /** Moves by a number of slices and stops at the first or last one. */
  scrollBy(delta: number): Promise<void>;
  readonly cine: CineApi;
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
}

export interface ViewportsApi {
  /**
   * The viewport the toolbar, the commands, and the panels act on when they are not told another:
   * `vp-0` at the start, then the last one the person pressed or focused. It is not part of the
   * state: a link does not carry it.
   */
  readonly active: string;
  /** Makes a viewport the active one. Throws for an id the layout does not have. */
  setActive(viewportId: string): void;
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
  /**
   * Whether the tool can do anything now. Every tool can, except crosshairs, which needs two planes
   * of one volume on screen. A tool that is not available can still be chosen; it then does nothing.
   */
  isAvailable(tool: PrimaryTool): boolean;
  /** Rejects with a `RangeError` for a tool that does not exist. */
  setActive(tool: PrimaryTool): Promise<void>;
  /** The window presets of this viewer. */
  windowPresets(): readonly WindowPreset[];
  /** The keys that are bound, as chords such as `w` or `Shift+i`, so a toolbar can show the key of a button. Empty when the keyboard is off. */
  shortcuts(): readonly { readonly chord: string; readonly action: KeyAction }[];
}

export interface ShowMprOptions {
  /** The series to reformat. Default: the one on screen in the active viewport. */
  readonly seriesInstanceUID?: string;
  /** Which stack of it, when it splits into several. Default: the one on screen, else 0. */
  readonly stackIndex?: number;
}

/** How the study on screen can be hung: a layout, and a series for each viewport. */
export interface HangingProtocolsApi {
  /** The protocols the host gave, in order. Empty by default. */
  list(): readonly HangingProtocol[];
  /** The protocol that fits the current study best, or `undefined`. Changes nothing. */
  match(): HangingMatch | undefined;
  /**
   * Sets the layout and shows a series in each viewport. Without an id it uses the best fit; with
   * one, that protocol. A series that has no pictures is skipped for the next that fits. Resolves to
   * what was applied, or `undefined` when nothing fits (the viewer is left as it was). Rejects with
   * a `RangeError` for an unknown id, and with an `Error` before a study is loaded or when every
   * series that fits fails to open.
   */
  apply(protocolId?: string): Promise<HangingMatch | undefined>;
}

export interface Viewer {
  /** Resolves once the engine is ready. Rejects if it cannot start. */
  readonly ready: Promise<void>;
  /** Lists the series of a study and makes it the current one. Loading another study empties the viewports. */
  loadStudy(studyInstanceUID: string): Promise<StudyData>;
  /** The series list of the study last loaded, or `undefined` before any. */
  getStudy(): StudyData | undefined;
  readonly viewports: ViewportsApi;
  readonly tools: ToolsApi;
  /** Small pictures of the series of the current study. */
  readonly thumbnails: ThumbnailsApi;
  /** Side panels for the styled shell, and for a host that draws its own. */
  readonly ui: UiApi;
  /** What people measure: length, bidirectional, ellipse, rectangle, probe, and angle. */
  readonly measurements: MeasurementsApi;
  /** SEG overlays: what is loaded, how each segment looks, and where each one is. */
  readonly segmentations: SegmentationsApi;
  /** The settings in force, and layers to put over them. */
  readonly config: ConfigApi;
  /** Layouts and series chosen by rule, for a host that wants a study to open the way a reader expects. */
  readonly hangingProtocols: HangingProtocolsApi;
  /** Named things the viewer can do: for a config, a toolbar button, or a host's own code. */
  readonly commands: CommandsApi;
  /** Resolves once the series is displayed, or, with no element attached yet, once it is recorded. */
  setViewportSeries(
    viewportId: string,
    seriesInstanceUID: string,
    options?: SetViewportSeriesOptions,
  ): Promise<void>;
  /**
   * Shows one instance: the series it is in, in its stack, at its slice. The slice is loaded before
   * anything else, and its neighbours follow, nearest first. Rejects, and changes nothing, if the
   * series does not have the instance.
   */
  navigateTo(target: NavigateTarget): Promise<NavigateResult>;
  /**
   * Changes the layout: `1x1`, `1x2` (a row of two), `2x2`, or `1+3` (one large, three small). A
   * viewport that the new layout also has (`vp-0` always) keeps what it shows; new ones start empty;
   * the others stop drawing and are dropped from the state, so going back to a bigger layout shows
   * them empty. Rejects with a `RangeError` for any other value.
   */
  setLayout(layout: LayoutId): Promise<void>;
  /**
   * Shows a series in the three planes and as slices: a 2x2 layout with the axial plane in `vp-0`,
   * the sagittal in `vp-1`, the coronal in `vp-2`, and the slices as they were acquired in `vp-3`.
   * A series that cannot be reformatted is shown as slices in each, with the reason in `viewport.mpr`.
   * Rejects when there is no series to show.
   */
  showMpr(options?: ShowMprOptions): Promise<void>;
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

/** What `viewer.config` offers: what is in force, and layers that go on and come off. */
export interface ConfigApi {
  /** Every layer merged, with the defaults filled in. */
  get(): ResolvedViewerConfig;
  /**
   * Puts a layer over what is in force and returns a function that takes it off again. A layer is
   * a `ViewerConfigV1`. One with a problem is refused whole with a `RangeError` that names each
   * path, and nothing changes. The keys, the window presets, and the overlay change at once;
   * `tools.active` is read when the viewer starts, so a layer given here may not have it.
   */
  apply(layer: unknown): () => void;
}

export interface ViewerCoreOptions {
  readonly dataSource: DataSource;
  /**
   * Settings as data (`ViewerConfigV1`), one layer or several, the last one winning. The options
   * below win over it, and layers given to `viewer.config.apply` win over both.
   */
  readonly config?: ViewerConfigV1 | readonly ViewerConfigV1[];
  /**
   * Commands of the host, such as `{ 'acme.export': () => ... }`, added before the config is read,
   * so a config can name them.
   */
  readonly commands?: Readonly<Record<string, CommandInput>>;
  /** A state to restore, for example one decoded from the URL. It is validated. */
  readonly initialState?: ViewerStateV1;
  /**
   * Rules for how to hang a study (`DEFAULT_HANGING_PROTOCOLS` is a start). Plain data, validated
   * when the viewer is made. None by default: nothing is applied by itself, a host or the shell
   * calls `viewer.hangingProtocols.apply()`.
   */
  readonly hangingProtocols?: readonly HangingProtocol[];
  readonly tools?: {
    /** The tool the left mouse button drives at the start. Default: window / level. */
    readonly active?: PrimaryTool;
  };
  /**
   * Keyboard shortcuts, active while a viewport element has the focus: the defaults changed by these
   * (`null` removes one), or `false` for none. The viewer gives its elements a `tabindex` of 0 unless
   * they have one, and focuses them on a pointer press.
   */
  readonly keybindings?: false | KeybindingOverrides;
  /**
   * How far from the slice on screen images are loaded ahead of being asked for: `radius` slices
   * either side, 64 by default. `false` loads only what is asked for. Cornerstone keeps one
   * setting per page, so with several viewers the last one drawn decides.
   */
  readonly prefetch?: false | { readonly radius?: number };
  /** The text drawn over each viewport (series, image size, window, slice number), or `false` for none. */
  readonly overlay?: false | OverlayOptions;
  /** Replaces the usual CT windows (lung, soft tissue, bone, brain, liver). */
  readonly windowLevelPresets?: readonly WindowPreset[];
  readonly memory?: {
    /**
     * How much memory volumes (reformatted planes) may take in all. A series whose volume would not
     * fit is shown as slices. Default 1 GiB, or 512 MiB on a device that reports 4 GiB or less.
     */
    readonly maxCacheBytes?: number;
  };
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
  readonly modality: string;
  readonly description: string | undefined;
  overlay: OverlayView | undefined;
  /** The plane the viewport asked for, and what it got. */
  readonly mpr: ViewportMprInfo | undefined;
  /** Set when the viewport draws a volume: the claim on its memory, given back with the viewport. */
  readonly volumeKey: string | undefined;
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
  cine: CineController | undefined;
  stopKeys: (() => void) | undefined;
  stopActive: (() => void) | undefined;
}

const noop = (): void => undefined;

const DEFAULT_PREFETCH_RADIUS = 64;

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
/** The layers a host gave as `config`, each checked. A problem is a `RangeError` that names every path. */
function readConfigLayers(config: ViewerCoreOptions['config']): ConfigBody[] {
  if (config === undefined) return [];
  const layers = Array.isArray(config) ? config : [config];
  return layers.map((layer, index) => {
    const parsed = parseViewerConfig(layer);
    if (!parsed.ok) {
      const where = layers.length === 1 ? 'config' : `config[${index.toString()}]`;
      throw new RangeError(`Invalid ${where}:\n${parsed.errors.join('\n')}`);
    }
    return parsed.config;
  });
}

/** The options written in code, as the layer they are: only what the host set. */
function codeLayerOf(options: ViewerCoreOptions): ConfigBody {
  return {
    ...(options.keybindings === undefined ? {} : { keybindings: options.keybindings }),
    ...(options.overlay === undefined ? {} : { overlay: options.overlay }),
    ...(options.windowLevelPresets === undefined
      ? {}
      : { windowLevelPresets: options.windowLevelPresets }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
  };
}

/** A toolbar that names a command that is not there, gives it arguments it will not take, or asks for a window preset that is not there, is refused. */
function assertConfigCommands(config: ResolvedViewerConfig, commands: CommandsApi): void {
  // Checked first: a preset that is not an object would fail the lookup below with a `TypeError`.
  assertWindowPresets(config.windowLevelPresets);
  const presets = new Set(config.windowLevelPresets.map((preset) => preset.id));
  const problems = findCommandProblems(config.toolbar.items ?? [], (id, args) => {
    const problem = commands.check(id, args);
    if (problem !== undefined || id !== 'preset.apply') return problem;
    // The arguments fit, so they are `{ id }`; a button for a preset that no layer has would do nothing.
    const wanted = (args as { readonly id: string }).id;
    return presets.has(wanted) ? undefined : `There is no window preset ${wanted}.`;
  });
  if (problems.length > 0) throw new RangeError(`Invalid config:\n${problems.join('\n')}`);
}

type ResolvedOverlay = Exclude<ResolvedViewerConfig['overlay'], false>;

function overlayOptionsOf(config: ResolvedViewerConfig): ResolvedOverlay | undefined {
  return config.overlay === false ? undefined : config.overlay;
}

/** The keymap of a config, or `undefined` when the keyboard is off. Throws for a key or an action that cannot work. */
function keymapOf(config: ResolvedViewerConfig): Map<string, KeyAction> | undefined {
  return config.keybindings === false
    ? undefined
    : buildKeymap(config.windowLevelPresets, config.keybindings);
}

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
  // The settings come in layers, the last one winning: the config the host gave at the start, then
  // the options written in code, then whatever `viewer.config.apply` puts on later.
  // The commands are made first, so a config can name them, and need the viewer only when one runs.
  const made: { viewer?: Viewer } = {};
  const commands = createCommands(() => {
    if (made.viewer === undefined) throw new Error('The viewer is not made yet.');
    return made.viewer;
  });
  for (const [id, command] of Object.entries(options.commands ?? {})) {
    commands.register(id, command);
  }
  const configLayers = readConfigLayers(options.config);
  const codeLayer = codeLayerOf(options);
  const applied: { readonly body: ConfigBody }[] = [];
  const layersOf = (extra: readonly { readonly body: ConfigBody }[]): ConfigBody[] => [
    ...configLayers,
    codeLayer,
    ...extra.map((entry) => entry.body),
  ];
  let resolved = resolveConfig(layersOf(applied));
  assertConfigCommands(resolved, commands);
  const initialTool = resolved.tools.active;
  if (!isPrimaryTool(initialTool)) {
    throw new RangeError(`There is no tool ${String(initialTool)}.`);
  }
  let activeTool: PrimaryTool = initialTool;
  assertWindowPresets(resolved.windowLevelPresets);
  let windowPresets = resolved.windowLevelPresets;
  const prefetchRadius =
    options.prefetch === false ? 0 : (options.prefetch?.radius ?? DEFAULT_PREFETCH_RADIUS);
  if (!Number.isInteger(prefetchRadius) || prefetchRadius < 0) {
    throw new RangeError(
      `The prefetch radius must be a whole number, 0 or more, not ${prefetchRadius.toString()}.`,
    );
  }
  let overlayOptions: ResolvedOverlay | undefined = overlayOptionsOf(resolved);
  let keymap = keymapOf(resolved);
  const store = createStore<ViewerStateV1>(initial?.state ?? createInitialState());
  const events = createEmitter<ViewerEvents>();
  store.onChange((state, previous, origin) => {
    events.emit('state:changed', { state, previous, origin });
  });

  const portPromise = loadPort();
  const ready = portPromise.then(() => undefined);
  // A host that never reads `ready` must not get an unhandled rejection when the engine fails.
  ready.catch(noop);

  const ui = createUiRegistry((panels) => {
    events.emit('ui:panels', { panels });
  });
  let study: StudyData | undefined;
  const thumbnails = createThumbnails({
    study: () => store.getState().studyInstanceUID,
    series: (studyInstanceUID, seriesInstanceUID) => getSeries(studyInstanceUID, seriesInstanceUID),
    render: async (stack, imageIndex, size) => {
      const port = await portPromise;
      assertAlive();
      const picture = await port.renderThumbnail(stack, imageIndex, size);
      // A picture that lands after destroy() is not delivered.
      assertAlive();
      return picture;
    },
  });
  const runtimes = new Map<string, Runtime>();
  let activeViewport = 'vp-0';
  const maxVolumeBytes = resolveMaxCacheBytes(options.memory?.maxCacheBytes);
  /** The volumes drawn now, by series and stack, with how many viewports use each. */
  const volumes = new Map<string, { readonly bytes: number; users: number }>();

  function volumeBytesInUse(): number {
    let total = 0;
    for (const { bytes } of volumes.values()) total += bytes;
    return total;
  }

  function claimVolume(key: string, bytes: number): void {
    const held = volumes.get(key);
    if (held === undefined) volumes.set(key, { bytes, users: 1 });
    else held.users += 1;
  }

  function releaseVolume(key: string | undefined): void {
    if (key === undefined) return;
    const held = volumes.get(key);
    if (held === undefined) return;
    held.users -= 1;
    if (held.users <= 0) volumes.delete(key);
  }
  const seriesCache = new Map<string, Promise<LoadedSeriesData>>();
  let destroyed = false;
  let queue: Promise<void> = Promise.resolve();

  function assertAlive(): void {
    if (destroyed) throw new Error('The viewer was destroyed.');
  }

  const measurements = createMeasurementsRegistry({
    enqueue: (task) => enqueue(task),
    assertAlive,
    // The viewer's emitter, seen as the one that carries only the measurement events.
    emit: (event, payload) => {
      const measurementEvents: Emitter<MeasurementEvents> = events;
      measurementEvents.emit(event, payload);
    },
    study: () => store.getState().studyInstanceUID,
    navigateNow: (target) => navigateNow(target),
    fail: (error) => {
      events.emit('error', { error, context: 'measurement' });
    },
  });

  const segmentations = createSegmentationsRegistry({
    enqueue: (task) => enqueue(task),
    assertAlive,
    emit: (event, payload) => {
      const segmentationEvents: Emitter<SegmentationEvents> = events;
      segmentationEvents.emit(event, payload);
    },
    study: () => store.getState().studyInstanceUID,
    getSeries: (studyInstanceUID, seriesInstanceUID) =>
      getSeries(studyInstanceUID, seriesInstanceUID),
    getInstanceBytes: (studyInstanceUID, seriesInstanceUID, sopInstanceUID, modality) =>
      dataSource.getInstanceBytes(studyInstanceUID, seriesInstanceUID, sopInstanceUID, modality),
    port: () => portPromise,
    navigateNow: (target) => navigateNow(target),
    imageIndexOf: (viewportId, seriesInstanceUID, stackIndex) => {
      const shown = runtimes.get(viewportId)?.shown;
      return shown?.seriesInstanceUID === seriesInstanceUID &&
        shown.stack.index === stackIndex &&
        shown.volumeKey === undefined
        ? shown.port.getImageIndex()
        : undefined;
    },
    fail: (error) => {
      events.emit('error', { error, context: 'segmentation' });
    },
  });

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
    runtime.cine?.stop();
    shown.overlay?.destroy();
    shown.off();
    shown.port.destroy();
    releaseVolume(shown.volumeKey);
  }

  /** Redraws the text over the picture from what is on screen now. */
  function updateOverlay(shown: Shown): void {
    if (shown.overlay === undefined || overlayOptions === undefined || shown.lastIndex < 0) return;
    // A plane is made of every slice: its headers are the first image's, whatever the index.
    const metadata =
      shown.stack.instances[shown.volumeKey === undefined ? shown.lastIndex : 0]?.metadata;
    if (metadata === undefined) return;
    shown.overlay.update(
      renderOverlay(
        describeOverlay({
          modality: shown.modality,
          seriesDescription: shown.description,
          metadata,
          imageIndex: shown.lastIndex,
          imageCount: shown.port.imageCount,
          view: shown.view,
        }),
        overlayOptions.corners,
        overlayOptions.showPatientInfo,
      ),
    );
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
    updateOverlay(shown);
    updateViewport(runtime.id, { ...alsoInState, imageIndex: index }, origin);
    events.emit('viewport:image', {
      viewportId: runtime.id,
      imageIndex: index,
      imageCount: shown.port.imageCount,
      sopInstanceUID:
        shown.volumeKey === undefined ? shown.stack.instances[index]?.sopInstanceUID : undefined,
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
    updateOverlay(shown);
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
    if (!sameWindow(previous.window, view.window) || previous.invert !== view.invert) {
      syncVoi(runtime, shown, view, origin);
    }
  }

  /**
   * The planes of one volume share a window and an inversion: what changes in one is set in the
   * others, as the change it was (a person's drag stays a user change). Slices are not synced, and
   * neither are two viewports that merely show the same series.
   */
  function syncVoi(source: Runtime, shown: Shown, view: ViewSnapshot, origin: StateOrigin): void {
    if (shown.volumeKey === undefined) return;
    for (const other of [...runtimes.values()]) {
      if (other === source || other.shown?.volumeKey !== shown.volumeKey) continue;
      const have = other.shown.port.getView();
      const windowDiffers = !sameWindow(have.window, view.window);
      const invertDiffers = have.invert !== view.invert;
      if (!windowDiffers && !invertDiffers) continue;
      changeView(other, origin, (port) => {
        if (windowDiffers) port.setWindow(view.window);
        if (invertDiffers) port.setInvert(view.invert);
      });
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

  /**
   * Draws a stack, or the plane of it that the viewport asked for. A plane needs a stack that can
   * be reformatted and a volume that fits the budget; otherwise, or when the engine cannot, the
   * slices are drawn and the reason is kept. Runs inside the queue.
   */
  async function drawPlane(
    port: RenderingPort,
    element: HTMLElement,
    stack: SeriesStack,
    seriesInstanceUID: string,
    desired: ViewportStateV1,
  ): Promise<{
    readonly port: StackPort;
    readonly mpr: ViewportMprInfo | undefined;
    readonly volumeKey: string | undefined;
  }> {
    const renderOptions = { imageIndex: desired.imageIndex, prefetchRadius };
    const requested = desired.orientation;
    if (requested === undefined) {
      return {
        port: await port.renderStack(element, stack, renderOptions),
        mpr: undefined,
        volumeKey: undefined,
      };
    }
    const key = `${seriesInstanceUID}/${stack.index.toString()}`;
    const held = volumes.get(key);
    // Planes of one volume share it, so a second plane costs nothing.
    const decision =
      held === undefined
        ? decideMpr(stack, { maxBytes: maxVolumeBytes, inUseBytes: volumeBytesInUse() })
        : ({ ok: true, bytes: held.bytes } as const);
    let reason: MprFallbackReason;
    if (decision.ok) {
      claimVolume(key, decision.bytes);
      try {
        const volume = await port.renderVolume(element, stack, {
          ...renderOptions,
          orientation: requested,
        });
        return { port: volume, mpr: { requested, mode: 'volume' }, volumeKey: key };
      } catch (error) {
        releaseVolume(key);
        if (!(error instanceof VolumeUnsupportedError)) throw error;
        reason = 'engine-unsupported';
      }
    } else {
      reason = decision.reason;
    }
    return {
      port: await port.renderStack(element, stack, renderOptions),
      mpr: { requested, mode: 'stack', reason },
      volumeKey: undefined,
    };
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
      shown.element === element &&
      shown.mpr?.requested === desired.orientation
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
      const drawn = await drawPlane(port, element, stack, seriesInstanceUID, desired);
      const { port: stackPort, mpr, volumeKey } = drawn;
      if (destroyed || runtime.element !== element) {
        // Detached or destroyed while the render was in flight.
        stackPort.destroy();
        releaseVolume(volumeKey);
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
        modality: series.modality,
        description:
          volumeKey === undefined
            ? series.description
            : `${series.description ?? series.modality} (${mpr?.requested ?? 'plane'})`,
        overlay: overlayOptions === undefined ? undefined : createOverlayView(element),
        mpr,
        volumeKey,
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
      runtime.shown = next;
      // Shapes are drawn on stacks of slices, not on a plane of a volume. A SEG is drawn on both.
      const detachMeasurements =
        volumeKey === undefined
          ? measurements.attach({ seriesInstanceUID, stack, port: stackPort })
          : noop;
      const detachSegmentations = segmentations.attach({
        seriesInstanceUID,
        stack,
        port: stackPort,
      });
      next.off = (): void => {
        offImage();
        offView();
        detachMeasurements();
        detachSegmentations();
      };
      stackPort.setPrimaryTool(activeTool);
      if (mpr !== undefined) {
        events.emit('viewport:mpr', {
          viewportId: id,
          requested: mpr.requested,
          mode: mpr.mode,
          ...(mpr.reason === undefined ? {} : { reason: mpr.reason }),
        });
      }
      // The state describes what is on screen: the stack and the slice that are showing now.
      reportImage(runtime, next, stackPort.getImageIndex(), origin, { stackIndex: stack.index });
      applyView(runtime, viewportState(id) ?? desired, origin);
    } catch (error) {
      // A viewport that failed shows nothing, and the state must not claim otherwise.
      teardown(runtime);
      if (!destroyed) {
        updateViewport(
          id,
          {
            seriesInstanceUID: undefined,
            stackIndex: undefined,
            orientation: undefined,
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
    const cine = createCine({
      async step(loop): Promise<boolean> {
        // Runs in the queue, like every call that moves the engine.
        return enqueue(async () => {
          const { shown } = runtime;
          if (shown === undefined) return false;
          const last = shown.port.imageCount - 1;
          const current = shown.port.getImageIndex();
          if (current >= last && !loop) return false;
          await moveTo(runtime, shown, current >= last ? 0 : current + 1, 'api');
          return true;
        });
      },
      changed: ({ playing, fps }) => {
        events.emit('viewport:cine', { viewportId: runtime.id, playing, fps });
      },
      failed: (error) => {
        events.emit('error', { error, context: 'cine' });
      },
    });
    runtime.cine = cine;
    // Counts calls to play and stop, so a stop can cancel a play that is still waiting in the queue.
    let cineCalls = 0;
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
              imageCount: shown.port.imageCount,
            };
      },
      get mpr(): ViewportMprInfo | undefined {
        return runtime.shown?.mpr;
      },
      get imageCount(): number {
        return runtime.shown?.port.imageCount ?? 0;
      },
      getImageIndex: () => runtime.shown?.port.getImageIndex(),
      setImageIndex(index): Promise<void> {
        const count = runtime.shown?.port.imageCount ?? 0;
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
            shown.port.imageCount - 1,
          );
          return moveTo(runtime, shown, target, 'api');
        });
      },
      cine: {
        play(cineOptions): Promise<void> {
          try {
            if (cineOptions?.fps !== undefined) assertCineFps(cineOptions.fps);
          } catch (error) {
            return Promise.reject(toError(error));
          }
          cineCalls += 1;
          const mine = cineCalls;
          return enqueue(() => {
            const shown = requireShown();
            // A stop, or a later play, made after this call supersedes it, even though it is still queued.
            if (mine === cineCalls && shown.port.imageCount > 1) cine.play(cineOptions);
            return Promise.resolve();
          });
        },
        stop: () => {
          cineCalls += 1;
          cine.stop();
        },
        get playing(): boolean {
          return cine.playing;
        },
        get fps(): number {
          return cine.fps;
        },
      },
      getView: () => runtime.shown?.port.getView(),
      setWindow(center, width): Promise<void> {
        if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 0) {
          return Promise.reject(
            new RangeError(
              `A window needs a finite center and a width above zero, not ${String(center)}/${String(width)}.`,
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
          return Promise.reject(new RangeError(`A zoom must be above zero, not ${String(zoom)}.`));
        }
        return viewApi((port) => {
          port.setZoom(clampZoom(zoom));
        });
      },
      zoomBy(factor): Promise<void> {
        if (!Number.isFinite(factor) || factor <= 0) {
          return Promise.reject(
            new RangeError(`A zoom factor must be above zero, not ${String(factor)}.`),
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
    };
  }

  function emptyViewports(state: ViewerStateV1): readonly ViewportStateV1[] {
    return state.viewports.map((viewport) => ({ id: viewport.id }));
  }

  /** The viewports of a layout: the ones already there are kept, and the rest start empty. */
  function fitToLayout(
    current: readonly ViewportStateV1[],
    layout: LayoutId,
  ): readonly ViewportStateV1[] {
    return layoutViewportIds(layout).map(
      (id) => current.find((viewport) => viewport.id === id) ?? { id },
    );
  }

  /** Stops drawing the viewports that are not in the state any more. */
  function dropRemovedViewports(): void {
    for (const runtime of runtimes.values()) {
      if (viewportState(runtime.id) === undefined) teardown(runtime);
    }
    if (viewportState(activeViewport) === undefined) makeActive('vp-0');
  }

  function setLayout(layout: LayoutId): Promise<void> {
    try {
      assertAlive();
      assertLayout(layout);
    } catch (error) {
      return Promise.reject(toError(error));
    }
    return enqueue(() => {
      applyLayoutNow(layout);
      return Promise.resolve();
    });
  }

  /** Changes the layout. Runs inside the queue. */
  function applyLayoutNow(layout: LayoutId): void {
    store.update((state) => {
      if (state.layout === layout) return {};
      return { layout, viewports: fitToLayout(state.viewports, layout) };
    }, 'api');
    dropRemovedViewports();
  }

  const MPR_VIEWPORTS: readonly (readonly [string, MprOrientation | undefined])[] = [
    ['vp-0', 'axial'],
    ['vp-1', 'sagittal'],
    ['vp-2', 'coronal'],
    ['vp-3', undefined],
  ];

  function showMpr(mprOptions: ShowMprOptions = {}): Promise<void> {
    try {
      assertAlive();
      if (mprOptions.seriesInstanceUID !== undefined) {
        assertDicomUid(mprOptions.seriesInstanceUID, 'SeriesInstanceUID');
      }
      const { stackIndex } = mprOptions;
      if (stackIndex !== undefined && !(Number.isInteger(stackIndex) && stackIndex >= 0)) {
        throw new RangeError(`A stack number is a whole number from 0, not ${String(stackIndex)}.`);
      }
    } catch (error) {
      return Promise.reject(toError(error));
    }
    return enqueue(async () => {
      if (store.getState().studyInstanceUID === undefined) {
        throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
      }
      const source = viewportState(activeViewport);
      const seriesInstanceUID = mprOptions.seriesInstanceUID ?? source?.seriesInstanceUID;
      if (seriesInstanceUID === undefined) {
        throw new Error('Show a series first, or say which one to reformat.');
      }
      const stackIndex =
        mprOptions.stackIndex ??
        (source?.seriesInstanceUID === seriesInstanceUID ? source.stackIndex : undefined);
      applyLayoutNow('2x2');
      makeActive('vp-0');
      for (const [viewportId, orientation] of MPR_VIEWPORTS) {
        await applySeries(viewportId, seriesInstanceUID, {
          ...(stackIndex === undefined ? {} : { stackIndex }),
          ...(orientation === undefined ? {} : { orientation }),
        });
      }
    });
  }

  const protocols = parseHangingProtocols(options.hangingProtocols ?? []);

  function matchNow(
    candidates: readonly SeriesSummary[],
    only?: HangingProtocol,
  ): HangingMatch | undefined {
    return matchHangingProtocol(only === undefined ? protocols : [only], candidates);
  }

  /** Hangs the study: finds a protocol whose series can all be opened, then shows it. Runs inside the queue. */
  async function applyHangingNow(
    protocolId: string | undefined,
  ): Promise<HangingMatch | undefined> {
    const only =
      protocolId === undefined
        ? undefined
        : protocols.find((candidate) => candidate.id === protocolId);
    if (protocolId !== undefined && only === undefined) {
      throw new RangeError(`There is no hanging protocol "${protocolId}".`);
    }
    const { studyInstanceUID } = store.getState();
    const loaded = study;
    if (studyInstanceUID === undefined || loaded?.studyInstanceUID !== studyInstanceUID) {
      throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
    }
    let candidates = loaded.series;
    let lastFailure: Error | undefined;
    for (;;) {
      const match = matchNow(candidates, only);
      if (match === undefined) {
        if (lastFailure !== undefined) throw lastFailure;
        return undefined;
      }
      // Open every series first, so a protocol is never half applied.
      const failed = new Set<string>();
      for (const { seriesInstanceUID } of match.assignments) {
        try {
          const data = await getSeries(studyInstanceUID, seriesInstanceUID);
          assertAlive();
          if (data.stacks.length === 0) {
            throw new Error(
              `Series ${seriesInstanceUID} (${data.modality}) has no images to display.`,
            );
          }
        } catch (error) {
          assertAlive();
          failed.add(seriesInstanceUID);
          lastFailure = toError(error);
        }
      }
      if (failed.size > 0) {
        candidates = candidates.filter((entry) => !failed.has(entry.seriesInstanceUID));
        continue;
      }
      const before = store.getState();
      const activeBefore = activeViewport;
      try {
        await hangNow(match);
      } catch (error) {
        // A hang that fails part way leaves the viewer as it was, not half done.
        store.update({ layout: before.layout, viewports: before.viewports }, 'api');
        dropRemovedViewports();
        for (const viewport of before.viewports) await syncViewport(viewport.id).catch(noop);
        if (viewportState(activeBefore) !== undefined) makeActive(activeBefore);
        throw error;
      }
      return match;
    }
  }

  /** Sets the layout and puts each assigned series in its viewport. Runs inside the queue. */
  async function hangNow(match: HangingMatch): Promise<void> {
    {
      applyLayoutNow(match.protocol.layout);
      for (const id of layoutViewportIds(match.protocol.layout)) {
        const assigned = match.assignments.find((entry) => entry.viewportId === id);
        if (assigned === undefined) {
          updateViewport(
            id,
            {
              seriesInstanceUID: undefined,
              orientation: undefined,
              stackIndex: undefined,
              imageIndex: undefined,
              window: undefined,
              invert: undefined,
              zoom: undefined,
            },
            'api',
          );
          await syncViewport(id);
        } else {
          await applySeries(id, assigned.seriesInstanceUID, {});
        }
      }
    }
  }

  const hangingProtocols: HangingProtocolsApi = {
    list: () => protocols,
    match: () => {
      const loaded = study;
      return loaded === undefined || loaded.studyInstanceUID !== store.getState().studyInstanceUID
        ? undefined
        : matchNow(loaded.series);
    },
    apply(protocolId): Promise<HangingMatch | undefined> {
      try {
        assertAlive();
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return enqueue(() => applyHangingNow(protocolId));
    },
  };

  async function loadStudy(studyInstanceUID: string): Promise<StudyData> {
    assertAlive();
    assertDicomUid(studyInstanceUID, 'StudyInstanceUID');
    return enqueue(async () => {
      // Fetch first: if it fails, nothing has changed.
      const loaded = await dataSource.getStudy(studyInstanceUID);
      assertAlive();
      if (store.getState().studyInstanceUID !== studyInstanceUID) {
        for (const runtime of runtimes.values()) teardown(runtime);
        // A SEG belongs to one study. The stacks are gone, so this only gives its memory back.
        segmentations.studyChanged();
        seriesCache.clear();
        thumbnails.clear();
        store.update((state) => ({ studyInstanceUID, viewports: emptyViewports(state) }), 'api');
      }
      study = loaded;
      events.emit('study:loaded', { study: loaded });
      return loaded;
    });
  }

  /** Records what a viewport should show and makes the engine show it. Runs inside the queue. */
  async function applySeries(
    viewportId: string,
    seriesInstanceUID: string,
    seriesOptions: SetViewportSeriesOptions,
  ): Promise<void> {
    requireViewport(viewportId);
    if (store.getState().studyInstanceUID === undefined) {
      throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
    }
    // Asking for what is already on screen, without a slice, must not forget the slice.
    const shown = runtimes.get(viewportId)?.shown;
    const sameStack =
      shown?.seriesInstanceUID === seriesInstanceUID &&
      shown.stack.index === (seriesOptions.stackIndex ?? 0);
    // Another plane of the same series keeps its window, but not its slice or its zoom.
    const sameView = sameStack && shown.mpr?.requested === seriesOptions.orientation;
    updateViewport(
      viewportId,
      {
        seriesInstanceUID,
        stackIndex: seriesOptions.stackIndex,
        orientation: seriesOptions.orientation,
        imageIndex: seriesOptions.imageIndex ?? (sameView ? shown.port.getImageIndex() : undefined),
        // Another series starts with its own window, no inversion, and fit to the viewport.
        ...(sameStack ? {} : { window: undefined, invert: undefined }),
        ...(sameView ? {} : { zoom: undefined }),
      },
      'api',
    );
    // A viewport that fell back to slices tries for the plane again when it is asked again: memory
    // may have been freed, or the engine may have changed, since it was decided.
    const runtime = runtimes.get(viewportId);
    if (shown?.mpr?.mode === 'stack' && runtime !== undefined) teardown(runtime);
    await syncViewport(viewportId);
  }

  function setViewportSeries(
    viewportId: string,
    seriesInstanceUID: string,
    seriesOptions: SetViewportSeriesOptions = {},
  ): Promise<void> {
    try {
      assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
      // The state must hold a slice number the schema accepts, whatever a host without types passes.
      const { imageIndex } = seriesOptions;
      if (imageIndex !== undefined && !Number.isInteger(imageIndex)) {
        throw new RangeError(`A slice number is a whole number, not ${String(imageIndex)}.`);
      }
      const { orientation } = seriesOptions;
      if (orientation !== undefined && !isMprOrientation(orientation)) {
        throw new RangeError(
          `There is no plane ${String(orientation)}. The planes are axial, sagittal, and coronal.`,
        );
      }
    } catch (error) {
      return Promise.reject(toError(error));
    }
    // Below the first slice is the first slice, as above the last is the last.
    const wanted = seriesOptions.imageIndex;
    const normalized =
      wanted === undefined ? seriesOptions : { ...seriesOptions, imageIndex: Math.max(0, wanted) };
    // The state changes inside the queue, so each call is checked against, and applied on top of,
    // the calls made before it.
    return enqueue(() => applySeries(viewportId, seriesInstanceUID, normalized));
  }

  /** Checks a target before anything is queued, so a bad one rejects at once. Throws. */
  function assertNavigateTarget(target: NavigateTarget): void {
    assertDicomUid(target.seriesInstanceUID, 'SeriesInstanceUID');
    assertDicomUid(target.sopInstanceUID, 'SOPInstanceUID');
    const { frameNumber } = target;
    if (frameNumber !== undefined) {
      if (!Number.isInteger(frameNumber) || frameNumber < 1) {
        throw new RangeError(
          `A frame number is a whole number from 1, not ${frameNumber.toString()}.`,
        );
      }
      if (frameNumber > 1) {
        throw new RangeError(
          `Frame ${frameNumber.toString()} was asked for, but multi-frame images are not supported yet.`,
        );
      }
    }
  }

  /** Shows the instance. Runs inside the queue, so a call that is already in it (a jump to a measurement) can use it. */
  async function navigateNow(target: NavigateTarget): Promise<NavigateResult> {
    const viewportId = target.viewportId ?? 'vp-0';
    requireViewport(viewportId);
    const { studyInstanceUID } = store.getState();
    if (studyInstanceUID === undefined) {
      throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
    }
    // Find the slice before changing anything, so a target that is not there leaves the viewport as it was.
    const series = await getSeries(studyInstanceUID, target.seriesInstanceUID);
    assertAlive();
    if (series.stacks.length === 0) {
      throw new Error(
        `Series ${target.seriesInstanceUID} (${series.modality}) has no images to display.`,
      );
    }
    const stackIndex = series.stacks.findIndex((stack) =>
      stack.instances.some((instance) => instance.sopInstanceUID === target.sopInstanceUID),
    );
    const stack = series.stacks[stackIndex];
    if (stack === undefined) {
      throw new Error(
        `Series ${target.seriesInstanceUID} has no instance ${target.sopInstanceUID}.`,
      );
    }
    const imageIndex = stack.instances.findIndex(
      (instance) => instance.sopInstanceUID === target.sopInstanceUID,
    );
    await applySeries(viewportId, target.seriesInstanceUID, { stackIndex, imageIndex });
    return {
      viewportId,
      seriesInstanceUID: target.seriesInstanceUID,
      stackIndex,
      imageIndex: viewportState(viewportId)?.imageIndex ?? imageIndex,
      sopInstanceUID: target.sopInstanceUID,
    };
  }

  function navigateTo(target: NavigateTarget): Promise<NavigateResult> {
    try {
      assertNavigateTarget(target);
      if (target.segmentations !== undefined) assertNavigateSegmentations(target.segmentations);
    } catch (error) {
      return Promise.reject(toError(error));
    }
    return enqueue(async () => {
      const result = await navigateNow(target);
      if (target.segmentations === undefined) return result;
      // After the slice is on screen: loading a SEG is slow, and the image must not wait for it.
      const failedSegmentations = await segmentations.applyNavigation(target.segmentations);
      return { ...result, failedSegmentations };
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
      if (patch.layout !== undefined) assertLayout(patch.layout);
      const emptied = studyChanged ? emptyViewports(current) : current.viewports;
      const base = patch.layout === undefined ? emptied : fitToLayout(emptied, patch.layout);
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
      if (unmatched !== undefined) {
        const known = merged.map((viewport) => viewport.id).join(', ');
        throw new Error(
          `There is no viewport ${unmatched.id} in the layout ${patch.layout ?? current.layout}. It has: ${known}.`,
        );
      }
      const candidate = parseViewerState({
        ...current,
        ...(patch.layout === undefined ? {} : { layout: patch.layout }),
        ...(patch.studyInstanceUID === undefined
          ? {}
          : { studyInstanceUID: patch.studyInstanceUID }),
        viewports: merged,
      });
      if (!candidate.ok) throw new Error(`Invalid state: ${candidate.error}`);

      if (studyChanged) {
        segmentations.studyChanged();
        seriesCache.clear();
        thumbnails.clear();
      }
      // A patch that changes nothing announces nothing: a page that echoes the state it was given must not set off a round of changes.
      if (studyChanged || !sameViewState(current, candidate.state)) {
        store.update(
          {
            studyInstanceUID: candidate.state.studyInstanceUID,
            layout: candidate.state.layout,
            viewports: candidate.state.viewports,
          },
          origin,
        );
      }
      dropRemovedViewports();
      for (const viewport of candidate.state.viewports) await syncViewport(viewport.id, origin);
    });
  }

  const tools: ToolsApi = {
    list: () => PRIMARY_TOOLS,
    getActive: () => activeTool,
    isAvailable(tool): boolean {
      if (tool !== 'crosshairs') return true;
      // The planes of each volume on screen: crosshairs link those of one volume.
      const planes = new Map<string, number>();
      for (const runtime of runtimes.values()) {
        const key = runtime.shown?.volumeKey;
        if (key !== undefined) planes.set(key, (planes.get(key) ?? 0) + 1);
      }
      return [...planes.values()].some((count) => count >= 2);
    },
    windowPresets: () => windowPresets,
    shortcuts: () =>
      keymap === undefined ? [] : [...keymap].map(([chord, action]) => ({ chord, action })),
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

  function perform(api: ViewportApi, action: KeyAction): Promise<void> {
    switch (action.type) {
      case 'scroll':
        return api.scrollBy(action.by);
      case 'scroll-to':
        return api.setImageIndex(action.position === 'first' ? 0 : api.imageCount - 1);
      case 'zoom':
        return api.zoomBy(action.factor);
      case 'invert':
        return api.toggleInvert();
      case 'reset':
        return api.resetView();
      case 'cine':
        if (api.cine.playing) {
          api.cine.stop();
          return Promise.resolve();
        }
        return api.cine.play();
      case 'tool':
        return tools.setActive(action.tool);
      case 'preset':
        return api.applyWindowPreset(action.id);
      case 'delete-measurement': {
        const id = measurements.api.getSelected();
        return id === undefined
          ? Promise.resolve()
          : measurements.api.remove(id).then(() => undefined);
      }
    }
  }

  // Keys held down repeat; scrolling and zooming should, a toggle should not.
  const repeatable = new Set<KeyAction['type']>(['scroll', 'zoom']);

  /** Listens for shortcuts on one viewport element. Returns what undoes it. */
  function listenForKeys(runtime: Runtime, element: HTMLElement): () => void {
    if (keymap === undefined) return noop;
    const addedTabIndex = !element.hasAttribute('tabindex');
    if (addedTabIndex) element.tabIndex = 0;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Read each time, since a layer may change the keys while the element is listening.
      const map = keymap;
      if (map === undefined || event.defaultPrevented || isTypingTarget(event.target)) return;
      const chord = chordOf(event);
      const action = chord === undefined ? undefined : map.get(chord);
      const { api } = runtime;
      // With nothing on screen there is nothing to act on, and the key is not ours to swallow.
      if (action === undefined || api === undefined || runtime.shown === undefined) return;
      // Delete and Backspace are only ours when there is a measurement picked to remove.
      if (action.type === 'delete-measurement' && measurements.api.getSelected() === undefined) {
        return;
      }
      event.preventDefault();
      if (event.repeat && !repeatable.has(action.type)) return;
      perform(api, action).catch((error: unknown) => {
        if (!destroyed) events.emit('error', { error: toError(error), context: 'keyboard' });
      });
    };
    const onPointerDown = (): void => {
      element.focus({ preventScroll: true });
    };
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('pointerdown', onPointerDown);
    return (): void => {
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('pointerdown', onPointerDown);
      if (addedTabIndex) element.removeAttribute('tabindex');
    };
  }

  /** Makes a viewport the active one, and says so when it was not. */
  function makeActive(viewportId: string): void {
    if (destroyed || viewportId === activeViewport) return;
    const previous = activeViewport;
    activeViewport = viewportId;
    events.emit('viewport:active', { viewportId, previous });
  }

  /** Follows the person: a press or the focus on a viewport element makes that viewport the active one. */
  function listenForActive(runtime: Runtime, element: HTMLElement): () => void {
    const choose = (): void => {
      // A viewport the layout has dropped is no longer anyone's to choose.
      if (viewportState(runtime.id) !== undefined) makeActive(runtime.id);
    };
    element.addEventListener('pointerdown', choose, true);
    element.addEventListener('focusin', choose);
    return (): void => {
      element.removeEventListener('pointerdown', choose, true);
      element.removeEventListener('focusin', choose);
    };
  }

  /** Draws the overlay again for every stack on screen, or removes it where the config no longer has one. */
  function refreshOverlays(): void {
    for (const runtime of runtimes.values()) {
      const { shown } = runtime;
      if (shown === undefined) continue;
      if (overlayOptions === undefined) {
        shown.overlay?.destroy();
        shown.overlay = undefined;
        continue;
      }
      shown.overlay ??= createOverlayView(shown.element);
      updateOverlay(shown);
    }
  }

  /** Listens for keys again on every element, since the keyboard may have been turned on or off. */
  function relistenAll(): void {
    for (const runtime of runtimes.values()) {
      if (runtime.element === undefined) continue;
      runtime.stopKeys?.();
      runtime.stopKeys = listenForKeys(runtime, runtime.element);
    }
  }

  /**
   * Makes the layers in `next` the ones in force. Everything that can throw is worked out first, so
   * a layer that cannot work leaves the viewer as it was.
   */
  function commitConfig(next: readonly { readonly body: ConfigBody }[]): void {
    const config = resolveConfig(layersOf(next));
    assertConfigCommands(config, commands);
    assertWindowPresets(config.windowLevelPresets);
    const nextKeymap = keymapOf(config);
    const keyboardChanged = (nextKeymap === undefined) !== (keymap === undefined);
    resolved = config;
    windowPresets = config.windowLevelPresets;
    keymap = nextKeymap;
    overlayOptions = overlayOptionsOf(config);
    applied.splice(0, applied.length, ...next);
    if (keyboardChanged) relistenAll();
    refreshOverlays();
    events.emit('config:changed', { config });
  }

  const configApi: ConfigApi = {
    get: () => resolved,
    apply(layer): () => void {
      assertAlive();
      const parsed = parseViewerConfig(layer);
      if (!parsed.ok) {
        throw new RangeError(`Invalid config layer:\n${parsed.errors.join('\n')}`);
      }
      if (parsed.config.tools !== undefined && parsed.config.tools !== null) {
        throw new RangeError(
          'A layer given to apply cannot have tools: the active tool is read when the viewer starts. Use viewer.tools.setActive.',
        );
      }
      const entry = { body: parsed.config };
      commitConfig([...applied, entry]);
      return (): void => {
        if (destroyed || !applied.includes(entry)) return;
        commitConfig(applied.filter((item) => item !== entry));
      };
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
          cine: undefined,
          stopKeys: undefined,
          stopActive: undefined,
        };
        runtimes.set(viewportId, runtime);
      }
      if (runtime.element === element) return;
      runtime.stopKeys?.();
      runtime.stopActive?.();
      runtime.element = element;
      runtime.stopKeys = listenForKeys(runtime, element);
      runtime.stopActive = listenForActive(runtime, element);
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
      runtime.stopKeys?.();
      runtime.stopKeys = undefined;
      runtime.stopActive?.();
      runtime.stopActive = undefined;
      runtime.element = undefined;
      runtime.api = undefined;
      if (!destroyed) {
        enqueue(() => {
          teardown(runtime);
          return Promise.resolve();
        }).catch(noop);
      }
    },
    get active(): string {
      return activeViewport;
    },
    setActive(viewportId): void {
      assertAlive();
      requireViewport(viewportId);
      makeActive(viewportId);
    },
    get: (viewportId) => runtimes.get(viewportId)?.api,
    list: () =>
      [...runtimes.values()].flatMap((runtime) => (runtime.api === undefined ? [] : [runtime.api])),
  };

  const viewer: Viewer = {
    ready,
    loadStudy,
    getStudy: () =>
      study !== undefined && study.studyInstanceUID === store.getState().studyInstanceUID
        ? study
        : undefined,
    viewports,
    tools,
    thumbnails: thumbnails.api,
    measurements: measurements.api,
    segmentations: segmentations.api,
    config: configApi,
    hangingProtocols,
    commands,
    ui: {
      registerPanel(panel): Unsubscribe {
        assertAlive();
        return ui.api.registerPanel(panel);
      },
      panels: () => ui.api.panels(),
    },
    setViewportSeries,
    navigateTo,
    setLayout,
    showMpr,
    getState: () => store.getState(),
    setState,
    subscribe: (selector, listener, subscribeOptions) =>
      store.subscribe(selector, listener, subscribeOptions),
    on: (event, handler) => events.on(event, handler),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const runtime of runtimes.values()) {
        runtime.stopKeys?.();
        runtime.stopActive?.();
        teardown(runtime);
      }
      runtimes.clear();
      seriesCache.clear();
      ui.clear();
      measurements.destroy();
      segmentations.destroy();
      // Whoever shows the panels is told they are gone, before the listeners are dropped.
      events.emit('ui:panels', { panels: [] });
      thumbnails.dispose();
      events.clear();
      // If the engine never started there is nothing to destroy; the failure reached `ready`.
      portPromise.then((port) => {
        port.destroy();
      }, noop);
    },
  };
  made.viewer = viewer;
  return viewer;
}
