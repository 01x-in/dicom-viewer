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
import type { MeasurementType } from '../measurements/model';
import { DEFAULT_PRIMARY_TOOL, isMeasureTool, PRIMARY_TOOLS, type PrimaryTool } from '../tools';

/**
 * The tool classes the v1 viewer will use. Referencing them all keeps the recorded bundle size
 * honest (tree-shaking would otherwise drop everything that is never named). Crosshairs wait for
 * M7.
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
  length: nameOf(LengthTool),
  bidirectional: nameOf(BidirectionalTool),
  ellipse: nameOf(EllipticalROITool),
  rectangle: nameOf(RectangleROITool),
  probe: nameOf(ProbeTool),
  angle: nameOf(AngleTool),
};

/** The measurement a Cornerstone tool draws, by the tool's name. */
export const MEASUREMENT_OF_TOOL: ReadonlyMap<string, MeasurementType> = new Map(
  PRIMARY_TOOLS.flatMap(({ id }) => (isMeasureTool(id) ? [[TOOL_NAMES[id], id] as const] : [])),
);

export function toolNameOf(type: MeasurementType): string {
  return TOOL_NAMES[type];
}

/** What each tool answers to whatever the left button drives: middle pans, right zooms, the wheel scrolls. */
const FIXED_BUTTONS: Readonly<Record<PrimaryTool, readonly Enums.MouseBindings[]>> = {
  'window-level': [],
  pan: [Enums.MouseBindings.Auxiliary],
  zoom: [Enums.MouseBindings.Secondary],
  'stack-scroll': [Enums.MouseBindings.Wheel],
  // A measurement tool has the left button when it is chosen, and nothing else.
  length: [],
  bidirectional: [],
  ellipse: [],
  rectangle: [],
  probe: [],
  angle: [],
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
  // The buttons every tool keeps whatever the left button drives. Set once: Cornerstone adds the
  // bindings it is given to the ones a tool has, so they would only pile up.
  for (const { id } of PRIMARY_TOOLS) {
    const buttons = FIXED_BUTTONS[id];
    if (buttons.length > 0) {
      group.setToolActive(TOOL_NAMES[id], {
        bindings: buttons.map((mouseButton) => ({ mouseButton })),
      });
    }
  }
  const setPrimary = (primary: PrimaryTool): void => {
    // Passive takes the left button away from a tool and leaves its other buttons; then the new
    // tool is given the left button on top of its own.
    for (const { id } of PRIMARY_TOOLS) group.setToolPassive(TOOL_NAMES[id]);
    group.setToolActive(TOOL_NAMES[primary], {
      bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
    });
  };
  setPrimary(DEFAULT_PRIMARY_TOOL);
  return {
    setPrimary,
    detach(): void {
      ToolGroupManager.destroyToolGroup(groupId);
    },
  };
}
