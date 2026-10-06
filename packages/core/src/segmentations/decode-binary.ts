// Runs in the compute worker (see workers/comlink-expose.ts), and in tests. Imports only the index,
// so the worker bundle takes only these two files.
import { buildSegmentIndex, type SegmentIndexResult } from './segment-index';

/** One frame of a binary SEG: the segment it holds, and the image of the stack it is on. */
export interface BinaryFrame {
  readonly segmentNumber: number;
  /** Position in the stack. Negative: the frame is on no image of the stack, and is skipped. */
  readonly imageIndex: number;
}

export interface DecodeBinaryInput {
  /** The bytes of the SEG's pixel data: one bit a pixel, frames back to back, the first bit of a byte lowest. */
  readonly pixelData: Uint8Array;
  readonly rows: number;
  readonly columns: number;
  /** Images in the stack. */
  readonly imageCount: number;
  /** In the order of the frames in the file. */
  readonly frames: readonly BinaryFrame[];
}

export interface DecodeBinaryResult {
  /**
   * One buffer for each layer: `imageCount` images of `rows` by `columns` segment numbers, 0 for
   * none. Segments that share pixels are on different layers. 8 bits a pixel, or 16 when a
   * segment number is above 255.
   */
  readonly layers: readonly (Uint8Array | Uint16Array)[];
  readonly index: SegmentIndexResult;
}

const MAX_SEGMENT_NUMBER = 65535;

/** Calls `visit` with the offset, from `startBit`, of each set bit in `bitCount` bits. Stops when `visit` returns true. */
function visitSetBits(
  data: Uint8Array,
  startBit: number,
  bitCount: number,
  visit: (offset: number) => boolean,
): boolean {
  const end = startBit + bitCount;
  let bit = startBit;
  while (bit < end) {
    if ((bit & 7) === 0 && end - bit >= 8) {
      const byte = data[bit >> 3] ?? 0;
      if (byte !== 0) {
        for (let shift = 0; shift < 8; shift += 1) {
          if ((byte & (1 << shift)) !== 0 && visit(bit - startBit + shift)) return true;
        }
      }
      bit += 8;
    } else {
      if (((data[bit >> 3] ?? 0) & (1 << (bit & 7))) !== 0 && visit(bit - startBit)) return true;
      bit += 1;
    }
  }
  return false;
}

/**
 * Turns the frames of a binary SEG into labelmaps, and finds where each segment is. A segment goes
 * on the first layer it does not overlap, so a SEG whose segments never overlap has one layer.
 */
export function decodeBinarySegmentation(input: DecodeBinaryInput): DecodeBinaryResult {
  const { pixelData, rows, columns, imageCount, frames } = input;
  const pixels = rows * columns;
  if (frames.length * pixels > pixelData.length * 8) {
    throw new RangeError(
      `The SEG has ${frames.length.toString()} frames of ${pixels.toString()} pixels, which is more than its ${pixelData.length.toString()} bytes of pixel data hold.`,
    );
  }

  // The frames of each segment, by segment, in the order the segments first appear.
  const framesOf = new Map<number, number[]>();
  let widest = 0;
  frames.forEach((frame, frameIndex) => {
    const { segmentNumber, imageIndex } = frame;
    if (
      !Number.isInteger(segmentNumber) ||
      segmentNumber < 1 ||
      segmentNumber > MAX_SEGMENT_NUMBER
    ) {
      throw new RangeError(`${segmentNumber.toString()} is not a segment number.`);
    }
    if (imageIndex >= imageCount || !Number.isInteger(imageIndex)) {
      throw new RangeError(
        `Frame ${frameIndex.toString()} is on image ${imageIndex.toString()} of a stack of ${imageCount.toString()}.`,
      );
    }
    if (imageIndex < 0) return;
    widest = Math.max(widest, segmentNumber);
    const list = framesOf.get(segmentNumber);
    if (list === undefined) framesOf.set(segmentNumber, [frameIndex]);
    else list.push(frameIndex);
  });

  const Storage = widest > 255 ? Uint16Array : Uint8Array;
  const layers: (Uint8Array | Uint16Array)[] = [];

  const clashes = (layer: Uint8Array | Uint16Array, frameIndexes: readonly number[]): boolean =>
    frameIndexes.some((frameIndex) => {
      const base = (frames[frameIndex]?.imageIndex ?? 0) * pixels;
      return visitSetBits(
        pixelData,
        frameIndex * pixels,
        pixels,
        (offset) => layer[base + offset] !== 0,
      );
    });

  for (const [segmentNumber, frameIndexes] of framesOf) {
    let layerIndex = 0;
    for (;;) {
      if (layerIndex === layers.length) layers.push(new Storage(imageCount * pixels));
      const layer = layers[layerIndex];
      if (layer !== undefined && !clashes(layer, frameIndexes)) break;
      layerIndex += 1;
    }
    const layer = layers[layerIndex];
    if (layer === undefined) continue;
    for (const frameIndex of frameIndexes) {
      const base = (frames[frameIndex]?.imageIndex ?? 0) * pixels;
      visitSetBits(pixelData, frameIndex * pixels, pixels, (offset) => {
        layer[base + offset] = segmentNumber;
        return false;
      });
    }
  }

  const index = buildSegmentIndex({
    rows,
    columns,
    layers: layers.map((layer) =>
      Array.from({ length: imageCount }, (_, imageIndex) =>
        layer.subarray(imageIndex * pixels, (imageIndex + 1) * pixels),
      ),
    ),
  });
  return { layers, index };
}
