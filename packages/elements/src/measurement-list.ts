import {
  MAX_LABEL_LENGTH,
  MEASUREMENT_NAMES,
  type Measurement,
  measurementLines,
  type Viewer,
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
import { baseStyles, themeStyles } from './theme';
import { nextFocusIndex } from './toolbar-config';

const EVENTS = [
  'measurement:added',
  'measurement:updated',
  'measurement:removed',
  'measurement:selected',
  'study:loaded',
  'state:changed',
] as const;

/**
 * What a row calls a measurement: the name a person gave it, or its kind and its number among
 * those of that kind (`Length 2`), so two that nobody named can be told apart.
 */
export function measurementName(measurement: Measurement, all: readonly Measurement[]): string {
  if (measurement.label !== undefined) return measurement.label;
  const sameKind = all.filter((other) => other.type === measurement.type);
  const number = sameKind.findIndex((other) => other.id === measurement.id) + 1;
  return `${MEASUREMENT_NAMES[measurement.type]} ${number.toString()}`;
}

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
    viewportId: { attribute: 'viewport-id' },
    label: {},
    items: { state: true },
    selectedId: { state: true },
    renamingId: { state: true },
  };

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
        border-radius: var(--dv-radius, 6px);
        background: var(--dv-color-surface-raised, #212731);
        cursor: pointer;
      }
      [role='option'][aria-selected='true'] {
        border-color: var(--dv-color-accent, #5aa9ff);
        box-shadow: inset 0 0 0 1px var(--dv-color-accent, #5aa9ff);
      }
      .title {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .lines {
        margin: 0;
        padding: 0;
        list-style: none;
        color: var(--dv-color-text-muted, #a7b0be);
        font-size: 0.8em;
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
      input {
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
        background: var(--dv-color-surface-raised, #212731);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius, 6px);
        padding: calc(var(--dv-space, 0.25rem) * 1.5) calc(var(--dv-space, 0.25rem) * 3);
        min-height: 2rem;
        cursor: pointer;
      }
      button[aria-disabled='true'] {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .empty {
        padding: calc(var(--dv-space, 0.25rem) * 3);
        color: var(--dv-color-text-muted, #a7b0be);
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  declare viewportId: string;
  declare label: string;
  declare items: readonly Measurement[];
  declare selectedId: string | undefined;
  /** The measurement whose name is being typed. */
  declare renamingId: string | undefined;

  #off: (() => void)[] = [];
  #listeningTo: Viewer | undefined;
  /** The row that has the tab stop, and that Rename and Delete act on. */
  #rovingIndex = 0;
  #focusRowAfterUpdate = false;

  constructor() {
    super();
    this.viewportId = 'vp-0';
    this.label = 'Measurements';
    this.items = [];
    this.selectedId = undefined;
    this.renamingId = undefined;
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
      this.#listen();
      this.#sync();
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has('renamingId') && this.renamingId !== undefined) {
      const input = this.renderRoot.querySelector<HTMLInputElement>('input');
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
    this.viewer?.measurements
      .jumpTo(measurement.id, { viewportId: this.viewportId })
      .catch((error: unknown) => {
        this.#fail(error);
      });
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

  #renderRow(measurement: Measurement, position: number): TemplateResult {
    const title = measurementName(measurement, this.items);
    const lines = measurementLines(measurement);
    return html`<li
      role="option"
      part="measurement-item"
      data-measurement=${measurement.id}
      tabindex=${position === this.#rovingIndex ? 0 : -1}
      aria-selected=${measurement.id === this.selectedId ? 'true' : 'false'}
      aria-label=${[title, ...lines].join(', ')}
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
      <span class="title" part="measurement-title">${title}</span>
      <ul class="lines" aria-hidden="true">
        ${lines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </li>`;
  }

  #renderActions(): TemplateResult {
    const renaming = this.items.find((item) => item.id === this.renamingId);
    if (renaming !== undefined) {
      return html`<form
        class="actions"
        @submit=${(event: SubmitEvent): void => {
          event.preventDefault();
          const input = this.renderRoot.querySelector<HTMLInputElement>('input');
          this.#finishRename(true, input?.value ?? '');
        }}
      >
        <label>
          Name
          <input
            type="text"
            part="rename-input"
            maxlength=${MAX_LABEL_LENGTH.toString()}
            .value=${renaming.label ?? measurementName(renaming, this.items)}
            @keydown=${(event: KeyboardEvent): void => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.#finishRename(false, '');
              }
            }}
          />
        </label>
        <button type="submit" part="button">Save</button>
        <button
          type="button"
          part="button"
          @click=${(): void => {
            this.#finishRename(false, '');
          }}
        >
          Cancel
        </button>
      </form>`;
    }
    const disabled = this.#current() === undefined;
    return html`<div class="actions" role="group" aria-label="Measurement actions">
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
        Rename
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
        Delete
      </button>
    </div>`;
  }

  override render(): TemplateResult {
    if (this.items.length === 0) {
      return html`<p class="empty" role="status">
        No measurements yet. Choose a tool from the Measure menu and draw on the image.
      </p>`;
    }
    return html`<ul role="listbox" aria-label=${this.label}>
        ${this.items.map((measurement, position) => this.#renderRow(measurement, position))}
      </ul>
      ${this.#renderActions()}`;
  }
}
