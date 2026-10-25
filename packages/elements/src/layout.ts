import {
  type LayoutCells as CoreLayoutCells,
  layoutCells as coreLayoutCells,
} from '@01x/dicom-viewer-core';
import type { ViewerStateV1 } from '@01x/dicom-viewer-core';

export interface LayoutCells extends CoreLayoutCells {
  /** The viewports the layout shows, in reading order. */
  readonly ids: readonly string[];
}

/** Which viewports a layout shows, and how they are laid out. */
export function layoutCells(layout: ViewerStateV1['layout']): LayoutCells {
  const grid = coreLayoutCells(layout);
  return { ...grid, ids: grid.cells.map((cell) => cell.id) };
}
