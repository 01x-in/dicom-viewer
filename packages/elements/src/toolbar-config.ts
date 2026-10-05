import type { PrimaryTool, Viewer } from '@scope/viewer-core';
import type { TemplateResult } from 'lit';

/** What a toolbar action is told about: the viewer, and the viewport the toolbar works on. */
export interface ToolbarContext {
  readonly viewer: Viewer;
  readonly viewportId: string;
}

export interface ToolItem {
  readonly type: 'tool';
  readonly tool: PrimaryTool;
  /** Default: the tool's own label. */
  readonly label?: string;
}

export interface ActionItem {
  readonly type: 'action';
  readonly id: string;
  readonly label: string;
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
  run: (context) => viewportOf(context)?.zoomBy(ZOOM_IN_FACTOR),
};

const ZOOM_OUT: ActionItem = {
  type: 'action',
  id: 'zoom-out',
  label: 'Zoom out',
  run: (context) => viewportOf(context)?.zoomBy(ZOOM_OUT_FACTOR),
};

const INVERT: ActionItem = {
  type: 'action',
  id: 'invert',
  label: 'Invert',
  run: (context) => viewportOf(context)?.toggleInvert(),
  pressed: (context) => stateOf(context).invert,
};

const RESET: ActionItem = {
  type: 'action',
  id: 'reset',
  label: 'Reset',
  run: (context) => viewportOf(context)?.resetView(),
};

const CINE: ActionItem = {
  type: 'action',
  id: 'cine',
  label: 'Cine',
  run: (context) => {
    const viewport = viewportOf(context);
    if (viewport === undefined) return undefined;
    if (viewport.cine.playing) {
      viewport.cine.stop();
      return undefined;
    }
    return viewport.cine.play();
  },
  pressed: (context) => viewportOf(context)?.cine.playing === true,
};

const PRESETS: MenuItem = {
  type: 'menu',
  id: 'presets',
  label: 'Presets',
  items: ({ viewer, viewportId }) =>
    viewer.tools.windowPresets().map((preset) => ({
      id: `preset-${preset.id}`,
      label: preset.label,
      run: () => viewer.viewports.get(viewportId)?.applyWindowPreset(preset.id),
    })),
};

/** The measurement tools as a menu: the left mouse button draws the one that is chosen. */
const MEASURE: MenuItem = {
  type: 'menu',
  id: 'measure',
  label: 'Measure',
  items: ({ viewer }) =>
    viewer.tools
      .list()
      .filter((tool) => tool.kind === 'measure')
      .map((tool) => ({
        id: `tool-${tool.id}`,
        label: tool.label,
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
  readonly measure: MenuItem;
} = {
  zoomIn: ZOOM_IN,
  zoomOut: ZOOM_OUT,
  invert: INVERT,
  reset: RESET,
  cine: CINE,
  presets: PRESETS,
  measure: MEASURE,
};

/** What `<dv-toolbar>` shows unless it is given other items. */
export const DEFAULT_TOOLBAR: readonly ToolbarItem[] = [
  { type: 'tool', tool: 'window-level' },
  { type: 'tool', tool: 'pan' },
  { type: 'tool', tool: 'zoom' },
  { type: 'tool', tool: 'stack-scroll' },
  { type: 'separator' },
  MEASURE,
  { type: 'separator' },
  ZOOM_IN,
  ZOOM_OUT,
  INVERT,
  RESET,
  CINE,
  { type: 'separator' },
  PRESETS,
];

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
