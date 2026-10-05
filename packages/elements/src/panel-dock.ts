import type { PanelDefinition, PanelPlacement, Viewer } from '@scope/viewer-core';
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

interface Mounted {
  readonly definition: PanelDefinition;
  readonly container: HTMLElement;
  cleanup: (() => void) | undefined;
  mounted: boolean;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The side panels of one placement as tabs (`viewer.ui.registerPanel`). A panel is filled the
 * first time its tab is shown and keeps its content while another tab is, so a series list keeps
 * its scroll position. The dock hides itself when it has no panels.
 */
export class DvPanelDockElement extends LitElement {
  static override properties: PropertyDeclarations = {
    viewer: { attribute: false },
    placement: { reflect: true },
    selectedId: { state: true },
  };

  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--dv-color-surface);
      }
      :host([hidden]) {
        display: none;
      }
      [role='tablist'] {
        display: flex;
        gap: var(--dv-space);
        padding: var(--dv-space) calc(var(--dv-space) * 2) 0;
        border-bottom: 1px solid var(--dv-color-border);
      }
      [role='tab'] {
        font: inherit;
        color: var(--dv-color-text-muted);
        background: transparent;
        border: 1px solid transparent;
        border-bottom: 0;
        border-radius: var(--dv-radius) var(--dv-radius) 0 0;
        padding: calc(var(--dv-space) * 1.5) calc(var(--dv-space) * 3);
        cursor: pointer;
      }
      [role='tab'][aria-selected='true'] {
        color: var(--dv-color-text);
        background: var(--dv-color-surface-raised);
        border-color: var(--dv-color-border);
      }
      [role='tabpanel'] {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      [role='tabpanel'][hidden] {
        display: none;
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  declare placement: PanelPlacement;
  declare selectedId: string | undefined;

  #entries = new Map<string, Mounted>();
  #off: (() => void) | undefined;
  #listeningTo: Viewer | undefined;

  constructor() {
    super();
    this.placement = 'left';
    this.selectedId = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#listen();
    // Panels were dropped when the dock was removed: draw them again.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#off?.();
    this.#off = undefined;
    this.#listeningTo = undefined;
    // A dock that goes away takes its panels' content with it; the viewer still has the definitions.
    for (const entry of this.#entries.values()) this.#unmount(entry);
    this.#entries.clear();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('viewer')) this.#listen();
    this.#reconcile();
  }

  override updated(): void {
    this.toggleAttribute('hidden', this.#entries.size === 0);
    for (const entry of this.#entries.values()) {
      const shown = entry.definition.id === this.selectedId;
      entry.container.hidden = !shown;
      if (shown && !entry.mounted) this.#mount(entry);
    }
  }

  #listen(): void {
    const { viewer } = this;
    if (viewer === this.#listeningTo) return;
    this.#off?.();
    this.#off = undefined;
    this.#listeningTo = undefined;
    // The old viewer's panels are not the new one's.
    for (const entry of this.#entries.values()) this.#unmount(entry);
    this.#entries.clear();
    if (viewer === undefined || !this.isConnected) return;
    this.#listeningTo = viewer;
    this.#off = viewer.on('ui:panels', () => {
      this.requestUpdate();
    });
  }

  #mine(): readonly PanelDefinition[] {
    return (this.viewer?.ui.panels() ?? []).filter((panel) => panel.placement === this.placement);
  }

  #reconcile(): void {
    const panels = this.#mine();
    for (const [id, entry] of this.#entries) {
      if (!panels.includes(entry.definition)) {
        this.#unmount(entry);
        this.#entries.delete(id);
      }
    }
    for (const definition of panels) {
      if (this.#entries.has(definition.id)) continue;
      const container = document.createElement('div');
      container.setAttribute('role', 'tabpanel');
      container.setAttribute('part', 'panel');
      container.id = `dv-panel-${definition.id}`;
      container.setAttribute('aria-labelledby', `dv-tab-${definition.id}`);
      container.hidden = true;
      this.#entries.set(definition.id, {
        definition,
        container,
        cleanup: undefined,
        mounted: false,
      });
    }
    if (this.selectedId === undefined || !this.#entries.has(this.selectedId)) {
      this.selectedId = panels[0]?.id;
    }
  }

  #mount(entry: Mounted): void {
    entry.mounted = true;
    try {
      const cleanup = entry.definition.mount(entry.container);
      entry.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent<{ error: Error; context: 'panel' }>('dv-error', {
          detail: { error: toError(error), context: 'panel' },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  #unmount(entry: Mounted): void {
    const { cleanup } = entry;
    entry.cleanup = undefined;
    try {
      cleanup?.();
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent<{ error: Error; context: 'panel' }>('dv-error', {
          detail: { error: toError(error), context: 'panel' },
          bubbles: true,
          composed: true,
        }),
      );
    }
    entry.container.remove();
  }

  #onKeydown(event: KeyboardEvent): void {
    const tabs = [...this.renderRoot.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = tabs.indexOf(event.target as HTMLElement);
    const next = nextFocusIndex(event.key, current, tabs.length);
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[next];
    this.selectedId = tab?.dataset['panel'];
    tab?.focus();
  }

  override render(): TemplateResult | typeof nothing {
    const entries = [...this.#entries.values()];
    if (entries.length === 0) return nothing;
    return html`<div
        role="tablist"
        part="tabs"
        aria-label=${`${this.placement === 'left' ? 'Left' : 'Right'} panels`}
        @keydown=${this.#onKeydown}
      >
        ${entries.map(({ definition }) => {
          const selected = definition.id === this.selectedId;
          return html`<button
            type="button"
            role="tab"
            part="panel-tab"
            id=${`dv-tab-${definition.id}`}
            data-panel=${definition.id}
            aria-selected=${selected ? 'true' : 'false'}
            aria-controls=${`dv-panel-${definition.id}`}
            tabindex=${selected ? 0 : -1}
            @click=${(): void => {
              this.selectedId = definition.id;
            }}
          >
            ${definition.title}
          </button>`;
        })}
      </div>
      ${entries.map(({ container }) => container)}`;
  }
}
