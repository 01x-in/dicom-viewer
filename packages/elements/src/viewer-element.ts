import {
  createDicomWebDataSource,
  createViewer,
  type Viewer,
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
import { type DvSeriesBrowserElement, isDisplayableModality } from './series-browser';
import { baseStyles, themeStyles } from './theme';
import { DEFAULT_TOOLBAR, type ToolbarItem } from './toolbar-config';
import type { ThemeName } from './tokens';

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
  /** Where it came from: loading, the toolbar, a panel, or what the viewer reports (`attach`, `cine`, `keyboard`). */
  readonly context: string;
}

const INPUTS = [
  'options',
  'wadoRoot',
  'studyInstanceUid',
  'seriesInstanceUid',
  'assetsBaseUrl',
  'cpuRendering',
] as const;

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
    toolbarItems: { attribute: false },
    hideToolbar: { type: Boolean, attribute: 'hide-toolbar' },
    hideSeriesPanel: { type: Boolean, attribute: 'hide-series-panel' },
    label: {},
    status: { reflect: true },
    shown: { state: true },
    announcement: { state: true },
  };

  static override styles: CSSResultGroup = [
    themeStyles,
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
  declare theme: ThemeName;
  /** What the toolbar shows. Default: `DEFAULT_TOOLBAR`. */
  declare toolbarItems: readonly ToolbarItem[];
  declare hideToolbar: boolean;
  declare hideSeriesPanel: boolean;
  /** The accessible name of the viewer as a whole, a landmark. Default `DICOM viewer`. */
  declare label: string;
  declare status: ViewerStatus;
  declare shown: boolean;
  declare announcement: string;

  #viewer: Viewer | undefined;
  #generation = 0;
  #cleanups: (() => void)[] = [];
  #removeSeriesPanel: (() => void) | undefined;
  #announcer: ThrottledAnnouncer | undefined;
  #viewportElements: HTMLElement[] = [];

  constructor() {
    super();
    this.cpuRendering = false;
    this.theme = 'dark';
    this.toolbarItems = DEFAULT_TOOLBAR;
    this.hideToolbar = false;
    this.hideSeriesPanel = false;
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
    if (changed.has('theme')) {
      if (this.theme === 'light') this.setAttribute('data-theme', 'light');
      else this.removeAttribute('data-theme');
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
    this.#announcer?.cancel();
    this.#announcer = undefined;
    this.#viewer?.destroy();
    this.#viewer = undefined;
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

  #syncSeriesPanel(viewer: Viewer): void {
    if (this.hideSeriesPanel) {
      this.#removeSeriesPanel?.();
      this.#removeSeriesPanel = undefined;
      return;
    }
    if (this.#removeSeriesPanel !== undefined) return;
    this.#removeSeriesPanel = viewer.ui.registerPanel({
      id: 'series',
      title: 'Series',
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
      const viewer = createViewer(options);
      this.#viewer = viewer;
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
      );
      this.#syncSeriesPanel(viewer);
      // A throw here (and any later one) lands in the catch below, which reports it.
      this.#createViewportElements(viewer);
      await viewer.loadStudy(study);
      if (generation !== this.#generation) return;
      const wanted = this.seriesInstanceUid ?? this.#firstPictureSeries(viewer);
      const showing = viewer.getState().viewports.find((viewport) => viewport.id === 'vp-0');
      if (wanted !== undefined && showing?.seriesInstanceUID !== wanted) {
        await viewer.setViewportSeries('vp-0', wanted);
        if (generation !== this.#generation) return;
      }
      this.#refreshLabels(false);
      this.status = 'ready';
      this.dispatchEvent(
        new CustomEvent<ViewerReadyDetail>('dv-ready', {
          detail: { viewer, viewport: viewer.viewports.get('vp-0') },
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

  /** What to show when no series was asked for and none was restored. */
  #firstPictureSeries(viewer: Viewer): string | undefined {
    const restored = viewer.getState().viewports.find((viewport) => viewport.id === 'vp-0');
    if (restored?.seriesInstanceUID !== undefined) return restored.seriesInstanceUID;
    return viewer.getStudy()?.series.find((series) => isDisplayableModality(series.modality))
      ?.seriesInstanceUID;
  }

  override render(): TemplateResult {
    const viewer = this.#viewer;
    const { ids, columns, rows } = layoutCells(viewer?.getState().layout ?? '1x1');
    return html`<div class="shell" part="shell" role="region" aria-label=${this.label}>
      <div class="banner" part="banner"><slot name="banner"></slot></div>
      ${
        this.hideToolbar
          ? nothing
          : html`<dv-toolbar part="toolbar" .viewer=${viewer} .items=${this.toolbarItems}>
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
