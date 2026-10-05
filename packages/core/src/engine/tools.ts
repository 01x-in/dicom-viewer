import {
  addTool,
  AngleTool,
  BidirectionalTool,
  CrosshairsTool,
  Enums,
  EllipticalROITool,
  init as initTools,
  LengthTool,
  PanTool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { DEFAULT_PRIMARY_TOOL, PRIMARY_TOOLS, type PrimaryTool } from '../tools';

/**
 * The tool classes the v1 viewer will use. Referencing them all, even though only scrolling is
 * wired up in this spike, keeps the recorded bundle size honest (tree-shaking would otherwise
 * drop everything that is never named).
 */
const V1_TOOLS = [
  StackScrollTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  LengthTool,
  BidirectionalTool,
  EllipticalROITool,
  RectangleROITool,
  ProbeTool,
  AngleTool,
  CrosshairsTool,
] as const;

/** Cornerstone types `toolName` as `any`; check it instead of trusting it. */
function nameOf(tool: { readonly toolName: unknown }): string {
  if (typeof tool.toolName !== 'string') throw new TypeError('A Cornerstone tool has no toolName.');
  return tool.toolName;
}

export function registerTools(): void {
  initTools();
  for (const tool of V1_TOOLS) addTool(tool);
}

const TOOL_NAMES: Readonly<Record<PrimaryTool, string>> = {
  'window-level': nameOf(WindowLevelTool),
  pan: nameOf(PanTool),
  zoom: nameOf(ZoomTool),
  'stack-scroll': nameOf(StackScrollTool),
};

/** What each tool answers to whatever the left button drives: middle pans, right zooms, the wheel scrolls. */
const FIXED_BUTTONS: Readonly<Record<PrimaryTool, readonly Enums.MouseBindings[]>> = {
  'window-level': [],
  pan: [Enums.MouseBindings.Auxiliary],
  zoom: [Enums.MouseBindings.Secondary],
  'stack-scroll': [Enums.MouseBindings.Wheel],
};

export interface StackTools {
  /** Makes the left mouse button drive `tool`. */
  setPrimary(tool: PrimaryTool): void;
  detach(): void;
}

export function attachStackTools(renderingEngineId: string, viewportId: string): StackTools {
  const groupId = `${viewportId}-tools`;
  const group = ToolGroupManager.createToolGroup(groupId);
  if (group === undefined) throw new Error(`Could not create tool group ${groupId}.`);
  for (const tool of V1_TOOLS) group.addTool(nameOf(tool));
  group.addViewport(viewportId, renderingEngineId);
  const setPrimary = (primary: PrimaryTool): void => {
    for (const { id } of PRIMARY_TOOLS) {
      const buttons = [
        ...FIXED_BUTTONS[id],
        ...(id === primary ? [Enums.MouseBindings.Primary] : []),
      ];
      if (buttons.length === 0) {
        group.setToolPassive(TOOL_NAMES[id]);
      } else {
        group.setToolActive(TOOL_NAMES[id], {
          bindings: buttons.map((mouseButton) => ({ mouseButton })),
        });
      }
    }
  };
  setPrimary(DEFAULT_PRIMARY_TOOL);
  return {
    setPrimary,
    detach(): void {
      ToolGroupManager.destroyToolGroup(groupId);
    },
  };
}
