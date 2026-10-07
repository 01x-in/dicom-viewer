import type { MeasurementType } from './measurements/model';

/** The tools the left mouse button can drive. Middle is always pan, right zoom, and the wheel scrolls. */
export type PrimaryTool =
  | 'window-level'
  | 'pan'
  | 'zoom'
  | 'stack-scroll'
  /** Click in one plane of a volume and the other planes go to that point. Needs two planes of one volume. */
  | 'crosshairs'
  // Each one draws a measurement. The ids are the types of `Measurement`.
  | MeasurementType;

export interface ToolInfo {
  readonly id: PrimaryTool;
  readonly label: string;
  /** `view` tools change what the picture looks like. `measure` tools draw a measurement on it. */
  readonly kind: 'view' | 'measure';
}

export const PRIMARY_TOOLS: readonly ToolInfo[] = [
  { id: 'window-level', label: 'Window / level', kind: 'view' },
  { id: 'pan', label: 'Pan', kind: 'view' },
  { id: 'zoom', label: 'Zoom', kind: 'view' },
  { id: 'stack-scroll', label: 'Scroll', kind: 'view' },
  { id: 'crosshairs', label: 'Crosshairs', kind: 'view' },
  { id: 'length', label: 'Length', kind: 'measure' },
  { id: 'bidirectional', label: 'Bidirectional', kind: 'measure' },
  { id: 'ellipse', label: 'Ellipse', kind: 'measure' },
  { id: 'rectangle', label: 'Rectangle', kind: 'measure' },
  { id: 'probe', label: 'Probe', kind: 'measure' },
  { id: 'angle', label: 'Angle', kind: 'measure' },
];

export const DEFAULT_PRIMARY_TOOL: PrimaryTool = 'window-level';

export function isPrimaryTool(value: unknown): value is PrimaryTool {
  return PRIMARY_TOOLS.some((tool) => tool.id === value);
}

export function isMeasureTool(value: PrimaryTool): value is MeasurementType {
  return PRIMARY_TOOLS.some((tool) => tool.id === value && tool.kind === 'measure');
}
