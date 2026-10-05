import type { Viewer } from '@scope/viewer-core';
import {
  html,
  LitElement,
  nothing,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
  css,
  type CSSResultGroup,
} from 'lit';
import { baseStyles, themeStyles } from './theme';
import {
  type ActionItem,
  DEFAULT_TOOLBAR,
  type MenuEntry,
  type MenuItem,
  nextFocusIndex,
  type ToolbarContext,
  type ToolbarItem,
} from './toolbar-config';

/** What the toolbar tells its host when an action fails: the same shape as `dv-error` from the shell. */
export interface ToolbarErrorDetail {
  readonly error: Error;
  readonly context: 'toolbar';
}

const EVENTS = ['tool:active', 'viewport:voi', 'viewport:cine', 'state:changed'] as const;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The toolbar: tools for the left mouse button, actions, and menus, as one `role="toolbar"` with a
 * single tab stop. Arrow keys, Home, and End move between controls. Chrome only, so it uses shadow
 * DOM; the viewports it acts on never go inside it (docs/adr/0007-styled-shell.md).
 */
export class DvToolbarElement extends LitElement {
  static override properties: PropertyDeclarations = {
    viewer: { attribute: false },
    items: { attribute: false },
    viewportId: { attribute: 'viewport-id' },
    label: {},
    openMenu: { state: true },
  };

  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--dv-color-surface);
        border-bottom: 1px solid var(--dv-color-border);
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: calc(var(--dv-space) * 2);
        min-height: var(--dv-toolbar-height);
        padding: var(--dv-space) calc(var(--dv-space) * 2);
      }
      .spacer {
        flex: 1;
      }
      .separator {
        align-self: stretch;
        width: 1px;
        margin: var(--dv-space) calc(var(--dv-space) * 1);
        background: var(--dv-color-border);
      }
      button {
        font: inherit;
        color: var(--dv-color-text);
        background: var(--dv-color-surface-raised);
        border: 1px solid var(--dv-color-border);
        border-radius: var(--dv-radius);
        padding: calc(var(--dv-space) * 1.5) calc(var(--dv-space) * 3);
        min-height: 2rem;
        cursor: pointer;
      }
      button[aria-pressed='true'] {
        background: var(--dv-color-accent);
        border-color: var(--dv-color-accent);
        color: var(--dv-color-accent-text);
      }
      button[aria-disabled='true'] {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .menu-wrap {
        position: relative;
      }
      [role='menu'] {
        position: absolute;
        z-index: 10;
        top: 100%;
        left: 0;
        margin-top: var(--dv-space);
        min-width: 10rem;
        display: flex;
        flex-direction: column;
        padding: var(--dv-space);
        background: var(--dv-color-surface);
        border: 1px solid var(--dv-color-border);
        border-radius: var(--dv-radius);
      }
      [role='menu'] button {
        text-align: left;
        background: transparent;
        border-color: transparent;
      }
      [role='menu'] button:hover {
        background: var(--dv-color-surface-raised);
      }
    `,
  ];

  declare viewer: Viewer | undefined;
  /** What the toolbar shows. Default: the built-in tools, actions, and window presets. */
  declare items: readonly ToolbarItem[];
  /** The viewport the actions work on. Default `vp-0`. */
  declare viewportId: string;
  /** The toolbar's accessible name. */
  declare label: string;
  declare openMenu: string | undefined;

  #unsubscribe: (() => void)[] = [];
  #subscribedTo: Viewer | undefined;
  #rovingIndex = 0;

  constructor() {
    super();
    this.items = DEFAULT_TOOLBAR;
    this.viewportId = 'vp-0';
    this.label = 'Viewer tools';
    this.openMenu = undefined;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopListening();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#listen();
    // What the viewer did while the toolbar was away is not in what it drew last.
    this.requestUpdate();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('viewer')) this.#listen();
  }

  #listen(): void {
    const { viewer } = this;
    if (viewer === this.#subscribedTo && this.#unsubscribe.length > 0) return;
    this.#stopListening();
    if (viewer === undefined || !this.isConnected) return;
    this.#subscribedTo = viewer;
    const refresh = (): void => {
      this.requestUpdate();
    };
    this.#unsubscribe = EVENTS.map((event) => viewer.on(event, refresh));
  }

  #stopListening(): void {
    for (const stop of this.#unsubscribe) stop();
    this.#unsubscribe = [];
    this.#subscribedTo = undefined;
  }

  #context(): ToolbarContext | undefined {
    const { viewer } = this;
    return viewer === undefined ? undefined : { viewer, viewportId: this.viewportId };
  }

  #controls(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[data-roving]')];
  }

  #fail(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent<ToolbarErrorDetail>('dv-error', {
        detail: { error: toError(error), context: 'toolbar' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #enabled(item: ActionItem | MenuEntry, context: ToolbarContext): boolean {
    if (item.enabled !== undefined) return item.enabled(context);
    return context.viewer.viewports.get(context.viewportId)?.series !== undefined;
  }

  async #run(item: ActionItem | MenuEntry, context: ToolbarContext): Promise<void> {
    if (!this.#enabled(item, context)) return;
    try {
      await item.run(context);
    } catch (error) {
      this.#fail(error);
    }
  }

  #onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (this.openMenu !== undefined && target.closest('[role="menu"]') !== null) {
      this.#onMenuKey(event);
      return;
    }
    if (!target.hasAttribute('data-roving')) return;
    if (this.openMenu !== undefined && (event.key === 'Escape' || event.key === 'Tab')) {
      this.openMenu = undefined;
      return;
    }
    if (
      target.getAttribute('aria-haspopup') === 'menu' &&
      ['ArrowDown', 'Enter', ' '].includes(event.key)
    ) {
      event.preventDefault();
      this.#openMenu(target.dataset['menuId'], true);
      return;
    }
    const controls = this.#controls();
    const next = nextFocusIndex(event.key, controls.indexOf(target), controls.length);
    if (next === undefined) return;
    event.preventDefault();
    this.openMenu = undefined;
    controls[next]?.focus();
  }

  #onMenuKey(event: KeyboardEvent): void {
    const items = [
      ...this.renderRoot.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]'),
    ];
    const current = items.indexOf(event.target as HTMLElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      const opener = this.renderRoot.querySelector<HTMLElement>(
        `[data-menu-id="${this.openMenu ?? ''}"]`,
      );
      this.openMenu = undefined;
      if (event.key === 'Escape') {
        event.preventDefault();
        opener?.focus();
      }
      return;
    }
    // A menu is a vertical list: left and right do nothing, and must not move the toolbar's focus.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      return;
    }
    const next = nextFocusIndex(event.key, current, items.length);
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  #openMenu(id: string | undefined, focusFirst: boolean): void {
    this.openMenu = id;
    if (!focusFirst) return;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('[role="menu"] [role^="menuitem"]')?.focus();
    });
  }

  #onFocusin(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute('data-roving')) return;
    const at = this.#controls().indexOf(target);
    if (at >= 0 && at !== this.#rovingIndex) {
      this.#rovingIndex = at;
      this.requestUpdate();
    }
  }

  #onFocusout(event: FocusEvent): void {
    // Focus leaving the toolbar closes an open menu; focus moving inside it does not.
    const next = event.relatedTarget;
    if (this.openMenu !== undefined && !(next instanceof Node && this.renderRoot.contains(next))) {
      this.openMenu = undefined;
    }
  }

  #roving(position: number): number {
    return position === this.#rovingIndex ? 0 : -1;
  }

  #renderItem(
    item: ToolbarItem,
    context: ToolbarContext,
    position: { next: number },
  ): TemplateResult | typeof nothing {
    switch (item.type) {
      case 'separator':
        return html`<span class="separator" role="separator" aria-orientation="vertical"></span>`;
      case 'custom':
        return item.render(context);
      case 'tool': {
        const label =
          item.label ??
          context.viewer.tools.list().find((tool) => tool.id === item.tool)?.label ??
          item.tool;
        const at = position.next++;
        const pressed = context.viewer.tools.getActive() === item.tool;
        return html`<button
          type="button"
          part="button"
          data-roving
          data-tool=${item.tool}
          tabindex=${this.#roving(at)}
          aria-pressed=${pressed ? 'true' : 'false'}
          @click=${(): void => {
            context.viewer.tools.setActive(item.tool).catch((error: unknown) => {
              this.#fail(error);
            });
          }}
        >
          ${label}
        </button>`;
      }
      case 'action': {
        const at = position.next++;
        const pressed = item.pressed?.(context);
        const disabled = !this.#enabled(item, context);
        return html`<button
          type="button"
          part="button"
          data-roving
          data-action=${item.id}
          tabindex=${this.#roving(at)}
          aria-pressed=${pressed === undefined ? nothing : pressed ? 'true' : 'false'}
          aria-disabled=${disabled ? 'true' : nothing}
          @click=${(): void => {
            void this.#run(item, context);
          }}
        >
          ${item.label}
        </button>`;
      }
      case 'menu':
        return this.#renderMenu(item, context, position.next++);
    }
  }

  #renderMenu(item: MenuItem, context: ToolbarContext, at: number): TemplateResult {
    const open = this.openMenu === item.id;
    const entries = open
      ? typeof item.items === 'function'
        ? item.items(context)
        : item.items
      : [];
    return html`<div class="menu-wrap">
      <button
        type="button"
        part="button"
        data-roving
        data-menu-id=${item.id}
        id=${`dv-menu-button-${item.id}`}
        tabindex=${this.#roving(at)}
        aria-haspopup="menu"
        aria-expanded=${open ? 'true' : 'false'}
        @click=${(): void => {
          this.#openMenu(open ? undefined : item.id, false);
        }}
      >
        ${item.label}
      </button>
      ${
        open
          ? html`<div role="menu" part="menu" aria-labelledby=${`dv-menu-button-${item.id}`}>
            ${entries.map(
              (entry) => html`<button
                type="button"
                role="menuitem"
                part="menu-item"
                tabindex="-1"
                data-action=${entry.id}
                aria-disabled=${this.#enabled(entry, context) ? nothing : 'true'}
                @click=${(): void => {
                  this.openMenu = undefined;
                  void this.#run(entry, context);
                  this.renderRoot
                    .querySelector<HTMLElement>(`[data-menu-id="${item.id}"]`)
                    ?.focus();
                }}
              >
                ${entry.label}
              </button>`,
            )}
          </div>`
          : nothing
      }
    </div>`;
  }

  override render(): TemplateResult {
    const context = this.#context();
    const position = { next: 0 };
    return html`<div
      class="bar"
      part="toolbar"
      role="toolbar"
      aria-label=${this.label}
      aria-orientation="horizontal"
      @keydown=${this.#onKeydown}
      @focusin=${this.#onFocusin}
      @focusout=${this.#onFocusout}
    >
      <slot name="start"></slot>
      ${context === undefined ? nothing : this.items.map((item) => this.#renderItem(item, context, position))}
      <span class="spacer"></span>
      <slot name="end"></slot>
    </div>`;
  }
}
