import {
  createDicomWebDataSource,
  createViewer,
  type Viewer,
  type ViewportApi,
} from '@scope/viewer-core';
import {
  html,
  LitElement,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * M1 spike of the styled element. It proves Cornerstone works inside a Lit element:
 * the template renders into the element itself (light DOM), because Cornerstone attaches
 * resize observers and pointer listeners to real elements and breaks across shadow roots.
 */
export class DvViewerElement extends LitElement {
  static override properties: PropertyDeclarations = {
    wadoRoot: { attribute: 'wado-root' },
    studyInstanceUid: { attribute: 'study-uid' },
    seriesInstanceUid: { attribute: 'series-uid' },
    assetsBaseUrl: { attribute: 'assets-base-url' },
    cpuRendering: { type: Boolean, attribute: 'cpu-rendering' },
    status: { reflect: true },
  };

  declare wadoRoot: string | undefined;
  declare studyInstanceUid: string | undefined;
  declare seriesInstanceUid: string | undefined;
  /** When set, assets are loaded in `url` mode from here instead of the inline default. */
  declare assetsBaseUrl: string | undefined;
  declare cpuRendering: boolean;
  declare status: ViewerStatus;

  #viewer: Viewer | undefined;
  #generation = 0;

  constructor() {
    super();
    this.cpuRendering = false;
    this.status = 'idle';
  }

  override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): TemplateResult {
    return html`<div class="dv-viewport" style="width:100%;height:100%"></div>`;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#generation += 1;
    this.#viewer?.destroy();
    this.#viewer = undefined;
  }

  override updated(changed: PropertyValues<this>): void {
    const inputs = [
      'wadoRoot',
      'studyInstanceUid',
      'seriesInstanceUid',
      'assetsBaseUrl',
      'cpuRendering',
    ] as const;
    if (inputs.some((name) => changed.has(name))) void this.#load();
  }

  async #load(): Promise<void> {
    const { wadoRoot, studyInstanceUid, seriesInstanceUid } = this;
    const target = this.querySelector<HTMLElement>('.dv-viewport');
    if (
      wadoRoot === undefined ||
      studyInstanceUid === undefined ||
      seriesInstanceUid === undefined ||
      target === null
    ) {
      // An input was removed: stop the current viewer and invalidate any load still in flight,
      // so it cannot announce readiness for inputs that no longer exist.
      this.#generation += 1;
      this.#viewer?.destroy();
      this.#viewer = undefined;
      this.status = 'idle';
      return;
    }
    const generation = (this.#generation += 1);
    this.#viewer?.destroy();
    this.status = 'loading';
    try {
      const viewer = createViewer({
        dataSource: createDicomWebDataSource({ wadoRoot }),
        assets:
          this.assetsBaseUrl === undefined
            ? { mode: 'inline' }
            : { mode: 'url', baseUrl: this.assetsBaseUrl },
        cpuRendering: this.cpuRendering,
      });
      this.#viewer = viewer;
      viewer.viewports.attach('vp-0', target);
      await viewer.setState({
        studyInstanceUID: studyInstanceUid,
        viewports: [{ id: 'vp-0', seriesInstanceUID: seriesInstanceUid }],
      });
      const viewport = viewer.viewports.get('vp-0');
      if (generation !== this.#generation) return;
      if (viewport === undefined) throw new Error('The viewport was detached while loading.');
      this.status = 'ready';
      this.dispatchEvent(
        new CustomEvent<{ viewport: ViewportApi }>('dv-ready', {
          detail: { viewport },
          bubbles: true,
        }),
      );
    } catch (error) {
      if (generation !== this.#generation) return;
      this.status = 'error';
      this.dispatchEvent(
        new CustomEvent<{ error: Error }>('dv-error', {
          detail: { error: error instanceof Error ? error : new Error(String(error)) },
          bubbles: true,
        }),
      );
    }
  }
}
