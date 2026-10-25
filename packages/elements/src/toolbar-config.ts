import {
  type KeyAction,
  LAYOUTS,
  type LayoutId,
  type PrimaryTool,
  type Viewer,
} from '@01x/dicom-viewer-core';
import type { TemplateResult } from 'lit';
import type { IconName } from './icons';

/** What a toolbar action is told about: the viewer, and the viewport the toolbar works on. */
export interface ToolbarContext {
  readonly viewer: Viewer;
  readonly viewportId: string;
}

/** The picture of each tool of the viewer. */
export const TOOL_ICONS: Readonly<Record<PrimaryTool, IconName>> = {
  'window-level': 'window-level',
  pan: 'pan',
  zoom: 'zoom',
  'stack-scroll': 'stack-scroll',
  crosshairs: 'crosshairs',
  length: 'length',
  bidirectional: 'bidirectional',
  ellipse: 'ellipse',
  rectangle: 'rectangle',
  probe: 'probe',
  angle: 'angle',
};

export interface ToolItem {
  readonly type: 'tool';
  readonly tool: PrimaryTool;
  /** Default: the tool's own label. */
  readonly label?: string;
  /** Default: the tool's own picture. */
  readonly icon?: IconName;
}

export interface ActionItem {
  readonly type: 'action';
  readonly id: string;
  readonly label: string;
  /** Without one, the button shows its label as text. */
  readonly icon?: IconName;
  /** Which key action this button is the same as, so the tooltip can show the key that is bound to it. */
  readonly shortcut?: (action: KeyAction) => boolean;
  run(context: ToolbarContext): void | Promise<void>;
  /** Makes the button a toggle that shows whether it is on. */
  pressed?(context: ToolbarContext): boolean;
  /** Default: there is a series on screen to act on. */
  enabled?(context: ToolbarContext): boolean;
}

/** One entry of a menu. A menu holds actions only. */
export type MenuEntry = Omit<ActionItem, 'type'> & { readonly type?: 'action' };

export interface MenuItem {
  readonly type: 'menu';
  readonly id: string;
  readonly label: string;
  /** Without one, the button shows its label as text. */
  readonly icon?: IconName;
  /** A function is asked each time the menu opens, for entries that depend on the viewer. */
  readonly items: readonly MenuEntry[] | ((context: ToolbarContext) => readonly MenuEntry[]);
}

export interface SeparatorItem {
  readonly type: 'separator';
}

export interface CustomItem {
  readonly type: 'custom';
  readonly id: string;
  /** Drawn in place; the content owns its own keyboard handling. */
  render(context: ToolbarContext): TemplateResult;
}

export type ToolbarItem = ToolItem | ActionItem | MenuItem | SeparatorItem | CustomItem;

const viewportOf = ({
  viewer,
  viewportId,
}: ToolbarContext): ReturnType<Viewer['viewports']['get']> => viewer.viewports.get(viewportId);

const stateOf = ({ viewer, viewportId }: ToolbarContext): { readonly invert: boolean } => ({
  invert:
    viewer.getState().viewports.find((viewport) => viewport.id === viewportId)?.invert === true,
});

export const ZOOM_IN_FACTOR = 1.25;
export const ZOOM_OUT_FACTOR = 0.8;

const ZOOM_IN: ActionItem = {
  type: 'action',
  id: 'zoom-in',
  label: 'Zoom in',
  icon: 'zoom-in',
  shortcut: (action) => action.type === 'zoom' && action.factor > 1,
  run: (context) => viewportOf(context)?.zoomBy(ZOOM_IN_FACTOR),
};

const ZOOM_OUT: ActionItem = {
  type: 'action',
  id: 'zoom-out',
  label: 'Zoom out',
  icon: 'zoom-out',
  shortcut: (action) => action.type === 'zoom' && action.factor < 1,
  run: (context) => viewportOf(context)?.zoomBy(ZOOM_OUT_FACTOR),
};

const INVERT: ActionItem = {
  type: 'action',
  id: 'invert',
  label: 'Invert',
  icon: 'invert',
  shortcut: (action) => action.type === 'invert',
  run: (context) => viewportOf(context)?.toggleInvert(),
  pressed: (context) => stateOf(context).invert,
};

const RESET: ActionItem = {
  type: 'action',
  id: 'reset',
  label: 'Reset',
  icon: 'reset',
  shortcut: (action) => action.type === 'reset',
  run: (context) => viewportOf(context)?.resetView(),
};

const CINE: ActionItem = {
  type: 'action',
  id: 'cine',
  label: 'Cine',
  icon: 'cine',
  shortcut: (action) => action.type === 'cine',
  run: (context) => viewportOf(context)?.cine.toggle(),
  pressed: (context) => viewportOf(context)?.cine.playing === true,
};

