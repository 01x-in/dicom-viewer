import type { ViewerStateV1 } from '@scope/viewer-core';

export interface LayoutCells {
  /** The viewports the layout shows, in reading order. */
  readonly ids: readonly string[];
  readonly columns: number;
  readonly rows: number;
}

// M7 adds the other layouts; a Record makes the compiler ask for each of them here.
const CELLS: Readonly<Record<ViewerStateV1['layout'], LayoutCells>> = {
  '1x1': { ids: ['vp-0'], columns: 1, rows: 1 },
};

/** Which viewports a layout shows, and how they are laid out. */
export function layoutCells(layout: ViewerStateV1['layout']): LayoutCells {
  return CELLS[layout];
}
