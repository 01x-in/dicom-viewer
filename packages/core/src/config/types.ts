import type { KeyAction } from '../keyboard';
import type { PrimaryTool } from '../tools';
import type { WindowPreset } from '../window-presets';

export const THEME_NAMES = ['dark', 'light'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const PALETTE_NAMES = ['default', 'navy', 'graphite'] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

export const TOOLBAR_LABELS = ['tooltip', 'inline'] as const;
export type ToolbarLabels = (typeof TOOLBAR_LABELS)[number];

/** The built-in panels a config can hide. */
export const PANEL_IDS = ['series', 'measurements', 'segmentations'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** Keys and actions, by chord such as `m` or `Shift+i`. `null` removes a key. */
export type KeybindingsConfig = Readonly<Record<string, KeyAction | null>>;

export interface ToolbarConfig {
  /** `tooltip`: buttons with a picture show only the picture. `inline`: the name is beside it. */
  readonly labels?: ToolbarLabels | undefined;
  /** No toolbar at all. */
  readonly hidden?: boolean | undefined;
}

export interface OverlayConfig {
  /** Show the patient's name and ID. Off by default. */
  readonly showPatientInfo?: boolean | undefined;
}

export interface PanelsConfig {
  /** Built-in panels to leave out. */
  readonly hide?: readonly PanelId[] | undefined;
}

export interface ToolsConfig {
  /** The tool the left mouse button drives at the start. Read when the viewer starts. */
  readonly active?: PrimaryTool | undefined;
}

/**
 * What a layer may say, without the version. `null` for a top-level key puts it back to its
 * default. Every key is optional: a layer changes only what it names.
 */
export interface ConfigBody {
  readonly theme?: ThemeName | null | undefined;
  readonly palette?: PaletteName | null | undefined;
  readonly toolbar?: ToolbarConfig | null | undefined;
  /** `false` turns the keyboard off. */
  readonly keybindings?: false | KeybindingsConfig | null | undefined;
  /** `false` removes the overlay. */
  readonly overlay?: false | OverlayConfig | null | undefined;
  readonly panels?: PanelsConfig | null | undefined;
  /** Replaces the list of window presets. */
  readonly windowLevelPresets?: readonly WindowPreset[] | null | undefined;
  readonly tools?: ToolsConfig | null | undefined;
}

/** A config as a host writes it: JSON, with `version: 1`. */
export interface ViewerConfigV1 extends ConfigBody {
  readonly version: 1;
}

/** Every layer merged, with the defaults filled in. */
export interface ResolvedViewerConfig {
  /** `undefined`: no layer chose one, so the shell's own setting decides. */
  readonly theme: ThemeName | undefined;
  readonly palette: PaletteName | undefined;
  readonly toolbar: {
    readonly labels: ToolbarLabels | undefined;
    readonly hidden: boolean;
  };
  readonly keybindings: false | KeybindingsConfig;
  readonly overlay: false | { readonly showPatientInfo: boolean };
  readonly panels: { readonly hide: readonly PanelId[] };
  readonly windowLevelPresets: readonly WindowPreset[];
  readonly tools: { readonly active: PrimaryTool };
}
