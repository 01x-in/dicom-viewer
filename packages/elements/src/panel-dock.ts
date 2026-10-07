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
import { type IconName, icon, iconStyles } from './icons';
import { baseStyles, themeStyles } from './theme';
import { nextFocusIndex } from './toolbar-config';

interface Mounted {
  readonly definition: PanelDefinition;
  readonly container: HTMLElement;
  cleanup: (() => void) | undefined;
  mounted: boolean;
}

/** The pictures of the built-in panels. A panel of the host's has none, and shows its title only. */
const PANEL_ICONS: Readonly<Record<string, IconName>> = {
  series: 'series',
  measurements: 'measure',
  segmentations: 'segments',
};

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
    collapsed: { type: Boolean, reflect: true },
    selectedId: { state: true },
  };

  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    iconStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--dv-color-surface, #171b21);
      }
      :host([hidden]) {
        display: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: var(--dv-space, 0.25rem) calc(var(--dv-space, 0.25rem) * 2);
        border-bottom: 1px solid var(--dv-color-border, #667284);
      }
      [role='tablist'] {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        flex-wrap: wrap;
      }
      button {
        font: inherit;
        display: inline-flex;
        align-items: center;
        gap: calc(var(--dv-space, 0.25rem) * 1.5);
        height: 2rem;
        padding: 0 calc(var(--dv-space, 0.25rem) * 2.5);
        color: var(--dv-color-text-muted, #a7b0be);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--dv-radius, 6px);
        cursor: pointer;
        transition: background-color 0.12s;
      }
      button:hover {
        color: var(--dv-color-text, #e8ebf0);
        background: var(--dv-color-surface-raised, #212731);
      }
      [role='tab'][aria-selected='true'] {
        color: var(--dv-color-text, #e8ebf0);
        background: var(--dv-color-surface-raised, #212731);
        box-shadow: inset 0 -2px 0 var(--dv-color-accent, #5aa9ff);
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
      [role='tab'][aria-selected='true'] .icon {
        color: var(--dv-color-accent, #5aa9ff);
      }
      .collapse {
        margin-left: auto;
        width: 2rem;
        padding: 0;
        justify-content: center;
      }
      .collapse .icon {
        transition: transform 0.15s;
      }
      /* The arrow points to where the dock goes: to the right for a dock on the right. */
      :host([placement='left']) .collapse .icon {
        transform: rotate(180deg);
      }
      :host([collapsed][placement='left']) .collapse .icon {
        transform: none;
      }
      :host([collapsed][placement='right']) .collapse .icon {
        transform: rotate(180deg);
      }
      [role='tabpanel'] {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      [role='tabpanel'][hidden] {
        display: none;
      }
      /* Folded: a strip of pictures down the edge. */
      :host([collapsed]) .head {
        flex: 1;
        flex-direction: column;
        align-items: stretch;
        border-bottom: 0;
        padding: calc(var(--dv-space, 0.25rem) * 2) var(--dv-space, 0.25rem);
      }
      :host([collapsed]) [role='tablist'] {
        flex-direction: column;
        align-items: stretch;
      }
      :host([collapsed]) [role='tab'] {
        justify-content: center;
        height: var(--dv-control-size, 2.25rem);
        padding: 0;
        border-radius: var(--dv-radius-lg, 8px);
      }
      :host([collapsed]) [role='tab'][aria-selected='true'] {
        box-shadow: inset 2px 0 0 var(--dv-color-accent, #5aa9ff);
      }
      :host([collapsed]) .tab-text {
        display: none;
      }
      :host([collapsed]) .collapse {
        margin: auto 0 0;
        width: auto;
        height: var(--dv-control-size, 2.25rem);
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  declare placement: PanelPlacement;
  /** Folded to a strip of pictures down the edge. A click on a tab opens it again. */
  declare collapsed: boolean;
  declare selectedId: string | undefined;

  #entries = new Map<string, Mounted>();
  #off: (() => void) | undefined;
  #listeningTo: Viewer | undefined;

  constructor() {
    super();
    this.placement = 'left';
    this.collapsed = false;
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
      const shown = !this.collapsed && entry.definition.id === this.selectedId;
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
    const { collapsed } = this;
    const toward = this.placement === 'left' ? 'left' : 'right';
    const verb = collapsed ? 'Expand' : 'Collapse';
    return html`<div class="head">
        <div
          role="tablist"
          part="tabs"
          aria-label=${`${this.placement === 'left' ? 'Left' : 'Right'} panels`}
          aria-orientation=${collapsed ? 'vertical' : 'horizontal'}
          @keydown=${this.#onKeydown}
        >
        ${entries.map(({ definition }) => {
          const selected = definition.id === this.selectedId;
          const name = PANEL_ICONS[definition.id];
          return html`<button
            type="button"
            role="tab"
            part="panel-tab"
            id=${`dv-tab-${definition.id}`}
            data-panel=${definition.id}
            aria-selected=${selected && !collapsed ? 'true' : 'false'}
            aria-controls=${`dv-panel-${definition.id}`}
            aria-label=${collapsed ? definition.title : nothing}
            title=${collapsed ? definition.title : nothing}
            tabindex=${selected ? 0 : -1}
            @click=${(): void => {
              this.selectedId = definition.id;
              this.collapsed = false;
            }}
          >
            ${name === undefined ? nothing : icon(name)}<span class="tab-text">${definition.title}</span>
          </button>`;
        })}
        </div>
        <button
          type="button"
          part="collapse"
          class="collapse"
          data-action="collapse"
          aria-label=${`${verb} the ${toward} panels`}
          aria-expanded=${collapsed ? 'false' : 'true'}
          title=${`${verb} the ${toward} panels`}
          @click=${(): void => {
            this.collapsed = !this.collapsed;
          }}
        >
          ${icon('chevron-right')}
        </button>
      </div>
      ${entries.map(({ container }) => container)}`;
  }
}
