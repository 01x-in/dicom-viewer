/** The tools the left mouse button can drive. Middle is always pan, right zoom, and the wheel scrolls. */
export type PrimaryTool = 'window-level' | 'pan' | 'zoom' | 'stack-scroll';

export interface ToolInfo {
  readonly id: PrimaryTool;
  readonly label: string;
}

export const PRIMARY_TOOLS: readonly ToolInfo[] = [
  { id: 'window-level', label: 'Window / level' },
  { id: 'pan', label: 'Pan' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'stack-scroll', label: 'Scroll' },
];

export const DEFAULT_PRIMARY_TOOL: PrimaryTool = 'window-level';

export function isPrimaryTool(value: unknown): value is PrimaryTool {
  return PRIMARY_TOOLS.some((tool) => tool.id === value);
}
