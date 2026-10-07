import { describe, expect, it } from 'vitest';
import { isLayout, LAYOUTS, layoutCells, layoutViewportIds } from './layouts';

describe('LAYOUTS', () => {
  it('has the four layouts, in the order a toolbar lists them', () => {
    expect(LAYOUTS).toEqual(['1x1', '1x2', '2x2', '1+3']);
  });

  it.each(LAYOUTS)('%s gives stable ids that start at vp-0', (layout) => {
    const ids = layoutViewportIds(layout);
    expect(ids[0]).toBe('vp-0');
    expect(ids).toEqual(ids.map((_, index) => `vp-${index.toString()}`));
  });

  it.each([
    ['1x1', 1],
    ['1x2', 2],
    ['2x2', 4],
    ['1+3', 4],
  ] as const)('%s shows %i viewports', (layout, count) => {
    expect(layoutViewportIds(layout)).toHaveLength(count);
  });
});

describe('layoutCells', () => {
  it('puts one viewport in a 1 by 1 grid', () => {
    expect(layoutCells('1x1')).toEqual({
      columns: 1,
      rows: 1,
      cells: [{ id: 'vp-0', column: 1, row: 1, columnSpan: 1, rowSpan: 1 }],
    });
  });

  it('puts two side by side for 1x2 (one row, two columns)', () => {
    const { columns, rows, cells } = layoutCells('1x2');
    expect([columns, rows]).toEqual([2, 1]);
    expect(cells.map((cell) => [cell.id, cell.column, cell.row])).toEqual([
      ['vp-0', 1, 1],
      ['vp-1', 2, 1],
    ]);
  });

  it('fills a 2x2 in reading order', () => {
    const { cells } = layoutCells('2x2');
    expect(cells.map((cell) => [cell.id, cell.column, cell.row])).toEqual([
      ['vp-0', 1, 1],
      ['vp-1', 2, 1],
      ['vp-2', 1, 2],
      ['vp-3', 2, 2],
    ]);
  });

  it('gives 1+3 a tall viewport on the left and three small ones in a column', () => {
    const { columns, rows, cells } = layoutCells('1+3');
    expect([columns, rows]).toEqual([2, 3]);
    expect(cells[0]).toEqual({ id: 'vp-0', column: 1, row: 1, columnSpan: 1, rowSpan: 3 });
    expect(cells.slice(1).map((cell) => [cell.id, cell.column, cell.row, cell.rowSpan])).toEqual([
      ['vp-1', 2, 1, 1],
      ['vp-2', 2, 2, 1],
      ['vp-3', 2, 3, 1],
    ]);
  });

  it.each(LAYOUTS)('%s covers every grid square exactly once', (layout) => {
    const { columns, rows, cells } = layoutCells(layout);
    const covered = new Map<string, number>();
    for (const cell of cells) {
      for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
        for (let column = cell.column; column < cell.column + cell.columnSpan; column += 1) {
          const key = `${column.toString()},${row.toString()}`;
          covered.set(key, (covered.get(key) ?? 0) + 1);
        }
      }
    }
    expect(covered.size).toBe(columns * rows);
    expect([...covered.values()].every((count) => count === 1)).toBe(true);
  });
});

describe('isLayout', () => {
  it('accepts the four and nothing else', () => {
    expect(LAYOUTS.every((layout) => isLayout(layout))).toBe(true);
    for (const other of ['3x3', '2x1', '', 1, undefined, null, {}]) {
      expect(isLayout(other)).toBe(false);
    }
  });
});
