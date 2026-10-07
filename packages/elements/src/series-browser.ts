import type { SeriesSummary, Viewer } from '@scope/viewer-core';
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
import { nextFocusIndex } from './toolbar-config';
import { baseStyles, themeStyles } from './theme';

/** Modalities that hold no picture to show, so they cannot be put in a viewport. */
const NOT_IMAGES: ReadonlySet<string> = new Set(['SEG', 'SR', 'KO', 'PR', 'DOC', 'REG', 'RWV']);

export function isDisplayableModality(modality: string): boolean {
  return !NOT_IMAGES.has(modality);
}

/** What a row says about its series. Pure, so the wording is tested without a DOM. */
export function describeSeries(series: SeriesSummary): {
  readonly title: string;
  readonly detail: string;
} {
  const number = series.seriesNumber === undefined ? '' : `${series.seriesNumber.toString()}. `;
  const count =
    series.instanceCount === undefined
      ? ''
      : ` · ${series.instanceCount.toString()} ${series.instanceCount === 1 ? 'image' : 'images'}`;
  return {
    title: `${number}${series.description ?? series.modality}`,
    detail: `${series.modality}${count}`,
  };
}

type Thumbnail =
  | { readonly state: 'loading' }
  | { readonly state: 'none' }
  | { readonly state: 'ready'; readonly url: string };

const THUMBNAIL_SIZE = 96;

/**
 * The series of the study, as a listbox of rows with a thumbnail. Choosing one shows it in the
 * viewport. Thumbnails are asked for as rows scroll into view (the core draws two at a time).
 */
