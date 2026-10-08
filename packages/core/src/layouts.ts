/** The layouts of the viewport grid, in the order a toolbar lists them. `1x2` is one row of two. */
export const LAYOUTS = ['1x1', '1x2', '2x2', '1+3'] as const;

export type LayoutId = (typeof LAYOUTS)[number];

/** One viewport's place in the grid: 1-based lines, as CSS grid counts them. */
export interface LayoutCell {
  readonly id: string;
  readonly column: number;
  readonly row: number;
  readonly columnSpan: number;
  readonly rowSpan: number;
}

export interface LayoutCells {
  readonly columns: number;
  readonly rows: number;
  /** In reading order, so `cells[n].id` is `vp-n`. */
  readonly cells: readonly LayoutCell[];
}

function cell(index: number, column: number, row: number, columnSpan = 1, rowSpan = 1): LayoutCell {
  return { id: `vp-${index.toString()}`, column, row, columnSpan, rowSpan };
}

const CELLS: Readonly<Record<LayoutId, LayoutCells>> = {
  '1x1': { columns: 1, rows: 1, cells: [cell(0, 1, 1)] },
  '1x2': { columns: 2, rows: 1, cells: [cell(0, 1, 1), cell(1, 2, 1)] },
  '2x2': {
    columns: 2,
    rows: 2,
    cells: [cell(0, 1, 1), cell(1, 2, 1), cell(2, 1, 2), cell(3, 2, 2)],
  },
  '1+3': {
    columns: 2,
    rows: 3,
    cells: [cell(0, 1, 1, 1, 3), cell(1, 2, 1), cell(2, 2, 2), cell(3, 2, 3)],
  },
};

export function isLayout(value: unknown): value is LayoutId {
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value);
}

/** The grid a layout draws: how many columns and rows, and where each viewport goes. */
export function layoutCells(layout: LayoutId): LayoutCells {
  return CELLS[layout];
}

/** The viewport ids a layout shows. They are stable: `vp-0` is in every layout. */
export function layoutViewportIds(layout: LayoutId): readonly string[] {
  return CELLS[layout].cells.map((entry) => entry.id);
}

/** Throws a `RangeError` for anything that is not a layout, with the ones that are. */
export function assertLayout(value: unknown): asserts value is LayoutId {
  if (!isLayout(value)) {
    throw new RangeError(
      `There is no layout ${String(value)}. The layouts are ${LAYOUTS.join(', ')}.`,
    );
  }
}
