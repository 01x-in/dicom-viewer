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

/** Wheel scrolls the stack. The remaining bindings arrive with M3. */
export function attachStackTools(renderingEngineId: string, viewportId: string): () => void {
  const groupId = `${viewportId}-tools`;
  const group = ToolGroupManager.createToolGroup(groupId);
  if (group === undefined) throw new Error(`Could not create tool group ${groupId}.`);
  for (const tool of V1_TOOLS) group.addTool(nameOf(tool));
  group.addViewport(viewportId, renderingEngineId);
  group.setToolActive(nameOf(StackScrollTool), {
    bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
  });
  return (): void => {
    ToolGroupManager.destroyToolGroup(groupId);
  };
}
