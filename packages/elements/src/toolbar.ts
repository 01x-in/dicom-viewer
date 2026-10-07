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
import { type IconName, icon, iconStyles } from './icons';
import { baseStyles, themeStyles } from './theme';
import {
  type ActionItem,
  DEFAULT_TOOLBAR,
  type MenuEntry,
  type MenuItem,
  nextFocusIndex,
  shortcutOf,
  TOOL_ICONS,
  type ToolbarContext,
  type ToolbarItem,
} from './toolbar-config';

/** What the toolbar tells its host when an action fails: the same shape as `dv-error` from the shell. */
export interface ToolbarErrorDetail {
  readonly error: Error;
  readonly context: 'toolbar';
}

export type ToolbarLabels = 'tooltip' | 'inline';

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
    labels: { reflect: true },
    openMenu: { state: true },
    tipsOff: { state: true },
  };

  static override styles: CSSResultGroup = [
    themeStyles,
    baseStyles,
    iconStyles,
    css`
      :host {
        display: block;
        background: var(--dv-color-surface, #171b21);
        border-bottom: 1px solid var(--dv-color-border, #667284);
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--dv-space, 0.25rem);
        min-height: var(--dv-toolbar-height, 3rem);
        padding: var(--dv-space, 0.25rem) calc(var(--dv-space, 0.25rem) * 2);
      }
      .spacer {
        flex: 1;
      }
      .separator {
        align-self: center;
        height: 1.5rem;
        width: 1px;
        margin: 0 calc(var(--dv-space, 0.25rem) * 1.5);
        background: var(--dv-color-border, #667284);
        opacity: 0.6;
      }
      .item,
      .menu-wrap {
        position: relative;
        display: flex;
      }
      button {
        font: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: calc(var(--dv-space, 0.25rem) * 1.5);
        min-width: var(--dv-control-size, 2.25rem);
        height: var(--dv-control-size, 2.25rem);
        padding: 0 calc(var(--dv-space, 0.25rem) * 2);
        color: var(--dv-color-text, #e8ebf0);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--dv-radius-lg, 8px);
        cursor: pointer;
        transition: background-color 0.12s;
      }
      button:hover {
        background: var(--dv-color-surface-raised, #212731);
      }
      .has-icon {
        padding: 0;
        width: var(--dv-control-size, 2.25rem);
      }
      .has-icon.has-text,
      .menu-button {
        width: auto;
        padding: 0 calc(var(--dv-space, 0.25rem) * 2);
      }
      .caret {
        width: 0.9rem;
        height: 0.9rem;
        margin-left: -0.15rem;
        opacity: 0.8;
      }
      /* The tool the left mouse button drives, and a menu whose entry is chosen: filled. */
      button[data-tool][aria-pressed='true'],
      button[data-active='true'] {
        background: var(--dv-color-accent, #5aa9ff);
        border-color: var(--dv-color-accent, #5aa9ff);
        color: var(--dv-color-accent-text, #06121f);
      }
      /* A switch that is on (invert, cine): outlined, so it does not look like the active tool. */
      button[aria-pressed='true']:not([data-tool]) {
        color: var(--dv-color-accent, #5aa9ff);
        border-color: var(--dv-color-accent, #5aa9ff);
      }
      button[aria-disabled='true'] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      button[aria-disabled='true']:hover {
        background: transparent;
      }
      .tip {
        position: absolute;
        z-index: 20;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: calc(var(--dv-space, 0.25rem) * 2);
        padding: calc(var(--dv-space, 0.25rem) * 1) calc(var(--dv-space, 0.25rem) * 2.5);
        white-space: nowrap;
        font-size: 0.8125rem;
        color: var(--dv-color-text, #e8ebf0);
        background: var(--dv-color-surface-raised, #212731);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius, 6px);
        box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
        opacity: 0;
        visibility: hidden;
        transition:
          opacity 0.12s 0.35s,
          visibility 0s 0.47s;
      }
      /* Covers the gap, so the pointer can move onto the tip and keep it open. */
      .tip::before {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 100%;
        height: 8px;
      }
      .item:first-child .tip {
        left: 0;
        transform: none;
      }
      .item:hover .tip,
      .item:has(button:focus-visible) .tip {
        opacity: 1;
        visibility: visible;
      }
      :host([data-tips-off]) .tip {
        display: none;
      }
      .menu-wrap[data-open] .tip {
        display: none;
      }
      kbd {
        font: inherit;
        font-size: 0.75rem;
        padding: 0 calc(var(--dv-space, 0.25rem) * 1.5);
        color: var(--dv-color-text-muted, #a7b0be);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: 4px;
      }
      [role='menu'] {
        position: absolute;
        z-index: 30;
        top: calc(100% + 6px);
        left: 0;
        min-width: 13rem;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--dv-space, 0.25rem);
        background: var(--dv-color-surface-raised, #212731);
        border: 1px solid var(--dv-color-border, #667284);
        border-radius: var(--dv-radius-lg, 8px);
        box-shadow: 0 10px 28px rgb(0 0 0 / 0.4);
      }
      [role='menu'] button {
        width: 100%;
        justify-content: flex-start;
        height: auto;
        min-height: var(--dv-control-size, 2.25rem);
        padding: calc(var(--dv-space, 0.25rem) * 1.5) calc(var(--dv-space, 0.25rem) * 2.5);
        text-align: left;
        border-radius: var(--dv-radius, 6px);
      }
      [role='menu'] button:hover {
        background: var(--dv-color-surface, #171b21);
      }
      [role='menu'] .entry-label {
        flex: 1;
      }
      [role='menu'] button[aria-checked='true'] {
        background: var(--dv-color-accent, #5aa9ff);
        color: var(--dv-color-accent-text, #06121f);
      }
      [role='menu'] button[aria-checked='true'] kbd {
        color: inherit;
        border-color: currentcolor;
      }
      @media (forced-colors: active) {
        button[aria-pressed='true'],
        button[data-active='true'],
        [role='menu'] button[aria-checked='true'] {
          forced-color-adjust: none;
          background: Highlight;
          color: HighlightText;
        }
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
  /** `tooltip` (default): a button with a picture shows only the picture, and its name in a tooltip. `inline`: the name is beside the picture. */
  declare labels: ToolbarLabels;
  declare openMenu: string | undefined;
  /** Escape hides the tooltips until the pointer or the focus moves on (WCAG 1.4.13). */
  declare tipsOff: boolean;

  #unsubscribe: (() => void)[] = [];
  #subscribedTo: Viewer | undefined;
  #rovingIndex = 0;
  /** The control whose tooltip Escape closed, so the pointer resting on it does not bring it back. */
  #dismissedAt: Element | null = null;

  constructor() {
    super();
    this.items = DEFAULT_TOOLBAR;
    this.viewportId = 'vp-0';
    this.label = 'Viewer tools';
    this.labels = 'tooltip';
    this.openMenu = undefined;
    this.tipsOff = false;
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
    if (changed.has('tipsOff')) this.toggleAttribute('data-tips-off', this.tipsOff);
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

  /** The button that opens a menu. Found by comparing, not by a selector, so any id works. */
  #opener(id: string | undefined): HTMLElement | undefined {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('[data-menu-id]')].find(
      (button) => button.dataset['menuId'] === id,
    );
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
    if (event.key === 'Escape' && this.openMenu === undefined) {
      this.tipsOff = true;
      this.#dismissedAt = target.closest('.item, .menu-wrap');
    }
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
      const opener = this.#opener(this.openMenu);
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

  /** The pointer coming onto a control is a new reason to show its tooltip, so Escape's dismissal ends. */
  #onPointerover(event: PointerEvent): void {
    if (!this.tipsOff || !(event.target instanceof Element)) return;
    // Over the same control whose tooltip Escape closed, the pointer has not moved on.
    const item = event.target.closest('.item, .menu-wrap');
    if (item === null || item === this.#dismissedAt) return;
    this.tipsOff = false;
  }

  #onFocusin(event: FocusEvent): void {
    this.tipsOff = false;
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

  /** The picture, the text, or both, and the tooltip beside them. */
  #face(
    name: IconName | undefined,
    label: string,
    hint: string | undefined,
  ): { readonly content: TemplateResult; readonly tip: TemplateResult | typeof nothing } {
    const showText = name === undefined || this.labels === 'inline';
    return {
      content: html`${name === undefined ? nothing : icon(name)}${showText ? html`<span class="text">${label}</span>` : nothing}`,
      tip:
        showText && hint === undefined
          ? nothing
          : html`<span class="tip" aria-hidden="true"
              >${showText ? nothing : label}${hint === undefined ? nothing : html`<kbd>${hint}</kbd>`}</span
            >`,
    };
  }

  #classes(name: IconName | undefined): string {
    if (name === undefined) return '';
    return this.labels === 'inline' ? 'has-icon has-text' : 'has-icon';
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
        const name = item.icon ?? TOOL_ICONS[item.tool];
        const hint = shortcutOf(
          context.viewer,
          (action) => action.type === 'tool' && action.tool === item.tool,
        );
        const face = this.#face(name, label, hint);
        return html`<span class="item"
          ><button
            type="button"
            part="button"
            class=${this.#classes(name)}
            data-roving
            data-tool=${item.tool}
            tabindex=${this.#roving(at)}
            aria-label=${label}
            aria-pressed=${pressed ? 'true' : 'false'}
            @click=${(): void => {
              context.viewer.tools.setActive(item.tool).catch((error: unknown) => {
                this.#fail(error);
              });
            }}
          >
            ${face.content}</button
          >${face.tip}</span
        >`;
      }
      case 'action': {
        const at = position.next++;
        const pressed = item.pressed?.(context);
        const disabled = !this.#enabled(item, context);
        const hint =
          item.shortcut === undefined ? undefined : shortcutOf(context.viewer, item.shortcut);
        const face = this.#face(item.icon, item.label, hint);
        return html`<span class="item"
          ><button
            type="button"
            part="button"
            class=${this.#classes(item.icon)}
            data-roving
            data-action=${item.id}
            tabindex=${this.#roving(at)}
            aria-label=${item.label}
            aria-pressed=${pressed === undefined ? nothing : pressed ? 'true' : 'false'}
            aria-disabled=${disabled ? 'true' : nothing}
            @click=${(): void => {
              void this.#run(item, context);
            }}
          >
            ${face.content}</button
          >${face.tip}</span
        >`;
      }
      case 'menu':
        return this.#renderMenu(item, context, position.next++);
    }
  }

  #renderMenu(item: MenuItem, context: ToolbarContext, at: number): TemplateResult {
    const open = this.openMenu === item.id;
    const entries = typeof item.items === 'function' ? item.items(context) : item.items;
    // A menu that has a chosen entry shows it on its button, closed or open.
    const chosen = entries.find((entry) => entry.pressed?.(context) === true);
    const name = chosen?.icon ?? item.icon;
    const face = this.#face(name, item.label, undefined);
    return html`<div class="menu-wrap" data-open=${open ? '' : nothing}>
      <button
        type="button"
        part="button"
        class="menu-button ${this.#classes(name)}"
        data-roving
        data-menu-id=${item.id}
        id=${`dv-menu-button-${item.id}`}
        tabindex=${this.#roving(at)}
        aria-label=${item.label}
        aria-haspopup="menu"
        aria-expanded=${open ? 'true' : 'false'}
        data-active=${chosen === undefined ? nothing : 'true'}
        @click=${(): void => {
          this.#openMenu(open ? undefined : item.id, false);
        }}
      >
        ${face.content}${icon('chevron-down', 'caret')}
      </button>
      ${face.tip}
      ${
        open
          ? html`<div role="menu" part="menu" aria-labelledby=${`dv-menu-button-${item.id}`}>
            ${entries.map((entry) => {
              const checked = entry.pressed?.(context);
              const entryHint =
                entry.shortcut === undefined
                  ? undefined
                  : shortcutOf(context.viewer, entry.shortcut);
              return html`<button
                type="button"
                role=${checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked=${checked === undefined ? nothing : checked ? 'true' : 'false'}
                part="menu-item"
                tabindex="-1"
                data-action=${entry.id}
                aria-disabled=${this.#enabled(entry, context) ? nothing : 'true'}
                @click=${(): void => {
                  this.openMenu = undefined;
                  void this.#run(entry, context);
                  this.#opener(item.id)?.focus();
                }}
              >
                ${entry.icon === undefined ? nothing : icon(entry.icon)}
                <span class="entry-label">${entry.label}</span>
                ${entryHint === undefined ? nothing : html`<kbd>${entryHint}</kbd>`}
              </button>`;
            })}
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
      @pointerover=${this.#onPointerover}
    >
      <slot name="start"></slot>
      ${context === undefined ? nothing : this.items.map((item) => this.#renderItem(item, context, position))}
      <span class="spacer"></span>
      <slot name="end"></slot>
    </div>`;
  }
}
