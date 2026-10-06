import { describe, expect, it } from 'vitest';
import { buildSegmentIndex } from './segment-index';

/** A 3-row, 4-column image from rows of segment numbers. */
const image = (...rows: number[][]): Uint8Array => Uint8Array.from(rows.flat());

describe('buildSegmentIndex', () => {
  it('counts the voxels of each segment, on each image', () => {
    const result = buildSegmentIndex({
      rows: 3,
      columns: 4,
      layers: [
        [
          image([0, 1, 1, 0], [0, 2, 0, 0], [0, 0, 0, 0]),
          undefined,
          image([1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]),
        ],
      ],
    });
    expect(result.segments).toEqual([
      expect.objectContaining({
        number: 1,
        layer: 0,
        voxelCount: 3,
        imageIndices: [0, 2],
        imageVoxelCounts: [2, 1],
      }),
      expect.objectContaining({
        number: 2,
        layer: 0,
        voxelCount: 2,
        imageIndices: [0, 2],
        imageVoxelCounts: [1, 1],
      }),
    ]);
  });

  it('adds up the coordinates, so the centre is the sums over the count', () => {
    const [segment] = buildSegmentIndex({
      rows: 3,
      columns: 4,
      layers: [
        [
          image([0, 0, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]),
          image([0, 0, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]),
        ],
      ],
    }).segments;
    expect(segment).toMatchObject({ voxelCount: 4, sumRow: 4, sumColumn: 6, sumImageIndex: 2 });
  });

  it('lists segments in order of number, whatever order they appear in', () => {
    const result = buildSegmentIndex({
      rows: 1,
      columns: 4,
      layers: [[Uint8Array.from([7, 3, 5, 3])]],
    });
    expect(result.segments.map((segment) => segment.number)).toEqual([3, 5, 7]);
  });

  it('knows which layer a segment is on, and finds the pixels two layers share', () => {
    const result = buildSegmentIndex({
      rows: 1,
      columns: 4,
      layers: [[Uint8Array.from([1, 1, 0, 0])], [Uint8Array.from([0, 2, 2, 3])]],
    });
    expect(result.segments.map((segment) => [segment.number, segment.layer])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect(result.overlaps).toEqual([{ a: 1, b: 2, voxelCount: 1 }]);
  });

  it('reports each pair of overlapping segments once, lower number first and in order', () => {
    const result = buildSegmentIndex({
      rows: 1,
      columns: 3,
      layers: [
        [Uint8Array.from([2, 2, 0])],
        [Uint8Array.from([1, 1, 0])],
        [Uint8Array.from([0, 3, 3])],
      ],
    });
    expect(result.overlaps).toEqual([
      { a: 1, b: 2, voxelCount: 2 },
      { a: 1, b: 3, voxelCount: 1 },
      { a: 2, b: 3, voxelCount: 1 },
    ]);
  });

  it('has no overlaps when the segments are on one layer', () => {
    const result = buildSegmentIndex({
      rows: 1,
      columns: 3,
      layers: [[Uint8Array.from([1, 2, 3])]],
    });
    expect(result.overlaps).toEqual([]);
  });

  it('reads 16-bit labelmaps', () => {
    const result = buildSegmentIndex({
      rows: 1,
      columns: 3,
      layers: [[Uint16Array.from([300, 0, 300])]],
    });
    expect(result.segments).toEqual([expect.objectContaining({ number: 300, voxelCount: 2 })]);
  });

  it('is empty for a labelmap with nothing in it', () => {
    expect(
      buildSegmentIndex({ rows: 2, columns: 2, layers: [[new Uint8Array(4), undefined]] }),
    ).toEqual({
      segments: [],
      overlaps: [],
    });
    expect(buildSegmentIndex({ rows: 2, columns: 2, layers: [] })).toEqual({
      segments: [],
      overlaps: [],
    });
  });

  it('refuses an image that is not rows by columns, rather than reading the wrong pixels', () => {
    expect(() => buildSegmentIndex({ rows: 2, columns: 2, layers: [[new Uint8Array(3)]] })).toThrow(
      RangeError,
    );
  });

  it('refuses a number it cannot count', () => {
    expect(() =>
      buildSegmentIndex({ rows: 1, columns: 1, layers: [[Float32Array.from([1.5])]] }),
    ).toThrow(RangeError);
    expect(() =>
      buildSegmentIndex({ rows: 1, columns: 1, layers: [[Int16Array.from([-1])]] }),
    ).toThrow(RangeError);
  });
});
