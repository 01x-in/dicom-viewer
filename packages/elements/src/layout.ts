import {
  type LayoutCells as CoreLayoutCells,
  layoutCells as coreLayoutCells,
} from '@scope/viewer-core';
import type { ViewerStateV1 } from '@scope/viewer-core';

export interface LayoutCells extends CoreLayoutCells {
  /** The viewports the layout shows, in reading order. */
  readonly ids: readonly string[];
}

/** Which viewports a layout shows, and how they are laid out. */
export function layoutCells(layout: ViewerStateV1['layout']): LayoutCells {
  const grid = coreLayoutCells(layout);
  return { ...grid, ids: grid.cells.map((cell) => cell.id) };
}