export class DvSeriesBrowserElement extends LitElement {
  static override properties: PropertyDeclarations = {
    viewer: { attribute: false },
    viewportId: { attribute: 'viewport-id' },
    label: {},
    series: { state: true },
    shownUid: { state: true },
    thumbnails: { state: true },
  };

  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    css`
      :host {
        display: block;
        overflow-y: auto;
        background: var(--dv-color-surface, #171b21);
      }
      [role='listbox'] {
        list-style: none;
        margin: 0;
        padding: calc(var(--dv-space, 0.25rem) * 2);
        display: flex;
        flex-direction: column;
        gap: calc(var(--dv-space, 0.25rem) * 2);
      }
      [role='option'] {
        display: flex;
        gap: calc(var(--dv-space, 0.25rem) * 3);
        align-items: center;
        padding: calc(var(--dv-space, 0.25rem) * 2);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius-lg, 8px);
        background: var(--dv-color-surface-raised, #212731);
        cursor: pointer;
        transition: background-color 0.12s;
      }
      [role='option']:hover:not([aria-disabled='true']) {
        background: color-mix(in srgb, var(--dv-color-accent, #5aa9ff) 10%, var(--dv-color-surface-raised, #212731));
      }
      [role='option'][aria-selected='true'] {
        border-color: var(--dv-color-accent, #5aa9ff);
        box-shadow: inset 3px 0 0 var(--dv-color-accent, #5aa9ff);
      }
      [role='option'][aria-disabled='true'] {
        cursor: not-allowed;
        color: var(--dv-color-text-muted, #a7b0be);
      }
      .thumb {
        flex: none;
        width: 3.5rem;
        height: 3.5rem;
        display: grid;
        place-items: center;
        background: #000;
        border-radius: calc(var(--dv-radius, 6px) / 2);
        overflow: hidden;
        color: #fff;
        font-size: 0.7rem;
      }
      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .title {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .detail {
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8125rem;
      }
      .empty {
        padding: calc(var(--dv-space, 0.25rem) * 3);
        color: var(--dv-color-text-muted, #a7b0be);
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  /** The viewport the browser shows and fills. Default: the active one, which follows the person. */
  declare viewportId: string | undefined;
  declare label: string;
  declare series: readonly SeriesSummary[];
  declare shownUid: string | undefined;
  declare thumbnails: ReadonlyMap<string, Thumbnail>;

  #off: (() => void)[] = [];
  #listeningTo: Viewer | undefined;
  #observer: IntersectionObserver | undefined;
  #studyUid: string | undefined;
  #requested = new Set<string>();
  #rovingIndex = 0;

  constructor() {
    super();
    this.viewportId = undefined;
    this.label = 'Series';
    this.series = [];
    this.shownUid = undefined;
    this.thumbnails = new Map();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#listen();
    this.#sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopListening();
    this.#observer?.disconnect();
    this.#observer = undefined;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('viewer') || changed.has('viewportId')) {
      this.#listen();
      this.#sync();
    }
  }

  override updated(): void {
    // Rows are new after a study change: watch them for scrolling into view.
    const rows = this.renderRoot.querySelectorAll<HTMLElement>('[data-series]');
    if (this.#observer === undefined && typeof IntersectionObserver === 'function') {
      this.#observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const uid =
            entry.target instanceof HTMLElement ? entry.target.dataset['series'] : undefined;
          if (entry.isIntersecting && uid !== undefined) this.#requestThumbnail(uid);
        }
      });
    }
    if (this.#observer === undefined) {
      for (const row of rows) {
        const uid = row.dataset['series'];
        if (uid !== undefined) this.#requestThumbnail(uid);
      }
      return;
    }
    this.#observer.disconnect();
    for (const row of rows) this.#observer.observe(row);
  }

  #listen(): void {
    const { viewer } = this;
    if (viewer === this.#listeningTo && this.#off.length > 0) return;
    this.#stopListening();
    if (viewer === undefined || !this.isConnected) return;
    this.#listeningTo = viewer;
    this.#off = [
      viewer.on('study:loaded', () => {
        this.#sync();
      }),
      viewer.on('state:changed', () => {
        this.#sync();
      }),
      viewer.on('viewport:active', () => {
        this.#sync();
      }),
    ];
  }

  #stopListening(): void {
    for (const stop of this.#off) stop();
    this.#off = [];
    this.#listeningTo = undefined;
  }

  /** Takes the series list and the series on screen from the viewer. */
  #sync(): void {
    const { viewer } = this;
    const study = viewer?.getStudy();
    if (study?.studyInstanceUID !== this.#studyUid) {
      this.#studyUid = study?.studyInstanceUID;
      this.#requested = new Set();
      this.thumbnails = new Map();
      this.#rovingIndex = 0;
    }
    this.series = study?.series ?? [];
    const target = this.viewportId ?? viewer?.viewports.active;
    this.shownUid = viewer
      ?.getState()
      .viewports.find((viewport) => viewport.id === target)?.seriesInstanceUID;
  }

  #setThumbnail(uid: string, thumbnail: Thumbnail): void {
    this.thumbnails = new Map(this.thumbnails).set(uid, thumbnail);
  }

  #requestThumbnail(uid: string): void {
    const { viewer } = this;
    const summary = this.series.find((item) => item.seriesInstanceUID === uid);
    if (viewer === undefined || summary === undefined || this.#requested.has(uid)) return;
    this.#requested.add(uid);
    if (!isDisplayableModality(summary.modality)) {
      this.#setThumbnail(uid, { state: 'none' });
      return;
    }
    const study = this.#studyUid;
    this.#setThumbnail(uid, { state: 'loading' });
    viewer.thumbnails.get(uid, { size: THUMBNAIL_SIZE }).then(
      (url) => {
        if (study !== this.#studyUid) return;
        this.#setThumbnail(uid, url === undefined ? { state: 'none' } : { state: 'ready', url });
      },
      () => {
        if (study !== this.#studyUid) return;
        // A thumbnail is a convenience: the row still works without one.
        this.#setThumbnail(uid, { state: 'none' });
      },
    );
  }

  #choose(summary: SeriesSummary): void {
    const { viewer } = this;
    if (viewer === undefined || !isDisplayableModality(summary.modality)) return;
    viewer
      .setViewportSeries(this.viewportId ?? viewer.viewports.active, summary.seriesInstanceUID)
      .catch((error: unknown) => {
        this.dispatchEvent(
          new CustomEvent<{ error: Error; context: 'series' }>('dv-error', {
            detail: {
              error: error instanceof Error ? error : new Error(String(error)),
              context: 'series',
            },
            bubbles: true,
            composed: true,
          }),
        );
      });
  }

  #onKeydown(event: KeyboardEvent, summary: SeriesSummary): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.#choose(summary);
      return;
    }
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('[role="option"]')];
    const current = rows.indexOf(event.currentTarget as HTMLElement);
    const next = nextFocusIndex(event.key, current, rows.length);
    if (next === undefined) return;
    event.preventDefault();
    rows[next]?.focus();
  }

  #renderRow(summary: SeriesSummary, position: number): TemplateResult {
    const { title, detail } = describeSeries(summary);
    const selected = summary.seriesInstanceUID === this.shownUid;
    const displayable = isDisplayableModality(summary.modality);
    const thumbnail = this.thumbnails.get(summary.seriesInstanceUID);
    return html`<li
      role="option"
      part="series-item"
      data-series=${summary.seriesInstanceUID}
      tabindex=${position === this.#rovingIndex ? 0 : -1}
      aria-selected=${selected ? 'true' : 'false'}
      aria-disabled=${displayable ? nothing : 'true'}
      aria-label=${`${title}, ${detail}`}
      @click=${(): void => {
        this.#choose(summary);
      }}
      @keydown=${(event: KeyboardEvent): void => {
        this.#onKeydown(event, summary);
      }}
      @focus=${(): void => {
        this.#rovingIndex = position;
        this.requestUpdate();
      }}
    >
      <span class="thumb" part="thumbnail" aria-hidden="true">
        ${
          thumbnail?.state === 'ready'
            ? html`<img src=${thumbnail.url} alt="" width="56" height="56" />`
            : html`<span>${summary.modality}</span>`
        }
      </span>
      <span>
        <span class="title" part="series-title">${title}</span><br />
        <span class="detail">${detail}</span>
      </span>
    </li>`;
  }

  override render(): TemplateResult {
    if (this.series.length === 0) {
      return html`<p class="empty" role="status">No series.</p>`;
    }
    return html`<ul role="listbox" aria-label=${this.label}>
      ${this.series.map((summary, position) => this.#renderRow(summary, position))}
    </ul>`;
  }
}
