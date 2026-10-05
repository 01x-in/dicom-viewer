import type { Unsubscribe } from './state/events';

export type PanelPlacement = 'left' | 'right';

/** A side panel the styled shell shows as a tab. A headless host can register panels too and draw them itself. */
export interface PanelDefinition {
  /** Lower-case letters, digits and hyphens, starting with a letter. The built-in series panel is `series`. */
  readonly id: string;
  /** The tab's label. */
  readonly title: string;
  readonly placement: PanelPlacement;
  /**
   * Fills `container` the first time the panel is shown, and the content stays while the panel is
   * on another tab. The return value, if any, runs when the panel is unregistered or the dock that
   * shows it goes away.
   */
  // `void` in a union is how callbacks that may return a cleanup are usually typed (React's effects).
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- the usual way to type an optional cleanup
  mount(container: HTMLElement): void | (() => void);
}

export interface UiApi {
  /**
   * Adds a panel. Throws a `RangeError` for an id that is badly formed or already taken. Returns what
   * removes it again.
   */
  registerPanel(panel: PanelDefinition): Unsubscribe;
  /** The panels in the order they were registered. */
  panels(): readonly PanelDefinition[];
}

const PLACEMENTS: readonly PanelPlacement[] = ['left', 'right'];
const PANEL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface UiRegistry {
  readonly api: UiApi;
  clear(): void;
}

/** The panels of one viewer. `changed` runs after every registration and removal. */
export function createUiRegistry(
  changed: (panels: readonly PanelDefinition[]) => void,
): UiRegistry {
  let panels: readonly PanelDefinition[] = [];
  return {
    api: {
      registerPanel(panel): Unsubscribe {
        if (!PANEL_ID.test(panel.id)) {
          throw new RangeError(
            `A panel id uses lower-case letters, digits and single hyphens, and starts with a letter, not "${panel.id}".`,
          );
        }
        if (panel.title.trim() === '') {
          throw new RangeError(`The panel ${panel.id} needs a title.`);
        }
        if (!PLACEMENTS.includes(panel.placement)) {
          throw new RangeError(`A panel goes on the left or the right, not "${panel.placement}".`);
        }
        if (typeof panel.mount !== 'function') {
          throw new TypeError(`The panel ${panel.id} needs a mount function.`);
        }
        if (panels.some((existing) => existing.id === panel.id)) {
          throw new RangeError(`There is already a panel ${panel.id}.`);
        }
        // Kept as given: the registrant owns the object, and a later change to it is not ours to track.
        const added: PanelDefinition = { ...panel };
        panels = [...panels, added];
        changed(panels);
        return (): void => {
          if (!panels.includes(added)) return;
          panels = panels.filter((existing) => existing !== added);
          changed(panels);
        };
      },
      panels: () => panels,
    },
    clear(): void {
      panels = [];
    },
  };
}