const PRESETS: MenuItem = {
  type: 'menu',
  id: 'presets',
  label: 'Presets',
  icon: 'presets',
  items: ({ viewer, viewportId }) =>
    viewer.tools.windowPresets().map((preset) => ({
      id: `preset-${preset.id}`,
      label: preset.label,
      run: () => viewer.viewports.get(viewportId)?.applyWindowPreset(preset.id),
    })),
};

/** What each layout is called in a menu. */
export const LAYOUT_LABELS: Readonly<Record<LayoutId, string>> = {
  '1x1': 'One viewport',
  '1x2': 'Two side by side',
  '2x2': 'Two by two',
  '1+3': 'One large, three small',
};

/** The layouts as a menu: the one in use is marked, and choosing one needs no series. */
const LAYOUT: MenuItem = {
  type: 'menu',
  id: 'layout',
  label: 'Layout',
  icon: 'layout',
  items: ({ viewer }) => [
    ...LAYOUTS.map((layout) => ({
      id: `layout-${layout}`,
      label: LAYOUT_LABELS[layout],
      enabled: () => true,
      run: () => viewer.setLayout(layout),
      // A 2x2 of planes is the last entry, not this one.
      pressed: () =>
        viewer.getState().layout === layout && viewer.commands.pressed('mpr.show') !== true,
    })),
    {
      id: 'layout-mpr',
      label: 'Three planes and slices',
      // Needs a series on screen to reformat: the default of an action.
      run: () => viewer.showMpr(),
      pressed: () => viewer.commands.pressed('mpr.show') === true,
    },
  ],
};

/** The measurement tools as a menu: the left mouse button draws the one that is chosen. */
const MEASURE: MenuItem = {
  type: 'menu',
  id: 'measure',
  label: 'Measure',
  icon: 'measure',
  items: ({ viewer }) =>
    viewer.tools
      .list()
      .filter((tool) => tool.kind === 'measure')
      .map((tool) => ({
        id: `tool-${tool.id}`,
        label: tool.label,
        icon: TOOL_ICONS[tool.id],
        shortcut: (action) => action.type === 'tool' && action.tool === tool.id,
        // Choosing a tool needs no series, so it works before one is shown.
        enabled: () => true,
        run: () => viewer.tools.setActive(tool.id),
        pressed: () => viewer.tools.getActive() === tool.id,
      })),
};

/** The built-in actions, to put in a toolbar of your own. */
export const TOOLBAR_ACTIONS: {
  readonly zoomIn: ActionItem;
  readonly zoomOut: ActionItem;
  readonly invert: ActionItem;
  readonly reset: ActionItem;
  readonly cine: ActionItem;
  readonly presets: MenuItem;
  readonly layout: MenuItem;
  readonly measure: MenuItem;
} = {
  zoomIn: ZOOM_IN,
  zoomOut: ZOOM_OUT,
  invert: INVERT,
  reset: RESET,
  cine: CINE,
  presets: PRESETS,
  layout: LAYOUT,
  measure: MEASURE,
};

/** What `<dv-toolbar>` shows unless it is given other items. */
export const DEFAULT_TOOLBAR: readonly ToolbarItem[] = [
  { type: 'tool', tool: 'window-level' },
  { type: 'tool', tool: 'pan' },
  { type: 'tool', tool: 'zoom' },
  { type: 'tool', tool: 'stack-scroll' },
  { type: 'tool', tool: 'crosshairs' },
  { type: 'separator' },
  MEASURE,
  { type: 'separator' },
  ZOOM_IN,
  ZOOM_OUT,
  INVERT,
  RESET,
  CINE,
  { type: 'separator' },
  LAYOUT,
  PRESETS,
];

const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: 'Space',
  Plus: '+',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
  Escape: 'Esc',
  Delete: 'Del',
};

/** A chord as it is printed on a key hint: `w` is `W`, `Shift+i` is `Shift+I`, `Plus` is `+`. */
export function formatChord(chord: string): string {
  return chord
    .split('+')
    .map((part) => KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join('+');
}

/** The key bound to the first action `matches` accepts, as it should be printed, or `undefined`. */
export function shortcutOf(
  viewer: Viewer,
  matches: (action: KeyAction) => boolean,
): string | undefined {
  const found = viewer.tools.shortcuts().find((entry) => matches(entry.action));
  return found === undefined ? undefined : formatChord(found.chord);
}

/**
 * Where the keyboard focus goes when an arrow, Home, or End is pressed among `count` controls that
 * share one tab stop (the roving tabindex). `undefined` for any other key.
 */
export function nextFocusIndex(key: string, current: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
