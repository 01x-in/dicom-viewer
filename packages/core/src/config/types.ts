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

/** A button for one of the viewer's tools. */
export interface ToolbarToolItemConfig {
  readonly type: 'tool';
  readonly tool: PrimaryTool;
  /** Default: the tool's own name. */
  readonly label?: string | undefined;
  /** The name of one of the shell's pictures. */
  readonly icon?: string | undefined;
}

/** A button that runs a command (`viewer.commands`), with its arguments as JSON. */
export interface ToolbarCommandItemConfig {
  readonly type: 'command';
  /** Unique in the toolbar. Lower-case letters, digits and hyphens. */
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly command: string;
  readonly args?: unknown;
}

/** One entry of a menu: the same as a command button, with no picture needed. */
export interface ToolbarMenuEntryConfig {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly command: string;
  readonly args?: unknown;
}

export interface ToolbarMenuItemConfig {
  readonly type: 'menu';
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly items: readonly ToolbarMenuEntryConfig[];
}

export interface ToolbarSeparatorConfig {
  readonly type: 'separator';
}

export type ToolbarItemConfig =
  | ToolbarToolItemConfig
  | ToolbarCommandItemConfig
  | ToolbarMenuItemConfig
  | ToolbarSeparatorConfig;

export interface ToolbarConfig {
  /** The buttons, in order. A toolbar in a later layer replaces this one. Default: the built-in toolbar. */
  readonly items?: readonly ToolbarItemConfig[] | undefined;
  /** `tooltip`: buttons with a picture show only the picture. `inline`: the name is beside it. */
  readonly labels?: ToolbarLabels | undefined;
  /** No toolbar at all. */
  readonly hidden?: boolean | undefined;
}

export const OVERLAY_CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
export type OverlayCorner = (typeof OVERLAY_CORNERS)[number];

/** The lines the overlay has of its own. */
export const OVERLAY_BUILTINS = [
  'patientName',
  'patientId',
  'series',
  'modality',
  'size',
  'window',
  'zoom',
  'inverted',
  'image',
] as const;
export type OverlayBuiltin = (typeof OVERLAY_BUILTINS)[number];

export const OVERLAY_FORMATS = ['text', 'date', 'time', 'number', 'person-name'] as const;
export type OverlayFormat = (typeof OVERLAY_FORMATS)[number];

/** A line the overlay has of its own. */
export interface OverlayBuiltinItem {
  /** Unique in its corner. A later layer's item with the same id replaces this one. */
  readonly id: string;
  readonly kind: 'builtin';
  readonly name: OverlayBuiltin;
}

/** A line from a DICOM tag of the image on screen. */
export interface OverlayTagItem {
  readonly id: string;
  readonly kind: 'tag';
  /** A keyword such as `KVP`, or eight hex digits such as `00181030`. */
  readonly tag: string;
  /** Written before the value: `kVp 120`. */
  readonly label?: string | undefined;
  /** Default `text`. */
  readonly format?: OverlayFormat | undefined;
  /** For `number`: how many decimals. Default: up to two, without trailing zeros. */
  readonly decimals?: number | undefined;
}

/** Takes the item with this id out of its corner. */
export interface OverlayRemoveItem {
  readonly id: string;
  readonly kind: 'remove';
}

export type OverlayItemConfig = OverlayBuiltinItem | OverlayTagItem | OverlayRemoveItem;
export type OverlayShownItem = OverlayBuiltinItem | OverlayTagItem;

export interface OverlayConfig {
  /**
   * Show the patient's name and ID, and every tag that can identify a patient. Off by default,
   * whatever the items say.
   */
  readonly showPatientInfo?: boolean | undefined;
  /** What each corner shows. Items merge with the built-in ones by `id`. */
  readonly corners?: OverlayCornersConfig | undefined;
}

/** The items of each corner a layer changes. A corner a layer leaves out is left as it was. */
export interface OverlayCornersConfig {
  readonly topLeft?: readonly OverlayItemConfig[] | undefined;
  readonly topRight?: readonly OverlayItemConfig[] | undefined;
  readonly bottomLeft?: readonly OverlayItemConfig[] | undefined;
  readonly bottomRight?: readonly OverlayItemConfig[] | undefined;
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
  /** Where the JSON Schema is, for an editor. The viewer ignores it. */
  readonly $schema?: string | undefined;
}

/** Every layer merged, with the defaults filled in. */
export interface ResolvedViewerConfig {
  /** `undefined`: no layer chose one, so the shell's own setting decides. */
  readonly theme: ThemeName | undefined;
  readonly palette: PaletteName | undefined;
  readonly toolbar: {
    readonly labels: ToolbarLabels | undefined;
    readonly hidden: boolean;
    /** `undefined`: the built-in toolbar. */
    readonly items: readonly ToolbarItemConfig[] | undefined;
  };
  readonly keybindings: false | KeybindingsConfig;
  readonly overlay:
    | false
    | {
        readonly showPatientInfo: boolean;
        readonly corners: Readonly<Record<OverlayCorner, readonly OverlayShownItem[]>>;
      };
  readonly panels: { readonly hide: readonly PanelId[] };
  readonly windowLevelPresets: readonly WindowPreset[];
  readonly tools: { readonly active: PrimaryTool };
}
