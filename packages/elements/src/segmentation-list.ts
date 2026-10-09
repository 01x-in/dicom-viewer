import {
  colorToHex,
  parseColor,
  type SegmentationInfo,
  type SegmentInfo,
  type SeriesSummary,
  type Viewer,
} from '@scope/viewer-core';
import {
  css,
  type CSSResultGroup,
  unsafeCSS,
  html,
  LitElement,
  nothing,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { icon, iconMask, iconStyles } from './icons';
import { baseStyles, themeStyles } from './theme';

const EVENTS = [
  'segmentation:loaded',
  'segmentation:unloaded',
  'segmentation:updated',
  'study:loaded',
  'state:changed',
] as const;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** What a SEG is called in the list: its series description, or its number. */
export function segmentationName(series: SeriesSummary): string {
  const number = series.seriesNumber === undefined ? '' : `${series.seriesNumber.toString()}. `;
  return `${number}${series.description ?? 'SEG'}`;
}

/** Runs the newest value of something that changes fast, such as a slider, one call at a time. */
function latestWins<T>(
  apply: (value: T) => Promise<void>,
  fail: (error: unknown) => void,
  idle: () => void,
): (value: T) => void {
  let running = false;
  let waiting: { value: T } | undefined;
  const pump = (value: T): void => {
    running = true;
    apply(value)
      .catch(fail)
      .finally(() => {
        running = false;
        const next = waiting;
        waiting = undefined;
        if (next !== undefined) pump(next.value);
        else idle();
      });
  };
  return (value: T): void => {
    if (running) waiting = { value };
    else pump(value);
  };
}

/**
 * The SEGs of the study on screen. Each one can be loaded, and then shown or hidden as a whole,
 * made more or less opaque, and unloaded. Each of its segments can be shown, hidden, recoloured,
 * made more or less opaque, highlighted, and gone to. Chrome only, so it uses shadow DOM.
 */
export class DvSegmentationListElement extends LitElement {
  static override properties: PropertyDeclarations = {
    viewer: { attribute: false },
    viewportId: { attribute: 'viewport-id' },
    label: {},
    series: { state: true },
    loaded: { state: true },
    loading: { state: true },
  };

  /** @internal The component's own CSS. */
  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    iconStyles,
    css`
      :host {
        display: block;
        min-height: 0;
        overflow-y: auto;
        background: var(--dv-color-surface, #171b21);
        --dv-eye: ${unsafeCSS(iconMask('eye'))};
        --dv-eye-off: ${unsafeCSS(iconMask('eye-off'))};
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .seg-list {
        display: flex;
        flex-direction: column;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        padding: calc(var(--dv-space, 0.25rem) * 2);
      }
      .seg {
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius-lg, 8px);
        background: var(--dv-color-surface-raised, #212731);
        overflow: hidden;
      }
      .seg-head {
        display: flex;
        align-items: center;
        gap: calc(var(--dv-space, 0.25rem) * 1.5);
        padding: calc(var(--dv-space, 0.25rem) * 1.5) calc(var(--dv-space, 0.25rem) * 2);
      }
      .seg-title {
        flex: 1;
        min-width: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .seg-opacity,
      .segment-opacity {
        display: flex;
        align-items: center;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8125rem;
      }
      .seg-opacity {
        padding: 0 calc(var(--dv-space, 0.25rem) * 3) calc(var(--dv-space, 0.25rem) * 2);
      }
      .seg-opacity input,
      .segment-opacity input {
        flex: 1;
        min-width: 0;
      }
      .percent {
        min-width: 2.5em;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .warnings {
        display: flex;
        flex-direction: column;
        gap: var(--dv-space, 0.25rem);
        margin: 0 calc(var(--dv-space, 0.25rem) * 2) calc(var(--dv-space, 0.25rem) * 2);
        padding: calc(var(--dv-space, 0.25rem) * 2);
        border: 1px solid var(--dv-color-danger, #ff8f8f);
        border-radius: var(--dv-radius, 6px);
        color: var(--dv-color-text, #e8ebf0);
        font-size: 0.8125rem;
      }
      .warnings li {
        display: flex;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: flex-start;
      }
      .warnings .icon {
        width: 1rem;
        height: 1rem;
        margin-top: 0.1rem;
        color: var(--dv-color-danger, #ff8f8f);
      }
      .segments {
        border-top: 1px solid var(--dv-color-border, #667284);
      }
      .segment {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr) auto auto;
        align-items: center;
        column-gap: calc(var(--dv-space, 0.25rem) * 1.5);
        row-gap: 0;
        padding: var(--dv-space, 0.25rem) calc(var(--dv-space, 0.25rem) * 2);
      }
      .segment + .segment {
        border-top: 1px solid color-mix(in srgb, var(--dv-color-border, #667284) 45%, transparent);
      }
      .segment-name {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .segment-name small {
        display: block;
        color: var(--dv-color-text-muted, #a7b0be);
      }
      .segment-opacity {
        grid-column: 3 / -1;
        padding-bottom: calc(var(--dv-space, 0.25rem) * 1);
        font-size: 0.75rem;
      }
      /* The eye: a real checkbox, so the keyboard and the screen reader get what they expect. */
      input[type='checkbox'] {
        appearance: none;
        display: grid;
        place-items: center;
        flex: none;
        width: 1.75rem;
        height: 1.75rem;
        margin: 0;
        color: var(--dv-color-text-muted, #a7b0be);
        border-radius: var(--dv-radius, 6px);
        cursor: pointer;
      }
      input[type='checkbox']::before {
        content: '';
        width: var(--dv-icon-size, 1.25rem);
        height: var(--dv-icon-size, 1.25rem);
        background: currentcolor;
        mask: var(--dv-eye-off) center / contain no-repeat;
        -webkit-mask: var(--dv-eye-off) center / contain no-repeat;
      }
      input[type='checkbox']:checked {
        color: var(--dv-color-text, #e8ebf0);
      }
      input[type='checkbox']:checked::before {
        mask-image: var(--dv-eye);
        -webkit-mask-image: var(--dv-eye);
      }
      input[type='checkbox']:hover {
        background: var(--dv-color-surface, #171b21);
      }
      /* The colour: a round swatch. */
      input[type='color'] {
        appearance: none;
        flex: none;
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
      }
      input[type='color']::-webkit-color-swatch-wrapper {
        padding: 0;
      }
      input[type='color']::-webkit-color-swatch {
        border: 2px solid var(--dv-color-text, #e8ebf0);
        border-radius: 50%;
      }
      input[type='color']::-moz-color-swatch {
        border: 2px solid var(--dv-color-text, #e8ebf0);
        border-radius: 50%;
      }
      input[type='range'] {
        accent-color: var(--dv-color-accent, #5aa9ff);
        height: 1.25rem;
        margin: 0;
      }
      button {
        font: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: calc(var(--dv-space, 0.25rem) * 1.5);
        min-width: 1.75rem;
        height: 1.75rem;
        padding: 0 calc(var(--dv-space, 0.25rem) * 2);
        color: var(--dv-color-text, #e8ebf0);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--dv-radius, 6px);
        cursor: pointer;
        transition: background-color 0.12s;
      }
      button:hover {
        background: var(--dv-color-surface, #171b21);
      }
      button.icon-button {
        padding: 0;
      }
      button.text-button {
        border-color: var(--dv-color-border, #667284);
      }
      button.primary {
        color: var(--dv-color-accent-text, #06121f);
        background: var(--dv-color-accent, #5aa9ff);
        border-color: var(--dv-color-accent, #5aa9ff);
      }
      button.primary:hover {
        background: var(--dv-color-accent, #5aa9ff);
        filter: brightness(1.1);
      }
      button[aria-pressed='true'] {
        background: var(--dv-color-accent, #5aa9ff);
        color: var(--dv-color-accent-text, #06121f);
        border-color: var(--dv-color-accent, #5aa9ff);
      }
      button[aria-disabled='true'] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        margin: 0;
        padding: calc(var(--dv-space, 0.25rem) * 8) calc(var(--dv-space, 0.25rem) * 4);
        text-align: center;
        color: var(--dv-color-text-muted, #a7b0be);
      }
      .empty .icon {
        width: 2rem;
        height: 2rem;
        opacity: 0.7;
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  declare viewportId: string | undefined;
  declare label: string;
  /** The SEG series of the study on screen. */
  declare series: readonly SeriesSummary[];
  declare loaded: readonly SegmentationInfo[];
  /** SEGs being loaded, so a second press does nothing and the row says so. */
  declare loading: ReadonlySet<string>;

  #off: (() => void)[] = [];
  #listeningTo: Viewer | undefined;
  /** What a slider shows while it is being moved: the model is a call behind it. */
  readonly #dragging = new Map<string, number | string>();
  readonly #pushers = new Map<string, (value: number | string) => void>();

  constructor() {
    super();
    this.viewportId = undefined;
    this.label = 'Segmentations';
    this.series = [];
    this.loaded = [];
    this.loading = new Set();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#listen();
    this.#sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopListening();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('viewer')) {
      // Whatever was waiting to be sent was for the last viewer.
      this.#pushers.clear();
      this.#dragging.clear();
      this.#listen();
      this.#sync();
    }
  }

  #listen(): void {
    const { viewer } = this;
    if (viewer === this.#listeningTo && this.#off.length > 0) return;
    this.#stopListening();
    if (viewer === undefined || !this.isConnected) return;
    this.#listeningTo = viewer;
    this.#off = EVENTS.map((event) =>
      viewer.on(event, () => {
        this.#sync();
      }),
    );
  }

  #stopListening(): void {
    for (const stop of this.#off) stop();
    this.#off = [];
    this.#listeningTo = undefined;
  }

  /** Takes the SEGs of the study, and the ones that are loaded, from the viewer. */
  #sync(): void {
    const { viewer } = this;
    const study = viewer?.getStudy();
    const nextSeries = study?.series.filter((item) => item.modality === 'SEG') ?? [];
    const sameSeries =
      nextSeries.length === this.series.length &&
      nextSeries.every((item, at) => item === this.series[at]);
    if (!sameSeries) this.series = nextSeries;
    const nextLoaded = viewer?.segmentations.list() ?? [];
    const sameLoaded =
      nextLoaded.length === this.loaded.length &&
      nextLoaded.every((item, at) => item === this.loaded[at]);
    if (!sameLoaded) this.loaded = nextLoaded;
  }

  #fail(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent<{ error: Error; context: 'segmentation' }>('dv-error', {
        detail: { error: toError(error), context: 'segmentation' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #setLoading(uid: string, on: boolean): void {
    const next = new Set(this.loading);
    if (on) next.add(uid);
    else next.delete(uid);
    this.loading = next;
  }

  #load(uid: string): void {
    const { viewer } = this;
    if (viewer === undefined || this.loading.has(uid)) return;
    this.#setLoading(uid, true);
    viewer.segmentations.load(uid).then(
      () => {
        this.#setLoading(uid, false);
      },
      (error: unknown) => {
        this.#setLoading(uid, false);
        this.#fail(error);
      },
    );
  }

  #call(action: () => Promise<unknown> | undefined): void {
    action()?.catch((error: unknown) => {
      this.#fail(error);
    });
  }

  /** A slider or a colour picker: it shows the value being dragged, and the newest one is sent when the last call is done. */
  #slide(
    key: string,
    value: number | string,
    send: (value: number | string) => Promise<void>,
  ): void {
    this.#dragging.set(key, value);
    let push = this.#pushers.get(key);
    if (push === undefined) {
      // Bound to the viewer the gesture began on: a value still waiting when another viewer is set
      // is dropped, not sent to a viewer that has no such SEG.
      const bound = this.viewer;
      const mine = latestWins(
        (sent: number | string) => (this.viewer === bound ? send(sent) : Promise.resolve()),
        (error) => {
          this.#fail(error);
        },
        () => {
          // Idle: nothing is waiting, so the next gesture can start a new one without racing this.
          if (this.#pushers.get(key) === mine) this.#pushers.delete(key);
        },
      );
      push = mine;
      this.#pushers.set(key, push);
    }
    push(value);
    this.requestUpdate();
  }

  #endSlide(key: string): void {
    // The coalescer stays: a gesture started while the last one's writes are still going joins its
    // queue and replaces the waiting value, so an old value is never sent after a newer one.
    this.#dragging.delete(key);
    this.requestUpdate();
  }

  /** The opacity a slider shows, as a percentage: the value being dragged, or the one the viewer has. */
  #percent(key: string, own: number): number {
    const dragged = this.#dragging.get(key);
    return typeof dragged === 'number' ? Math.round(dragged) : Math.round(own * 100);
  }

  /** The colour a picker shows, as hex: the one being dragged, or the one the viewer has. */
  #hex(key: string, own: SegmentInfo['color']): string {
    const dragged = this.#dragging.get(key);
    return typeof dragged === 'string' ? dragged : colorToHex(own);
  }

  #renderSegment(info: SegmentationInfo, segment: SegmentInfo): TemplateResult {
    const { viewer } = this;
    const uid = info.seriesInstanceUID;
    const key = `${uid}/${segment.number.toString()}`;
    const highlighted = info.highlight?.segments.includes(segment.number) === true;
    const empty = segment.voxelCount === 0;
    const percent = this.#percent(`${key}/opacity`, segment.opacity);
    return html`<li class="segment" part="segment" data-segment=${segment.number.toString()}>
      <input
        type="checkbox"
        part="segment-visible"
        aria-label=${`Show ${segment.label}`}
        .checked=${segment.visible}
        @change=${(event: Event): void => {
          const { checked } = event.target as HTMLInputElement;
          this.#call(() => viewer?.segmentations.setSegmentVisible(uid, segment.number, checked));
        }}
      />
      <input
        type="color"
        part="segment-color"
        aria-label=${`${segment.label} colour`}
        .value=${this.#hex(`${key}/color`, segment.color)}
        @input=${(event: Event): void => {
          const { value } = event.target as HTMLInputElement;
          this.#slide(
            `${key}/color`,
            value,
            (picked) =>
              this.viewer?.segmentations.setSegmentColor(
                uid,
                segment.number,
                parseColor(String(picked)),
              ) ?? Promise.resolve(),
          );
        }}
        @change=${(): void => {
          this.#endSlide(`${key}/color`);
        }}
      />
      <span class="segment-name" part="segment-name">
        ${segment.label}
        ${empty ? html`<small>No pixels</small>` : nothing}
      </span>
      <button
        type="button"
        part="button"
        class="icon-button"
        data-action="highlight"
        aria-label=${`Highlight ${segment.label}`}
        title="Highlight"
        aria-pressed=${highlighted ? 'true' : 'false'}
        @click=${(): void => {
          this.#call(() =>
            viewer?.segmentations.highlight(uid, highlighted ? [] : [segment.number]),
          );
        }}
      >
        ${icon('highlight')}
      </button>
      <button
        type="button"
        part="button"
        class="icon-button"
        data-action="jump"
        aria-label=${`Go to ${segment.label}`}
        title="Go to"
        aria-disabled=${empty ? 'true' : nothing}
        @click=${(): void => {
          if (empty) return;
          this.#call(() =>
            viewer?.segmentations.jumpToSegment(uid, segment.number, {
              viewportId: this.viewportId ?? viewer.viewports.active,
            }),
          );
        }}
      >
        ${icon('target')}
      </button>
      <label class="segment-opacity">
        <span>Opacity</span>
        <input
          type="range"
          part="segment-opacity"
          min="0"
          max="100"
          step="5"
          aria-label=${`${segment.label} opacity`}
          .value=${percent.toString()}
          @input=${(event: Event): void => {
            const value = Number((event.target as HTMLInputElement).value);
            this.#slide(
              `${key}/opacity`,
              value,
              (sent) =>
                this.viewer?.segmentations.setSegmentOpacity(
                  uid,
                  segment.number,
                  Number(sent) / 100,
                ) ?? Promise.resolve(),
            );
          }}
          @change=${(): void => {
            this.#endSlide(`${key}/opacity`);
          }}
        />
        <span class="percent" aria-hidden="true">${percent.toString()}%</span>
      </label>
    </li>`;
  }

  #renderLoaded(series: SeriesSummary, info: SegmentationInfo): TemplateResult {
    const { viewer } = this;
    const uid = info.seriesInstanceUID;
    const key = `${uid}/opacity`;
    const percent = this.#percent(key, info.opacity);
    return html`<li class="seg" part="segmentation" data-segmentation=${uid}>
      <div class="seg-head">
        <input
          type="checkbox"
          part="segmentation-visible"
          aria-label=${`Show ${segmentationName(series)}`}
          .checked=${info.visible}
          @change=${(event: Event): void => {
            const { checked } = event.target as HTMLInputElement;
            this.#call(() => viewer?.segmentations.setVisible(uid, checked));
          }}
        />
        <span class="seg-title" part="segmentation-title">${segmentationName(series)}</span>
        <button
          type="button"
          part="button"
          class="text-button"
          data-action="unload"
          aria-label=${`Unload ${segmentationName(series)}`}
          @click=${(): void => {
            this.#call(() => viewer?.segmentations.unload(uid));
          }}
        >
          Unload
        </button>
      </div>
      <label class="seg-opacity">
        <span>Opacity</span>
        <input
          type="range"
          part="segmentation-opacity"
          min="0"
          max="100"
          step="5"
          aria-label=${`${segmentationName(series)} opacity`}
          .value=${percent.toString()}
          @input=${(event: Event): void => {
            const value = Number((event.target as HTMLInputElement).value);
            this.#slide(
              key,
              value,
              (sent) =>
                this.viewer?.segmentations.setOpacity(uid, Number(sent) / 100) ?? Promise.resolve(),
            );
          }}
          @change=${(): void => {
            this.#endSlide(key);
          }}
        />
        <span class="percent" aria-hidden="true">${percent.toString()}%</span>
      </label>
      ${
        info.warnings.length === 0
          ? nothing
          : html`<ul class="warnings" part="warnings" aria-label="Warnings">
            ${info.warnings.map(
              (warning) =>
                html`<li>${icon('warning')}<span><span class="dv-visually-hidden">Warning: </span>${warning.message}</span></li>`,
            )}
          </ul>`
      }
      <ul class="segments" part="segments" aria-label=${`${segmentationName(series)} segments`}>
        ${info.segments.map((segment) => this.#renderSegment(info, segment))}
      </ul>
    </li>`;
  }

  #renderUnloaded(series: SeriesSummary): TemplateResult {
    const uid = series.seriesInstanceUID;
    const busy = this.loading.has(uid);
    return html`<li class="seg" part="segmentation" data-segmentation=${uid} aria-busy=${busy ? 'true' : nothing}>
      <div class="seg-head">
        <span class="seg-title" part="segmentation-title">${segmentationName(series)}</span>
        <button
          type="button"
          part="button"
          class="text-button primary"
          data-action="load"
          aria-label=${`Load ${segmentationName(series)}`}
          aria-disabled=${busy ? 'true' : nothing}
          @click=${(): void => {
            this.#load(uid);
          }}
        >
          ${busy ? 'Loading…' : 'Load'}
        </button>
      </div>
    </li>`;
  }

  override render(): TemplateResult {
    if (this.series.length === 0) {
      return html`<p class="empty" role="status">
        ${icon('segments')}<span>This study has no segmentations.</span>
      </p>`;
    }
    return html`<ul class="seg-list" aria-label=${this.label}>
      ${this.series.map((series) => {
        const info = this.loaded.find(
          (item) => item.seriesInstanceUID === series.seriesInstanceUID,
        );
        return info === undefined ? this.#renderUnloaded(series) : this.#renderLoaded(series, info);
      })}
    </ul>`;
  }
}
