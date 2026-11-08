import {
  formatViewerMessage,
  MAX_LABEL_LENGTH,
  type Measurement,
  measurementLines,
  measurementName,
  measurementNames,
  type SeriesSummary,
  type SrLoadResult,
  type Viewer,
  resolveViewerMessages,
  type ViewerMessages,
} from '@01x/dicom-viewer-core';
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
import { baseStyles, themeStyles } from './theme';
import { nextFocusIndex } from './toolbar-config';

/** The most measurements shown together: the viewports of the largest layout that has a grid. */
const MAX_TOGETHER = 4;

const EVENTS = [
  'measurement:added',
  'measurement:updated',
  'measurement:removed',
  'measurement:selected',
  'study:loaded',
  'state:changed',
] as const;

export { measurementName };

/** What the panel says about the last report it was asked to load. */
type ReportStatus =
  | { readonly kind: 'loaded'; readonly result: SrLoadResult }
  | { readonly kind: 'failed'; readonly message: string };

function sameList(a: readonly Measurement[], b: readonly Measurement[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The measurements of the study on screen, as a listbox. Choosing one shows the image it is on and
 * picks it. `Rename` and `Delete` (and F2 and the Delete key) act on the measurement that has the
 * focus. Chrome only, so it uses shadow DOM.
 */
export class DvMeasurementListElement extends LitElement {
  static override properties: PropertyDeclarations = {
    viewer: { attribute: false },
    messages: { attribute: false },
    viewportId: { attribute: 'viewport-id' },
    label: {},
    items: { state: true },
    selectedId: { state: true },
    renamingId: { state: true },
    reports: { state: true },
    reportStatus: { state: true },
    loadedReport: { state: true },
    loadingReport: { state: true },
    slices: { state: true },
    chosen: { state: true },
    selectionStatus: { state: true },
  };

  /** @internal The component's own CSS. */
  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--dv-color-surface, #171b21);
      }
      [role='listbox'] {
        flex: 1;
        overflow-y: auto;
        list-style: none;
        margin: 0;
        padding: calc(var(--dv-space, 0.25rem) * 2);
        display: flex;
        flex-direction: column;
        gap: calc(var(--dv-space, 0.25rem) * 2);
      }
      [role='option'] {
        padding: calc(var(--dv-space, 0.25rem) * 2) calc(var(--dv-space, 0.25rem) * 3);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius-lg, 8px);
        background: var(--dv-color-surface-raised, #212731);
        cursor: pointer;
        transition: background-color 0.12s;
      }
      [role='option']:hover {
        background: color-mix(in srgb, var(--dv-color-accent, #5aa9ff) 10%, var(--dv-color-surface-raised, #212731));
      }
      [role='option'][aria-selected='true'] {
        border-color: var(--dv-color-accent, #5aa9ff);
        box-shadow: inset 3px 0 0 var(--dv-color-accent, #5aa9ff);
      }
      .title {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .head {
        display: flex;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: baseline;
      }
      .head .title {
        flex: 1;
      }
      .check {
        flex: none;
        align-self: center;
        box-sizing: border-box;
        width: 1.125rem;
        height: 1.125rem;
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius, 4px);
        display: grid;
        place-items: center;
        font-size: 0.75rem;
        line-height: 1;
        color: var(--dv-color-surface, #171b21);
      }
      [aria-checked='true'] .check {
        background: var(--dv-color-accent, #5aa9ff);
        border-color: var(--dv-color-accent, #5aa9ff);
      }
      [aria-checked='true'] .check::after {
        content: '✓';
        font-weight: 700;
      }
      .selection {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: center;
        padding: calc(var(--dv-space, 0.25rem) * 2);
        border-top: 1px solid var(--dv-color-border, #667284);
      }
      .selection label {
        display: flex;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: center;
        flex: 1;
      }
      .selection input[type='checkbox'] {
        flex: none;
        margin: 0;
        accent-color: var(--dv-color-accent, #5aa9ff);
      }
      .selection-status {
        flex-basis: 100%;
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8125rem;
      }
      .slice {
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8125rem;
        font-variant-numeric: tabular-nums;
      }
      .lines {
        margin: 0;
        padding: 0;
        list-style: none;
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8125rem;
        font-variant-numeric: tabular-nums;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: center;
        padding: calc(var(--dv-space, 0.25rem) * 2);
        border-top: 1px solid var(--dv-color-border, #667284);
      }
      .actions label {
        display: flex;
        flex: 1;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: center;
      }
      .report {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        align-items: center;
        padding: calc(var(--dv-space, 0.25rem) * 2);
        border-top: 1px solid var(--dv-color-border, #667284);
      }
      .report-status {
        flex-basis: 100%;
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8125rem;
        overflow-wrap: anywhere;
      }
      .report-status p,
      .report-status ul {
        margin: 0;
      }
      .report-status ul {
        padding-left: calc(var(--dv-space, 0.25rem) * 4);
      }
      input,
      select {
        flex: 1;
        min-width: 0;
        font: inherit;
        color: var(--dv-color-text, #e8ebf0);
        background: var(--dv-color-surface-raised, #212731);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius, 6px);
        padding: calc(var(--dv-space, 0.25rem) * 1.5) calc(var(--dv-space, 0.25rem) * 2);
      }
      button {
        font: inherit;
        color: var(--dv-color-text, #e8ebf0);
        background: transparent;
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius, 6px);
        padding: calc(var(--dv-space, 0.25rem) * 1.5) calc(var(--dv-space, 0.25rem) * 3);
        min-height: 2rem;
        cursor: pointer;
        transition: background-color 0.12s;
      }
      button:hover {
        background: var(--dv-color-surface-raised, #212731);
      }
      button[aria-disabled='true'] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .empty {
        padding: calc(var(--dv-space, 0.25rem) * 4) calc(var(--dv-space, 0.25rem) * 4);
        color: var(--dv-color-text-muted, #a7b0be);
        line-height: 1.5;
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  declare messages: Partial<ViewerMessages> | undefined;
  declare viewportId: string | undefined;
  declare label: string;
  declare items: readonly Measurement[];
  declare selectedId: string | undefined;
  /** The measurement whose name is being typed. */
  declare renamingId: string | undefined;
  /** The Structured Reports of the study, which can be loaded. */
  declare reports: readonly SeriesSummary[];
  /** What the last attempt to load a report did, in words. */
  declare reportStatus: ReportStatus | undefined;
  declare loadingReport: boolean;
  /** The report the list shows as chosen: the one loaded last, so the control says which one it is. */
  declare loadedReport: string | undefined;
  /** The slice each measurement is on, by id, as the overlay counts it. Worked out by the viewer. */
  declare slices: ReadonlyMap<string, number>;
  /** The measurements ticked in the list, to show together or delete. Not the one that is picked. */
  declare chosen: ReadonlySet<string>;
  /** What the panel says about the last "Show together", when it could not show everything. */
  declare selectionStatus: string | undefined;

  #off: (() => void)[] = [];
  #listeningTo: Viewer | undefined;
  /** The row that has the tab stop, and that Rename and Delete act on. */
  #rovingIndex = 0;
  #focusRowAfterUpdate = false;
  /** The study the message about a report is about. */
  #statusStudy: string | undefined;
  /** Counts the attempts to load a report, so the answer to an old one (another viewer, another study) is ignored. */
  #reportRequest = 0;
  /** The measurements and images the slices were asked for, so a drag that moves a point asks again for nothing. */
  #slicesKey = '';
  #slicesRefs: ReadonlyMap<string, string> = new Map();
  #slicesRequest = 0;

  constructor() {
    super();
    this.viewportId = undefined;
    this.label = 'Measurements';
    this.items = [];
    this.selectedId = undefined;
    this.renamingId = undefined;
    this.reports = [];
    this.reportStatus = undefined;
    this.loadingReport = false;
    this.loadedReport = undefined;
    this.slices = new Map();
    this.chosen = new Set();
    this.selectionStatus = undefined;
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
      // Another viewer: its numbers are not these.
      this.#slicesKey = '';
      this.#slicesRefs = new Map();
      if (this.slices.size > 0) this.slices = new Map();
      // The ticks and the note about a show were about the other viewer's measurements.
      this.#choose(new Set());
      this.#forgetReport();
      this.#listen();
      this.#sync();
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has('renamingId') && this.renamingId !== undefined) {
      const input = this.renderRoot.querySelector<HTMLInputElement>('input[type="text"]');
      input?.focus();
      input?.select();
    }
    if (this.#focusRowAfterUpdate) {
      this.#focusRowAfterUpdate = false;
      this.#rows()[this.#rovingIndex]?.focus();
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

  /** Takes the measurements of the study on screen, and which one is picked, from the viewer. */
  #sync(): void {
    const { viewer } = this;
    const study = viewer?.getState().studyInstanceUID;
    const next =
      viewer === undefined || study === undefined
        ? []
        : viewer.measurements.list({ studyInstanceUID: study });
    if (!sameList(next, this.items)) this.items = next;
    this.#refreshSlices(next);
    if ([...this.chosen].some((id) => !next.some((item) => item.id === id))) {
      this.#choose(new Set([...this.chosen].filter((id) => next.some((item) => item.id === id))));
    }
    const reports = viewer?.getStudy()?.series.filter((series) => series.modality === 'SR') ?? [];
    if (
      reports.length !== this.reports.length ||
      reports.some((report, at) => report.seriesInstanceUID !== this.reports[at]?.seriesInstanceUID)
    ) {
      this.reports = reports;
    }
    if (study !== this.#statusStudy) {
      this.#statusStudy = study;
      this.#forgetReport();
    }
    const picked = viewer?.measurements.getSelected();
    const selected = next.some((item) => item.id === picked) ? picked : undefined;
    if (selected !== this.selectedId) {
      this.selectedId = selected;
      // Picking one on the image puts the tab stop on its row.
      const at = next.findIndex((item) => item.id === selected);
      if (at >= 0) this.#rovingIndex = at;
    }
    this.#rovingIndex = Math.min(this.#rovingIndex, Math.max(0, next.length - 1));
    if (this.renamingId !== undefined && !next.some((item) => item.id === this.renamingId)) {
      this.renamingId = undefined;
    }
  }

  /** Changes which measurements are ticked. What was said about the last "Show together" no longer applies. */
  #choose(chosen: ReadonlySet<string>): void {
    this.chosen = chosen;
    this.selectionStatus = undefined;
  }

  #toggleChosen(id: string): void {
    const next = new Set(this.chosen);
    if (!next.delete(id)) next.add(id);
    this.#choose(next);
  }

  #chooseAll(all: boolean): void {
    this.#choose(all ? new Set(this.items.map((item) => item.id)) : new Set());
  }

  /** The measurements that are ticked, in the order of the list. */
  #chosenItems(): Measurement[] {
    return this.items.filter((item) => this.chosen.has(item.id));
  }

  /**
   * Shows the ticked measurements side by side, one in each viewport, each on its own slice: two
   * go in a row of two, three or four in a grid of four, and more than four are cut to the first
   * four (and it says so). One is shown where it is. Every step goes through the viewer's queue, in
   * order, and the first one is shown last, so it is the one that is picked.
   */
  #showTogether(): void {
    const { viewer } = this;
    const items = this.#chosenItems();
    if (viewer === undefined || items.length === 0) return;
    if (items.length === 1) {
      const [only] = items;
      if (only !== undefined) this.#jump(only);
      return;
    }
    const shown = items.slice(0, MAX_TOGETHER);
    const steps: Promise<unknown>[] = [viewer.setLayout(shown.length === 2 ? '1x2' : '2x2')];
    for (let at = shown.length - 1; at >= 0; at -= 1) {
      const measurement = shown[at];
      if (measurement !== undefined) {
        steps.push(
          viewer.measurements.jumpTo(measurement.id, { viewportId: `vp-${at.toString()}` }),
        );
      }
    }
    // What was said about an earlier attempt is not about this one.
    this.selectionStatus = undefined;
    const chosen = this.chosen;
    // It says the first four are shown only once they are, and not if the choice has changed since.
    Promise.all(steps).then(
      () => {
        if (items.length > shown.length && this.chosen === chosen) {
          this.selectionStatus = formatViewerMessage(
            resolveViewerMessages(this.messages).showingFirstSelected,
            { shown: shown.length, total: items.length },
          );
        }
      },
      (error: unknown) => {
        this.selectionStatus = undefined;
        this.#fail(error);
      },
    );
    this.#rovingIndex = Math.max(
      0,
      this.items.findIndex((item) => item.id === shown[0]?.id),
    );
  }

  #deleteChosen(): void {
    const { viewer } = this;
    const items = this.#chosenItems();
    if (viewer === undefined || items.length === 0) return;
    Promise.all(items.map((item) => viewer.measurements.remove(item.id))).then(
      () => {
        this.#choose(new Set());
        this.#focusRowAfterUpdate = false;
      },
      (error: unknown) => {
        this.#fail(error);
      },
    );
  }

  /** Asks the viewer which slice each measurement is on, when the measurements or their images changed. */
  #refreshSlices(items: readonly Measurement[]): void {
    const { viewer } = this;
    // What the slice of a measurement depends on: the image it is on, in its series and study.
    const refs = new Map(
      items.map((item) => [
        item.id,
        `${item.reference.studyInstanceUID}/${item.reference.seriesInstanceUID}/${item.reference.sopInstanceUID}`,
      ]),
    );
    const key = [...refs].map(([id, ref]) => `${id}@${ref}`).join('|');
    if (key === this.#slicesKey) return;
    const before = this.#slicesRefs;
    this.#slicesKey = key;
    this.#slicesRefs = refs;
    this.#slicesRequest += 1;
    const request = this.#slicesRequest;
    // A measurement on another image does not keep the number of the old one while the new one is read.
    const kept = new Map(
      [...this.slices].filter(([id]) => refs.has(id) && before.get(id) === refs.get(id)),
    );
    if (kept.size !== this.slices.size) this.slices = kept;
    if (viewer === undefined || items.length === 0) return;
    viewer.measurements.slices().then(
      (slices) => {
        // An answer to an older question, or from a viewer that was replaced, is not about this list.
        if (request === this.#slicesRequest) this.slices = slices;
      },
      () => {
        // Rows without a slice are still usable: the number is a help, not the content.
        if (request === this.#slicesRequest) this.slices = new Map();
      },
    );
  }

  #rows(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  #current(): Measurement | undefined {
    return this.items[this.#rovingIndex];
  }

  #fail(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent<{ error: Error; context: 'measurement' }>('dv-error', {
        detail: { error: toError(error), context: 'measurement' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #jump(measurement: Measurement): void {
    const { viewer } = this;
    viewer?.measurements
      .jumpTo(measurement.id, { viewportId: this.viewportId ?? viewer.viewports.active })
      .catch((error: unknown) => {
        this.#fail(error);
      });
  }

  /** Shows the measurement after the one picked (or the one with the focus), going round at the ends. */
  #step(direction: 1 | -1): void {
    const count = this.items.length;
    if (count === 0) return;
    const picked = this.items.findIndex((item) => item.id === this.selectedId);
    let at: number;
    if (picked >= 0) at = (picked + direction + count) % count;
    else at = direction === 1 ? 0 : count - 1;
    const target = this.items[at];
    if (target === undefined) return;
    this.#rovingIndex = at;
    this.#jump(target);
  }

  #delete(measurement: Measurement | undefined): void {
    if (measurement === undefined || this.viewer === undefined) return;
    this.viewer.measurements.remove(measurement.id).then(
      () => {
        // The row that was next takes its place, so the keyboard stays where it was.
        this.#focusRowAfterUpdate = true;
        this.requestUpdate();
      },
      (error: unknown) => {
        this.#fail(error);
      },
    );
  }

  /** Drops the message about a report, and the answer to a request still on its way. */
  #forgetReport(): void {
    this.#reportRequest += 1;
    this.loadingReport = false;
    this.reportStatus = undefined;
    this.loadedReport = undefined;
  }

  #loadReport(seriesInstanceUID: string): void {
    const { viewer } = this;
    if (viewer === undefined || seriesInstanceUID === '' || this.loadingReport) return;
    this.#forgetReport();
    const request = this.#reportRequest;
    // Another viewer or another study since the request started: its answer is not about this list.
    const current = (): boolean => this.#reportRequest === request;
    this.loadingReport = true;
    // The control shows the report at once, and goes back to its prompt if the load fails.
    this.loadedReport = seriesInstanceUID;
    viewer.measurements
      .loadSr(seriesInstanceUID)
      .then(
        (result) => {
          if (current()) this.reportStatus = { kind: 'loaded', result };
        },
        (error: unknown) => {
          if (!current()) return;
          const failure = toError(error);
          this.reportStatus = { kind: 'failed', message: failure.message };
          this.loadedReport = undefined;
          this.#fail(failure);
        },
      )
      .finally(() => {
        if (current()) this.loadingReport = false;
      });
  }

  #downloadPdf(): void {
    const { viewer } = this;
    if (viewer === undefined || this.items.length === 0) return;
    viewer.commands.run('measurements.downloadPdf').catch((error: unknown) => {
      this.#fail(error);
    });
  }

  #startRename(measurement: Measurement | undefined): void {
    if (measurement === undefined) return;
    const at = this.items.findIndex((item) => item.id === measurement.id);
    if (at >= 0) this.#rovingIndex = at;
    this.renamingId = measurement.id;
  }

  #finishRename(save: boolean, name: string): void {
    const id = this.renamingId;
    this.renamingId = undefined;
    this.#focusRowAfterUpdate = true;
    if (!save || id === undefined || this.viewer === undefined) return;
    this.viewer.measurements.update(id, { label: name }).catch((error: unknown) => {
      this.#fail(error);
    });
  }

  #onKeydown(event: KeyboardEvent, measurement: Measurement): void {
    if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.#chooseAll(true);
      return;
    }
    if (event.key === 'x' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.#toggleChosen(measurement.id);
      return;
    }
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.#jump(measurement);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.#delete(measurement);
        return;
      case 'F2':
        event.preventDefault();
        this.#startRename(measurement);
        return;
      default:
        break;
    }
    const rows = this.#rows();
    const current = rows.indexOf(event.currentTarget as HTMLElement);
    const next = nextFocusIndex(event.key, current, rows.length);
    if (next === undefined) return;
    event.preventDefault();
    rows[next]?.focus();
  }

  #renderRow(
    measurement: Measurement,
    position: number,
    names: ReadonlyMap<string, string>,
  ): TemplateResult {
    const title =
      names.get(measurement.id) ?? measurementName(measurement, this.items, this.messages);
    const lines = measurementLines(measurement, this.messages);
    const slice = this.slices.get(measurement.id);
    const sliceText =
      slice === undefined
        ? undefined
        : formatViewerMessage(resolveViewerMessages(this.messages).measurementSlice, {
            slice,
          });
    return html`<li
      role="option"
      part="measurement-item"
      data-measurement=${measurement.id}
      tabindex=${position === this.#rovingIndex ? 0 : -1}
      aria-selected=${measurement.id === this.selectedId ? 'true' : 'false'}
      aria-checked=${this.chosen.has(measurement.id) ? 'true' : 'false'}
      aria-keyshortcuts="X"
      aria-label=${[title, ...lines, ...(sliceText === undefined ? [] : [sliceText])].join(', ')}
      @click=${(): void => {
        this.#rovingIndex = position;
        this.#jump(measurement);
      }}
      @dblclick=${(): void => {
        this.#startRename(measurement);
      }}
      @keydown=${(event: KeyboardEvent): void => {
        this.#onKeydown(event, measurement);
      }}
      @focus=${(): void => {
        if (this.#rovingIndex !== position) {
          this.#rovingIndex = position;
          this.requestUpdate();
        }
      }}
    >
      <div class="head">
        <span
          class="check"
          part="measurement-checkbox"
          data-check
          aria-hidden="true"
          @click=${(event: Event): void => {
            // Ticking a row is not choosing it: it does not show the image.
            event.stopPropagation();
            this.#toggleChosen(measurement.id);
          }}
          @dblclick=${(event: Event): void => {
            event.stopPropagation();
          }}
        ></span>
        <span class="title" part="measurement-title">${title}</span>
        ${
          sliceText === undefined
            ? nothing
            : html`<span class="slice" part="measurement-slice" data-slice aria-hidden="true">${sliceText}</span>`
        }
      </div>
      <ul class="lines" aria-hidden="true">
        ${lines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </li>`;
  }

  #renderActions(): TemplateResult {
    const text = resolveViewerMessages(this.messages);
    const renaming = this.items.find((item) => item.id === this.renamingId);
    if (renaming !== undefined) {
      return html`<form
        class="actions"
        @submit=${(event: SubmitEvent): void => {
          event.preventDefault();
          const input = this.renderRoot.querySelector<HTMLInputElement>('input[type="text"]');
          this.#finishRename(true, input?.value ?? '');
        }}
      >
        <label>
          ${text.name}
          <input
            type="text"
            part="rename-input"
            maxlength=${MAX_LABEL_LENGTH.toString()}
            .value=${renaming.label ?? measurementName(renaming, this.items, this.messages)}
            @keydown=${(event: KeyboardEvent): void => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.#finishRename(false, '');
              }
            }}
          />
        </label>
        <button type="submit" part="button">${text.save}</button>
        <button
          type="button"
          part="button"
          @click=${(): void => {
            this.#finishRename(false, '');
          }}
        >
          ${text.cancel}
        </button>
      </form>`;
    }
    const disabled = this.#current() === undefined;
    return html`<div class="actions" role="group" aria-label=${text.measurementActions}>
      <button
        type="button"
        part="button"
        data-action="previous-measurement"
        @click=${(): void => {
          this.#step(-1);
        }}
      >
        ${text.previousMeasurement}
      </button>
      <button
        type="button"
        part="button"
        data-action="next-measurement"
        @click=${(): void => {
          this.#step(1);
        }}
      >
        ${text.nextMeasurement}
      </button>
      <button
        type="button"
        part="button"
        data-action="rename"
        aria-disabled=${disabled ? 'true' : nothing}
        @click=${(): void => {
          // The row that has the focus when the button is pressed, not when the list was last drawn.
          this.#startRename(this.#current());
        }}
      >
        ${text.rename}
      </button>
      <button
        type="button"
        part="button"
        data-action="delete"
        aria-disabled=${disabled ? 'true' : nothing}
        @click=${(): void => {
          this.#delete(this.#current());
        }}
      >
        ${text.delete}
      </button>
    </div>`;
  }

  #renderSelection(): TemplateResult {
    const text = resolveViewerMessages(this.messages);
    const total = this.items.length;
    const count = this.chosen.size;
    const none = count === 0;
    return html`<div class="selection" role="group" aria-label=${text.measurementSelection}>
      <label>
        <input
          type="checkbox"
          part="checkbox"
          data-action="select-all"
          aria-label=${text.selectAll}
          .checked=${count === total}
          .indeterminate=${count > 0 && count < total}
          @change=${(event: Event): void => {
            this.#chooseAll((event.currentTarget as HTMLInputElement).checked);
          }}
        />
        ${text.selectAll}
      </label>
      <span data-selected-count role="status">
        ${formatViewerMessage(text.selectedCount, { count })}
      </span>
      <button
        type="button"
        part="button"
        data-action="show-together"
        aria-disabled=${none ? 'true' : nothing}
        @click=${(): void => {
          this.#showTogether();
        }}
      >
        ${text.showTogether}
      </button>
      <button
        type="button"
        part="button"
        data-action="delete-selected"
        aria-disabled=${none ? 'true' : nothing}
        @click=${(): void => {
          this.#deleteChosen();
        }}
      >
        ${text.deleteSelected}
      </button>
      ${
        this.selectionStatus === undefined
          ? nothing
          : html`<p class="selection-status" role="status" data-selection-status>
              ${this.selectionStatus}
            </p>`
      }
    </div>`;
  }

  #renderReportStatus(): TemplateResult | typeof nothing {
    const status = this.reportStatus;
    if (status === undefined) return nothing;
    if (status.kind === 'failed') {
      return html`<div class="report-status" role="status" data-report-status>
        <p>The report could not be loaded: ${status.message}</p>
      </div>`;
    }
    const { added, replaced, skipped } = status.result;
    return html`<div class="report-status" role="status" data-report-status>
      <p>
        ${
          added + replaced === 0
            ? 'No measurements were added.'
            : `Report loaded: ${added.toString()} added, ${replaced.toString()} replaced.`
        }
      </p>
      ${
        skipped.length === 0
          ? nothing
          : html`<p>Left out:</p>
            <ul>
              ${skipped.map((skip) => html`<li>${skip.reason} (${skip.count.toString()})</li>`)}
            </ul>`
      }
    </div>`;
  }

  #renderReport(): TemplateResult {
    const empty = this.items.length === 0;
    const text = resolveViewerMessages(this.messages);
    return html`<div class="report" role="group" aria-label="Report">
      ${
        this.reports.length === 0
          ? nothing
          : html`<select
            part="select"
            data-action="load-report"
            aria-label="Load report"
            ?disabled=${this.loadingReport}
            @change=${(event: Event): void => {
              const select = event.currentTarget as HTMLSelectElement;
              const chosen = select.value;
              // The prompt is not a report: the control goes back to the one that is loaded.
              if (chosen === '') select.value = this.loadedReport ?? '';
              this.#loadReport(chosen);
            }}
          >
            <option value="" ?selected=${this.loadedReport === undefined}>Load report…</option>
            ${this.reports.map(
              (report) =>
                html`<option
                  value=${report.seriesInstanceUID}
                  ?selected=${this.loadedReport === report.seriesInstanceUID}
                >
                  ${report.description ?? `SR ${report.seriesInstanceUID}`}
                </option>`,
            )}
          </select>`
      }
      ${
        this.loadedReport === undefined
          ? nothing
          : html`<button
              type="button"
              part="button"
              data-action="reload-report"
              aria-disabled=${this.loadingReport ? 'true' : nothing}
              @click=${(): void => {
                if (this.loadedReport !== undefined) this.#loadReport(this.loadedReport);
              }}
            >
              ${text.reloadReport}
            </button>`
      }
      <button
        type="button"
        part="button"
        data-action="download-pdf"
        aria-disabled=${empty ? 'true' : nothing}
        @click=${(): void => {
          this.#downloadPdf();
        }}
      >
        Download PDF
      </button>
      ${this.#renderReportStatus()}
    </div>`;
  }

  override render(): TemplateResult {
    const text = resolveViewerMessages(this.messages);
    if (this.items.length === 0) {
      return html`<p class="empty" role="status">
        ${text.noMeasurements}
      </p>
      ${this.#renderReport()}`;
    }
    const names = measurementNames(this.items, this.messages);
    return html`<ul role="listbox" aria-label=${this.label === 'Measurements' ? text.measurementsPanel : this.label}>
        ${this.items.map((measurement, position) => this.#renderRow(measurement, position, names))}
      </ul>
      ${this.#renderSelection()} ${this.#renderActions()} ${this.#renderReport()}`;
  }
}
