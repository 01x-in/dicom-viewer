import {
  type CommandInput,
  createDicomWebDataSource,
  createViewer,
  parseViewerConfig,
  type ResolvedViewerConfig,
  type Viewer,
  type ViewerConfigV1,
  type ViewerOptions,
  type ViewportApi,
} from '@scope/viewer-core';
import {
  css,
  type CSSResultGroup,
  html,
  LitElement,
  nothing,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { layoutCells } from './layout';
import { createThrottledAnnouncer, describeViewport, type ThrottledAnnouncer } from './live-label';
import type { DvMeasurementListElement } from './measurement-list';
import type { DvSegmentationListElement } from './segmentation-list';
import { type DvSeriesBrowserElement, isDisplayableModality } from './series-browser';
import { baseStyles, shellThemeStyles } from './theme';
import { DEFAULT_TOOLBAR, type ToolbarItem } from './toolbar-config';
import type { PaletteName, ThemeName } from './tokens';
import type { ToolbarLabels } from './toolbar';
import { toolbarFromConfig } from './toolbar-from-config';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ViewerReadyDetail {
  readonly viewer: Viewer;
  /** The viewport `vp-0`, or `undefined` when the study has no series to show. */
  readonly viewport: ViewportApi | undefined;
}

export interface ViewerTeardownDetail {
  /** The viewer that is about to be destroyed. */
  readonly viewer: Viewer;
}

export interface ViewerErrorDetail {
  readonly error: Error;
  /** Where it came from: loading, the toolbar, a panel, or what the viewer reports (`attach`, `cine`, `keyboard`, `measurement`). */
  readonly context: string;
}

const INPUTS = [
  'options',
  'wadoRoot',
  'studyInstanceUid',
  'seriesInstanceUid',
  'assetsBaseUrl',
  'cpuRendering',
  'config',
  'commands',
  'configUrl',
  'configOrigins',
] as const;

/** The most a config file may be. Settings are small, and a file that is not is not settings. */
export const MAX_CONFIG_CHARACTERS = 262_144;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The styled viewer: a banner, a toolbar, panels either side, and the viewports between them.
 * The chrome is shadow DOM. The viewports are not: they are light-DOM children of this element,
 * shown through named slots, so Cornerstone measures and listens on real elements
 * (docs/adr/0007-styled-shell.md).
 *
 * Give it `options` (a `ViewerOptions`) or `wado-root`, and a `study-uid`. Without a `series-uid`
 * it shows the first series that has pictures. Size it: it fills its parent's height.
 *
 * Events: `dv-ready` (`{ viewer, viewport }`), `dv-teardown` (`{ viewer }`, before it is destroyed), and `dv-error`
 * (`{ error, context }`). Slots: `banner`, `toolbar-start`, `toolbar-end`, `panel-left`, `panel-right`, `viewport-overlay`,
 * `empty-state`. Parts: `shell`, `banner`, `body`, `stage`, and those of the toolbar and panels.
 */
export class DvViewerElement extends LitElement {
  static override properties: PropertyDeclarations = {
    options: { attribute: false },
    wadoRoot: { attribute: 'wado-root' },
    studyInstanceUid: { attribute: 'study-uid' },
    seriesInstanceUid: { attribute: 'series-uid' },
    assetsBaseUrl: { attribute: 'assets-base-url' },
    cpuRendering: { type: Boolean, attribute: 'cpu-rendering' },
    theme: { reflect: true },
    palette: { reflect: true },
    config: {},
    commands: { attribute: false },
    configUrl: { attribute: 'config-url' },
    configOrigins: {
      attribute: 'config-origins',
      converter: {
        fromAttribute: (value: string | null): readonly string[] | undefined =>
          value === null
            ? undefined
            : value
                .split(',')
                .map((origin) => origin.trim())
                .filter((origin) => origin !== ''),
      },
    },
    resolved: { state: true },
    toolbarItems: { attribute: false },
    toolbarLabels: { attribute: 'toolbar-labels' },
    hideToolbar: { type: Boolean, attribute: 'hide-toolbar' },
    hideSeriesPanel: { type: Boolean, attribute: 'hide-series-panel' },
    hideMeasurementsPanel: { type: Boolean, attribute: 'hide-measurements-panel' },
    hideSegmentationsPanel: { type: Boolean, attribute: 'hide-segmentations-panel' },
    label: {},
    status: { reflect: true },
    shown: { state: true },
    announcement: { state: true },
  };

  static override styles: CSSResultGroup = [
    shellThemeStyles,
    baseStyles,
    css`
      :host {
        display: block;
        height: 100%;
        min-height: 16rem;
        color: var(--dv-color-text);
        background: var(--dv-color-bg);
      }
      .shell {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .body {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      dv-panel-dock {
        flex: none;
        width: var(--dv-panel-width);
        border-inline: 1px solid var(--dv-color-border);
      }
      dv-panel-dock[collapsed] {
        width: calc(var(--dv-control-size) + var(--dv-space) * 3);
      }
      ::slotted([slot='panel-left']),
      ::slotted([slot='panel-right']) {
        flex: none;
        width: var(--dv-panel-width);
        overflow: auto;
        background: var(--dv-color-surface);
      }
      .stage {
        position: relative;
        flex: 1;
        min-width: 0;
        display: grid;
        gap: 2px;
        background: var(--dv-color-bg);
      }
      .cell {
        position: relative;
        min-width: 0;
        min-height: 0;
        background: var(--dv-viewport-bg);
      }
      ::slotted([data-viewport-id]) {
        position: absolute;
        inset: 0;
        background: var(--dv-viewport-bg);
      }
      ::slotted([data-viewport-id]:focus-visible) {
        outline: 2px solid var(--dv-color-focus);
        outline-offset: -2px;
      }
      .overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .empty {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: var(--dv-color-text-muted);
        pointer-events: none;
      }
      @media (max-width: 40rem) {
        .body {
          flex-direction: column;
        }
        dv-panel-dock,
        ::slotted([slot='panel-left']),
        ::slotted([slot='panel-right']) {
          width: auto;
          max-height: 40%;
          border-inline: 0;
          border-block: 1px solid var(--dv-color-border);
        }
      }
    `,
  ];

  /** A complete `ViewerOptions`. Wins over `wado-root` and the other attributes that stand in for it. */
  declare options: ViewerOptions | undefined;
  declare wadoRoot: string | undefined;
  declare studyInstanceUid: string | undefined;
  declare seriesInstanceUid: string | undefined;
  /** When set, assets are loaded in `url` mode from here instead of the inline default. */
  declare assetsBaseUrl: string | undefined;
  declare cpuRendering: boolean;
  declare theme: ThemeName | undefined;
  /** The colours of the chrome: `default`, `navy`, or `graphite`. A host can still change any one with a `--dv-color-*` property. */
  declare palette: PaletteName | undefined;
  /** What the toolbar shows. `undefined`: `DEFAULT_TOOLBAR`. */
  declare toolbarItems: readonly ToolbarItem[] | undefined;
  /** `tooltip` (default): toolbar buttons show a picture and a tooltip. `inline`: the name is beside the picture. */
  declare toolbarLabels: ToolbarLabels | undefined;
  declare hideToolbar: boolean;
  /**
   * Settings as data: a `ViewerConfigV1`, several of them (the last one wins), or JSON text (the
   * attribute). A setting made by the page, such as `theme` or `toolbarItems`, wins over the config.
   * A config with a problem is refused whole with a `dv-error` (context `config`), and the viewer
   * starts without it.
   */
  declare config: ViewerConfigV1 | readonly ViewerConfigV1[] | string | undefined;
  /**
   * A config file to fetch, as JSON. Off unless `configOrigins` lists its origin: a URL that came
   * from outside the page must not send the viewer to a server of someone else's choosing. The file
   * is data, size-limited, checked, and never run. A failure is a `dv-error` (context `config`), and
   * the viewer starts without it. A `config` of the page's own wins over the file.
   */
  declare configUrl: string | undefined;
  /** The origins `configUrl` may point to, such as `https://cdn.example.org`. Add `location.origin` for the page's own. */
  declare configOrigins: readonly string[] | undefined;
  /** Commands of your own, for a config to name: `{ 'acme.export': () => ... }`. */
  declare commands: Readonly<Record<string, CommandInput>> | undefined;
  /** What the viewer's config comes to now, so the shell draws it. */
  declare resolved: ResolvedViewerConfig | undefined;
  declare hideSeriesPanel: boolean;
  declare hideMeasurementsPanel: boolean;
  declare hideSegmentationsPanel: boolean;
  /** The accessible name of the viewer as a whole, a landmark. Default `DICOM viewer`. */
  declare label: string;
  declare status: ViewerStatus;
  declare shown: boolean;
  declare announcement: string;

  #viewer: Viewer | undefined;
  #generation = 0;
  #cleanups: (() => void)[] = [];
  #removeSeriesPanel: (() => void) | undefined;
  #removeMeasurementsPanel: (() => void) | undefined;
  #removeSegmentationsPanel: (() => void) | undefined;
  #announcer: ThrottledAnnouncer | undefined;
  #viewportElements: HTMLElement[] = [];

  constructor() {
    super();
    this.cpuRendering = false;
    this.theme = undefined;
    this.palette = undefined;
    this.config = undefined;
    this.commands = undefined;
    this.configUrl = undefined;
    this.configOrigins = undefined;
    this.resolved = undefined;
    this.toolbarItems = undefined;
    this.toolbarLabels = undefined;
    this.hideToolbar = false;
    this.hideSeriesPanel = false;
    this.hideMeasurementsPanel = false;
    this.hideSegmentationsPanel = false;
    this.label = 'DICOM viewer';
    this.status = 'idle';
    this.shown = false;
    this.announcement = '';
  }

  /** The viewer this element runs, while it has one. */
  get viewer(): Viewer | undefined {
    return this.#viewer;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // A moved element lost its viewer in disconnectedCallback.
    if (this.hasUpdated) void this.#load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#generation += 1;
    this.#teardown();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('theme') || changed.has('resolved')) {
      // What the page set wins over the config, and `dark` is what is left.
      const theme = this.theme ?? this.resolved?.theme;
      if (theme === 'light') this.setAttribute('data-theme', 'light');
      else this.removeAttribute('data-theme');
    }
    if (changed.has('palette') || changed.has('resolved')) {
      const palette = this.palette ?? this.resolved?.palette;
      if (palette === undefined || palette === 'default') this.removeAttribute('data-palette');
      else this.setAttribute('data-palette', palette);
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (INPUTS.some((name) => changed.has(name))) {
      void this.#load();
      return;
    }
    if (changed.has('hideSeriesPanel') && this.#viewer !== undefined) {
      this.#syncSeriesPanel(this.#viewer);
    }
    if (changed.has('hideSegmentationsPanel') && this.#viewer !== undefined) {
      this.#syncSegmentationsPanel(this.#viewer);
    }
    if (changed.has('hideMeasurementsPanel') && this.#viewer !== undefined) {
      this.#syncMeasurementsPanel(this.#viewer);
    }
  }

  #teardown(): void {
    // Told first, while the viewer still works, so a host can let go of it (an adapter drops its
    // subscriptions and its reference).
    if (this.#viewer !== undefined) {
      this.dispatchEvent(
        new CustomEvent<ViewerTeardownDetail>('dv-teardown', {
          detail: { viewer: this.#viewer },
          bubbles: true,
          composed: true,
        }),
      );
    }
    for (const stop of this.#cleanups.splice(0)) stop();
    this.#removeSeriesPanel?.();
    this.#removeSeriesPanel = undefined;
    this.#removeMeasurementsPanel?.();
    this.#removeMeasurementsPanel = undefined;
    this.#removeSegmentationsPanel?.();
    this.#removeSegmentationsPanel = undefined;
    this.#announcer?.cancel();
    this.#announcer = undefined;
    this.#viewer?.destroy();
    this.#viewer = undefined;
    this.resolved = undefined;
    this.requestUpdate();
    for (const element of this.#viewportElements.splice(0)) element.remove();
    this.shown = false;
    this.announcement = '';
  }

  #fail(error: unknown, context: string): void {
    this.dispatchEvent(
      new CustomEvent<ViewerErrorDetail>('dv-error', {
        detail: { error: toError(error), context },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The config file at `configUrl`, if the page asked for one and its origin is allowed. Every
   * failure is reported and is `undefined`, so a file that cannot be had does not take the viewer away.
   */
  async #fetchConfig(): Promise<ViewerConfigV1 | undefined> {
    const { configUrl } = this;
    if (configUrl === undefined || configUrl === '') return undefined;
    try {
      const url = new URL(configUrl, document.baseURI);
      if (!(this.configOrigins ?? []).includes(url.origin)) {
        throw new RangeError(
          `The config URL is on ${url.origin}, which is not in config-origins. Add it there to allow it.`,
        );
      }
      // No cookies go to it, and a redirect (which could leave the list) is an error.
      const response = await fetch(url, { credentials: 'omit', redirect: 'error' });
      if (!response.ok) {
        throw new Error(`The config at ${url.href} answered ${response.status.toString()}.`);
      }
      const length = Number(response.headers.get('content-length'));
      const text = await response.text();
      if (text.length > MAX_CONFIG_CHARACTERS || length > MAX_CONFIG_CHARACTERS) {
        throw new RangeError(
          `The config at ${url.href} is larger than ${MAX_CONFIG_CHARACTERS.toString()} characters.`,
        );
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new SyntaxError(`The config at ${url.href} is not valid JSON.`);
      }
      const parsed = parseViewerConfig(data);
      if (!parsed.ok) {
        throw new RangeError(`Invalid config at ${url.href}:\n${parsed.errors.join('\n')}`);
      }
      return parsed.config;
    } catch (error) {
      this.#fail(error, 'config');
      return undefined;
    }
  }

  /** The layers of the `config` property that pass the check. A layer that does not is reported, and left out. */
  #configLayers(): ViewerConfigV1[] {
    let given: unknown = this.config;
    if (given === undefined || given === '') return [];
    if (typeof given === 'string') {
      try {
        given = JSON.parse(given) as unknown;
      } catch {
        this.#fail(new SyntaxError('The config is not valid JSON.'), 'config');
        return [];
      }
    }
    const layers: unknown[] = Array.isArray(given) ? given : [given];
    const valid: ViewerConfigV1[] = [];
    layers.forEach((layer, index) => {
      const parsed = parseViewerConfig(layer);
      if (parsed.ok) {
        valid.push(parsed.config);
        return;
      }
      const where = layers.length === 1 ? 'config' : `config[${index.toString()}]`;
      this.#fail(new RangeError(`Invalid ${where}:\n${parsed.errors.join('\n')}`), 'config');
    });
    return valid;
  }

  /**
   * The viewer, with the config. A config that checks out alone but cannot work with this viewer
   * (a toolbar that names a command nobody registered) is reported, and the viewer is made without
   * it, so a mistake in settings does not take the viewer away.
   */
  #makeViewer(options: ViewerOptions, fetched: ViewerConfigV1 | undefined): Viewer {
    const fromOptions =
      options.config === undefined
        ? []
        : Array.isArray(options.config)
          ? (options.config as readonly ViewerConfigV1[])
          : [options.config as ViewerConfigV1];
    const withCommands: ViewerOptions =
      this.commands === undefined
        ? options
        : { ...options, commands: { ...options.commands, ...this.commands } };
    // The file first, so the page's own config wins over it.
    const layers = [...(fetched === undefined ? [] : [fetched]), ...this.#configLayers()];
    if (layers.length === 0) return createViewer(withCommands);
    try {
      return createViewer({ ...withCommands, config: [...fromOptions, ...layers] });
    } catch (error) {
      if (!(error instanceof RangeError) || !error.message.startsWith('Invalid config'))
        throw error;
      this.#fail(error, 'config');
      return createViewer(withCommands);
    }
  }

  #resolveOptions(): ViewerOptions | undefined {
    if (this.options !== undefined) return this.options;
    if (this.wadoRoot === undefined) return undefined;
    return {
      dataSource: createDicomWebDataSource({ wadoRoot: this.wadoRoot }),
      assets:
        this.assetsBaseUrl === undefined
          ? { mode: 'inline' }
          : { mode: 'url', baseUrl: this.assetsBaseUrl },
      cpuRendering: this.cpuRendering,
    };
  }

  /** The viewports go in the light DOM, where Cornerstone can measure them, named for the slot that shows them. */
  #createViewportElements(viewer: Viewer): void {
    const { ids } = layoutCells(viewer.getState().layout);
    for (const id of ids) {
      const element = document.createElement('div');
      element.slot = `viewport-${id}`;
      element.className = 'dv-viewport';
      element.dataset['viewportId'] = id;
      element.setAttribute('role', 'img');
      element.setAttribute('aria-roledescription', 'DICOM viewport');
      element.setAttribute(
        'aria-label',
        describeViewport({ name: undefined, imageIndex: undefined, imageCount: 0 }),
      );
      this.append(element);
      this.#viewportElements.push(element);
      viewer.viewports.attach(id, element);
    }
  }

  /** The label of each viewport follows what it shows; the live region says it, not on every slice. */
  #refreshLabels(announce: boolean): void {
    const viewer = this.#viewer;
    if (viewer === undefined) return;
    const state = viewer.getState();
    const series = viewer.getStudy()?.series ?? [];
    const spoken: string[] = [];
    for (const element of this.#viewportElements) {
      const id = element.dataset['viewportId'];
      const viewport = state.viewports.find((candidate) => candidate.id === id);
      const api = id === undefined ? undefined : viewer.viewports.get(id);
      const summary = series.find((item) => item.seriesInstanceUID === viewport?.seriesInstanceUID);
      const text = describeViewport({
        name: summary === undefined ? undefined : (summary.description ?? summary.modality),
        imageIndex: viewport?.imageIndex,
        imageCount: api?.imageCount ?? 0,
        window: viewport?.window,
        invert: viewport?.invert,
        zoom: viewport?.zoom,
      });
      element.setAttribute('aria-label', text);
      spoken.push(text);
    }
    this.shown = state.viewports.some((viewport) => viewport.seriesInstanceUID !== undefined);
    if (announce) this.#announcer?.push(spoken.join('. '));
  }

  /** A built-in panel is left out when the page says so, or the config does. */
  #hidden(panel: 'series' | 'measurements' | 'segmentations', asked: boolean): boolean {
    return asked || this.resolved?.panels.hide.includes(panel) === true;
  }

  #syncSeriesPanel(viewer: Viewer): void {
    if (this.#hidden('series', this.hideSeriesPanel)) {
      this.#removeSeriesPanel?.();
      this.#removeSeriesPanel = undefined;
      return;
    }
    if (this.#removeSeriesPanel !== undefined) return;
    this.#removeSeriesPanel = viewer.ui.registerPanel({
      id: 'series',
      title: 'Series',
      icon: 'series',
      placement: 'left',
      mount: (container) => {
        const browser = document.createElement('dv-series-browser') as DvSeriesBrowserElement;
        browser.viewer = viewer;
        container.append(browser);
        return (): void => {
          browser.remove();
        };
      },
    });
  }

  #syncMeasurementsPanel(viewer: Viewer): void {
    if (this.#hidden('measurements', this.hideMeasurementsPanel)) {
      this.#removeMeasurementsPanel?.();
      this.#removeMeasurementsPanel = undefined;
      return;
    }
    if (this.#removeMeasurementsPanel !== undefined) return;
    this.#removeMeasurementsPanel = viewer.ui.registerPanel({
      id: 'measurements',
      title: 'Measurements',
      icon: 'measure',
      placement: 'right',
      mount: (container) => {
        const list = document.createElement('dv-measurement-list') as DvMeasurementListElement;
        list.viewer = viewer;
        container.append(list);
        return (): void => {
          list.remove();
        };
      },
    });
  }

  #syncSegmentationsPanel(viewer: Viewer): void {
    if (this.#hidden('segmentations', this.hideSegmentationsPanel)) {
      this.#removeSegmentationsPanel?.();
      this.#removeSegmentationsPanel = undefined;
      return;
    }
    if (this.#removeSegmentationsPanel !== undefined) return;
    this.#removeSegmentationsPanel = viewer.ui.registerPanel({
      id: 'segmentations',
      title: 'Segments',
      icon: 'segments',
      placement: 'right',
      mount: (container) => {
        const list = document.createElement('dv-segmentation-list') as DvSegmentationListElement;
        list.viewer = viewer;
        container.append(list);
        return (): void => {
          list.remove();
        };
      },
    });
  }

  async #load(): Promise<void> {
    const generation = (this.#generation += 1);
    this.#teardown();
    const options = this.#resolveOptions();
    const study = this.studyInstanceUid;
    if (options === undefined || study === undefined) {
      // An input was removed: the viewer is stopped, and any load still in flight is invalidated, so
      // it cannot announce readiness for inputs that no longer exist.
      this.status = 'idle';
      return;
    }
    this.status = 'loading';
    try {
      const fetched = await this.#fetchConfig();
      if (generation !== this.#generation) return;
      const viewer = this.#makeViewer(options, fetched);
      this.#viewer = viewer;
      this.resolved = viewer.config.get();
      this.requestUpdate();
      this.#announcer = createThrottledAnnouncer((text) => {
        this.announcement = text;
      });
      this.#cleanups.push(
        viewer.on('error', ({ error, context }) => {
          this.#fail(error, context);
        }),
        viewer.on('state:changed', () => {
          this.#refreshLabels(true);
        }),
        viewer.on('study:loaded', () => {
          this.#refreshLabels(false);
        }),
        viewer.on('config:changed', ({ config }) => {
          this.resolved = config;
          this.#syncSeriesPanel(viewer);
          this.#syncMeasurementsPanel(viewer);
          this.#syncSegmentationsPanel(viewer);
        }),
      );
      this.#syncSeriesPanel(viewer);
      this.#syncMeasurementsPanel(viewer);
      this.#syncSegmentationsPanel(viewer);
      // A throw here (and any later one) lands in the catch below, which reports it.
      this.#createViewportElements(viewer);
      await viewer.loadStudy(study);
      if (generation !== this.#generation) return;
      const showing = viewer.getState().viewports.find((viewport) => viewport.id === 'vp-0');
      if (this.seriesInstanceUid !== undefined) {
        if (showing?.seriesInstanceUID !== this.seriesInstanceUid) {
          await viewer.setViewportSeries('vp-0', this.seriesInstanceUid);
        }
      } else if (showing?.seriesInstanceUID === undefined) {
        // Nothing asked for and nothing restored.
        await this.#showFirstPictureSeries(viewer, generation);
      }
      if (generation !== this.#generation) return;
      this.#refreshLabels(false);
      this.status = 'ready';
      this.dispatchEvent(
        new CustomEvent<ViewerReadyDetail>('dv-ready', {
          detail: { viewer, viewport: this.#shownViewport(viewer) },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (generation !== this.#generation) return;
      // A viewer that did not come up must not keep its engine, worker threads, or cache.
      this.#teardown();
      this.status = 'error';
      this.#fail(error, 'load');
    }
  }

  /** The viewport `vp-0`, but only while it shows a series: an empty study has nothing to hand over. */
  #shownViewport(viewer: Viewer): ViewportApi | undefined {
    const viewport = viewer.viewports.get('vp-0');
    return viewport?.series === undefined ? undefined : viewport;
  }

  /**
   * Shows the first series that has pictures. A series is only known to have none when it is
   * opened (its images may lack a size), so a failure moves on to the next; if none can be shown the
   * last failure is the load's.
   */
  async #showFirstPictureSeries(viewer: Viewer, generation: number): Promise<void> {
    const candidates = (viewer.getStudy()?.series ?? []).filter((series) =>
      isDisplayableModality(series.modality),
    );
    let failure: unknown;
    for (const candidate of candidates) {
      if (generation !== this.#generation) return;
      try {
        await viewer.setViewportSeries('vp-0', candidate.seriesInstanceUID);
        return;
      } catch (error) {
        failure = error;
      }
    }
    if (candidates.length > 0) throw toError(failure);
  }

  #compiledToolbar: { viewer: Viewer; source: unknown; items: readonly ToolbarItem[] } | undefined;

  /** The buttons: the page's own, else the config's, else the built-in ones. A config's are made once, not on every draw. */
  #toolbarItems(viewer: Viewer | undefined): readonly ToolbarItem[] {
    if (this.toolbarItems !== undefined) return this.toolbarItems;
    const source = this.resolved?.toolbar.items;
    if (source === undefined || viewer === undefined) return DEFAULT_TOOLBAR;
    if (this.#compiledToolbar?.viewer !== viewer || this.#compiledToolbar.source !== source) {
      this.#compiledToolbar = { viewer, source, items: toolbarFromConfig(source, viewer) };
    }
    return this.#compiledToolbar.items;
  }

  override render(): TemplateResult {
    const viewer = this.#viewer;
    const { ids, columns, rows } = layoutCells(viewer?.getState().layout ?? '1x1');
    return html`<div class="shell" part="shell" role="region" aria-label=${this.label}>
      <div class="banner" part="banner"><slot name="banner"></slot></div>
      ${
        this.hideToolbar || this.resolved?.toolbar.hidden === true
          ? nothing
          : html`<dv-toolbar part="toolbar" .viewer=${viewer} .items=${this.#toolbarItems(viewer)} .labels=${this.toolbarLabels ?? this.resolved?.toolbar.labels ?? 'tooltip'}>
            <slot name="toolbar-start" slot="start"></slot>
            <slot name="toolbar-end" slot="end"></slot>
          </dv-toolbar>`
      }
      <div class="body" part="body">
        <dv-panel-dock part="dock-left" .viewer=${viewer} placement="left"></dv-panel-dock>
        <slot name="panel-left"></slot>
        <div
          class="stage"
          part="stage"
          style=${`grid-template-columns: repeat(${columns.toString()}, minmax(0, 1fr)); grid-template-rows: repeat(${rows.toString()}, minmax(0, 1fr));`}
        >
          ${ids.map((id) => html`<div class="cell"><slot name="viewport-${id}"></slot></div>`)}
          <div class="overlay"><slot name="viewport-overlay"></slot></div>
          ${
            this.shown || this.status === 'loading'
              ? nothing
              : html`<div class="empty"><slot name="empty-state">Choose a series to view.</slot></div>`
          }
          <div class="dv-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            ${this.announcement}
          </div>
        </div>
        <slot name="panel-right"></slot>
        <dv-panel-dock part="dock-right" .viewer=${viewer} placement="right"></dv-panel-dock>
      </div>
    </div>`;
  }
}
