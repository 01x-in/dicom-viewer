import { describe, expect, it } from 'vitest';
import { decodeBinarySegmentation } from './decode-binary';

/** Packs bits the way DICOM does: the first bit of each byte is the lowest. */
function pack(bits: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, position) => {
    if (bit !== 0) bytes[position >> 3] = (bytes[position >> 3] ?? 0) | (1 << (position & 7));
  });
  return bytes;
}

/** The pixels of image `imageIndex` in a decoded layer. */
const imageOf = (
  layer: ArrayLike<number> | undefined,
  imageIndex: number,
  pixels: number,
): number[] => Array.from({ length: pixels }, (_, at) => layer?.[imageIndex * pixels + at] ?? -1);

describe('decodeBinarySegmentation', () => {
  it('puts the segment number on each pixel whose bit is set, first bit first', () => {
    // 2 rows of 4 columns: pixels 0, 2, and 7.
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 0, 1, 0, 0, 0, 0, 1]),
      rows: 2,
      columns: 4,
      imageCount: 2,
      frames: [{ segmentNumber: 3, imageIndex: 1 }],
    });
    expect(result.layers).toHaveLength(1);
    expect(imageOf(result.layers[0], 0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageOf(result.layers[0], 1, 8)).toEqual([3, 0, 3, 0, 0, 0, 0, 3]);
  });

  it('reads frames that do not start on a byte, as the standard packs them back to back', () => {
    // 1 row of 5 columns: frame 0 is bits 0 to 4, frame 1 is bits 5 to 9, frame 2 is bits 10 to 14.
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 0, 0, 0, 1, /**/ 0, 1, 1, 0, 0, /**/ 1, 1, 1, 1, 1]),
      rows: 1,
      columns: 5,
      imageCount: 3,
      frames: [
        { segmentNumber: 1, imageIndex: 0 },
        { segmentNumber: 2, imageIndex: 1 },
        { segmentNumber: 1, imageIndex: 2 },
      ],
    });
    expect(imageOf(result.layers[0], 0, 5)).toEqual([1, 0, 0, 0, 1]);
    expect(imageOf(result.layers[0], 1, 5)).toEqual([0, 2, 2, 0, 0]);
    expect(imageOf(result.layers[0], 2, 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it('reads a long frame, skipping the bytes that are empty', () => {
    const bits = new Array<number>(64 * 3).fill(0);
    bits[3] = 1;
    bits[64 + 63] = 1;
    bits[128 + 8] = 1;
    const result = decodeBinarySegmentation({
      pixelData: pack(bits),
      rows: 8,
      columns: 8,
      imageCount: 3,
      frames: [
        { segmentNumber: 7, imageIndex: 0 },
        { segmentNumber: 7, imageIndex: 1 },
        { segmentNumber: 7, imageIndex: 2 },
      ],
    });
    const set = (imageIndex: number): number[] =>
      imageOf(result.layers[0], imageIndex, 64).flatMap((value, at) => (value === 7 ? [at] : []));
    expect([set(0), set(1), set(2)]).toEqual([[3], [63], [8]]);
  });

  it('keeps segments that do not overlap on one layer, whichever images they are on', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 1, 0, 0, /**/ 0, 0, 1, 1, /**/ 0, 1, 0, 0]),
      rows: 1,
      columns: 4,
      imageCount: 2,
      frames: [
        { segmentNumber: 1, imageIndex: 0 },
        { segmentNumber: 2, imageIndex: 0 },
        { segmentNumber: 3, imageIndex: 1 },
      ],
    });
    expect(result.layers).toHaveLength(1);
    expect(imageOf(result.layers[0], 0, 4)).toEqual([1, 1, 2, 2]);
    expect(imageOf(result.layers[0], 1, 4)).toEqual([0, 3, 0, 0]);
    expect(result.index.overlaps).toEqual([]);
  });

  it('puts a segment that overlaps an earlier one on a layer of its own', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 1, 1, 0, /**/ 0, 1, 1, 1]),
      rows: 1,
      columns: 4,
      imageCount: 1,
      frames: [
        { segmentNumber: 1, imageIndex: 0 },
        { segmentNumber: 2, imageIndex: 0 },
      ],
    });
    expect(result.layers).toHaveLength(2);
    expect(imageOf(result.layers[0], 0, 4)).toEqual([1, 1, 1, 0]);
    expect(imageOf(result.layers[1], 0, 4)).toEqual([0, 2, 2, 2]);
    expect(result.index.overlaps).toEqual([{ a: 1, b: 2, voxelCount: 2 }]);
    expect(result.index.segments.map((segment) => [segment.number, segment.layer])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it('moves a whole segment to another layer when it overlaps on any one of its images', () => {
    const result = decodeBinarySegmentation({
      // Segment 1 is on image 0 only. Segment 2 is clear of it on image 0 and meets it on image 1.
      pixelData: pack([1, 1, 0, 0, /**/ 0, 0, 1, 1, /**/ 0, 1, 0, 0]),
      rows: 1,
      columns: 4,
      imageCount: 2,
      frames: [
        { segmentNumber: 1, imageIndex: 0 },
        { segmentNumber: 2, imageIndex: 0 },
        { segmentNumber: 2, imageIndex: 1 },
      ],
    });
    // Image 1 is empty on layer 0, so segment 2 fits there: this is the case with no conflict.
    expect(result.layers).toHaveLength(1);
    const clash = decodeBinarySegmentation({
      pixelData: pack([1, 1, 0, 0, /**/ 0, 0, 1, 1, /**/ 0, 0, 1, 0, /**/ 0, 1, 1, 0]),
      rows: 1,
      columns: 4,
      imageCount: 2,
      frames: [
        { segmentNumber: 1, imageIndex: 0 },
        { segmentNumber: 3, imageIndex: 1 },
        { segmentNumber: 2, imageIndex: 0 },
        { segmentNumber: 2, imageIndex: 1 },
      ],
    });
    // Segment 2 is clear of segment 1 on image 0 and meets segment 3 on image 1, so all of it moves.
    expect(clash.layers).toHaveLength(2);
    expect(imageOf(clash.layers[0], 0, 4)).toEqual([1, 1, 0, 0]);
    expect(imageOf(clash.layers[0], 1, 4)).toEqual([0, 0, 3, 3]);
    expect(imageOf(clash.layers[1], 0, 4)).toEqual([0, 0, 2, 0]);
    expect(imageOf(clash.layers[1], 1, 4)).toEqual([0, 2, 2, 0]);
  });

  it('joins frames of one segment on one image', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 0, 0, 0, /**/ 0, 0, 0, 1]),
      rows: 1,
      columns: 4,
      imageCount: 1,
      frames: [
        { segmentNumber: 5, imageIndex: 0 },
        { segmentNumber: 5, imageIndex: 0 },
      ],
    });
    expect(result.layers).toHaveLength(1);
    expect(imageOf(result.layers[0], 0, 4)).toEqual([5, 0, 0, 5]);
  });

  it('skips a frame that is on no image of the stack, and still reads the next one', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 1, /**/ 0, 1]),
      rows: 1,
      columns: 2,
      imageCount: 1,
      frames: [
        { segmentNumber: 1, imageIndex: -1 },
        { segmentNumber: 2, imageIndex: 0 },
      ],
    });
    expect(imageOf(result.layers[0], 0, 2)).toEqual([0, 2]);
    expect(result.index.segments.map((segment) => segment.number)).toEqual([2]);
  });

  it('holds segment numbers above 255 in 16 bits', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 0]),
      rows: 1,
      columns: 2,
      imageCount: 1,
      frames: [{ segmentNumber: 300, imageIndex: 0 }],
    });
    expect(result.layers[0]).toBeInstanceOf(Uint16Array);
    expect(imageOf(result.layers[0], 0, 2)).toEqual([300, 0]);
  });

  it('holds small segment numbers in 8 bits', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 0]),
      rows: 1,
      columns: 2,
      imageCount: 1,
      frames: [{ segmentNumber: 255, imageIndex: 0 }],
    });
    expect(result.layers[0]).toBeInstanceOf(Uint8Array);
  });

  it('has the index of what it made, worked out from the same pixels', () => {
    const result = decodeBinarySegmentation({
      pixelData: pack([1, 1, 0, 0, /**/ 0, 1, 0, 0]),
      rows: 1,
      columns: 4,
      imageCount: 3,
      frames: [
        { segmentNumber: 4, imageIndex: 2 },
        { segmentNumber: 4, imageIndex: 0 },
      ],
    });
    expect(result.index.segments).toEqual([
      expect.objectContaining({
        number: 4,
        voxelCount: 3,
        imageIndices: [0, 2],
        imageVoxelCounts: [1, 2],
        sumImageIndex: 4,
      }),
    ]);
  });

  it('is empty when there are no frames', () => {
    const result = decodeBinarySegmentation({
      pixelData: new Uint8Array(0),
      rows: 1,
      columns: 2,
      imageCount: 2,
      frames: [],
    });
    expect(result.layers).toEqual([]);
    expect(result.index).toEqual({ segments: [], overlaps: [] });
  });

  it('refuses pixel data that is too short for its frames, rather than reading past it', () => {
    expect(() =>
      decodeBinarySegmentation({
        pixelData: new Uint8Array(1),
        rows: 4,
        columns: 4,
        imageCount: 1,
        frames: [
          { segmentNumber: 1, imageIndex: 0 },
          { segmentNumber: 1, imageIndex: 0 },
        ],
      }),
    ).toThrow(RangeError);
  });

  it.each([
    ['an image past the end', { segmentNumber: 1, imageIndex: 1 }],
    ['a segment number of zero', { segmentNumber: 0, imageIndex: 0 }],
    ['a segment number past 65535', { segmentNumber: 65536, imageIndex: 0 }],
    ['a fraction for a segment number', { segmentNumber: 1.5, imageIndex: 0 }],
  ])('refuses a frame with %s', (_name, frame) => {
    expect(() =>
      decodeBinarySegmentation({
        pixelData: new Uint8Array(1),
        rows: 1,
        columns: 2,
        imageCount: 1,
        frames: [frame],
      }),
    ).toThrow(RangeError);
  });
});
