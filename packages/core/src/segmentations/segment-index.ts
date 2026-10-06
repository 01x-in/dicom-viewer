// Runs in the compute worker (see workers/compute.worker.ts), and in tests. Imports nothing, so the
// worker bundle takes only this file.

/** A segment number in a labelmap. SEG allows up to 65535 segments. */
const MAX_SEGMENT_NUMBER = 65535;

export interface SegmentIndexInput {
  readonly rows: number;
  readonly columns: number;
  /**
   * `layers[layer][imageIndex]` holds the segment number of each pixel of one image, row by row, 0
   * for none. `undefined` means nothing is on that image. A SEG whose segments overlap has one layer
   * for each set of segments that do not.
   */
  readonly layers: readonly (readonly (ArrayLike<number> | undefined)[])[];
}

/** Everything the viewer knows about where one segment is. */
export interface SegmentIndexEntry {
  readonly number: number;
  /** The layer the segment was first seen on. */
  readonly layer: number;
  readonly voxelCount: number;
  /** The images the segment is on, in ascending order, and how many voxels it has on each. */
  readonly imageIndices: readonly number[];
  readonly imageVoxelCounts: readonly number[];
  /** Sums of the voxels' coordinates. Divide by `voxelCount` for the centre, in voxels. */
  readonly sumRow: number;
  readonly sumColumn: number;
  readonly sumImageIndex: number;
}

/** Two segments that have voxels in common. They are on different layers. */
export interface SegmentOverlap {
  readonly a: number;
  readonly b: number;
  readonly voxelCount: number;
}

export interface SegmentIndexResult {
  /** In order of segment number. */
  readonly segments: readonly SegmentIndexEntry[];
  /** In order of `a`, then `b`, with `a` below `b`. */
  readonly overlaps: readonly SegmentOverlap[];
}

interface Accumulator {
  layer: number;
  voxelCount: number;
  imageIndices: number[];
  imageVoxelCounts: number[];
  sumRow: number;
  sumColumn: number;
  sumImageIndex: number;
}

/** The segments of a labelmap, where each one is, and which ones share voxels. */
export function buildSegmentIndex(input: SegmentIndexInput): SegmentIndexResult {
  const { rows, columns, layers } = input;
  const pixels = rows * columns;
  const accumulators = new Map<number, Accumulator>();
  const overlapCounts = new Map<number, number>();
  // Reused for every image: only the entries an image touched are cleared again.
  const onImage = new Uint32Array(MAX_SEGMENT_NUMBER + 1);
  const sumRowOnImage = new Float64Array(MAX_SEGMENT_NUMBER + 1);
  const sumColumnOnImage = new Float64Array(MAX_SEGMENT_NUMBER + 1);
  const touched: number[] = [];
  const imageCount = layers.reduce((most, layer) => Math.max(most, layer.length), 0);

  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    const frames: (ArrayLike<number> | undefined)[] = [];
    layers.forEach((layer, layerIndex) => {
      const frame = layer[imageIndex];
      if (frame === undefined) return;
      if (frame.length !== pixels) {
        throw new RangeError(
          `Layer ${layerIndex.toString()} image ${imageIndex.toString()} has ${frame.length.toString()} pixels, not ${rows.toString()} by ${columns.toString()}.`,
        );
      }
      frames[layerIndex] = frame;
    });

    frames.forEach((frame, layerIndex) => {
      if (frame === undefined) return;
      for (let row = 0; row < rows; row += 1) {
        const start = row * columns;
        for (let column = 0; column < columns; column += 1) {
          const value = frame[start + column] ?? 0;
          if (value === 0) continue;
          if (!Number.isInteger(value) || value < 0 || value > MAX_SEGMENT_NUMBER) {
            throw new RangeError(`${value.toString()} is not a segment number.`);
          }
          if (onImage[value] === 0) {
            touched.push(value);
            if (!accumulators.has(value)) {
              accumulators.set(value, {
                layer: layerIndex,
                voxelCount: 0,
                imageIndices: [],
                imageVoxelCounts: [],
                sumRow: 0,
                sumColumn: 0,
                sumImageIndex: 0,
              });
            }
          }
          onImage[value] = (onImage[value] ?? 0) + 1;
          sumRowOnImage[value] = (sumRowOnImage[value] ?? 0) + row;
          sumColumnOnImage[value] = (sumColumnOnImage[value] ?? 0) + column;
        }
      }
    });

    for (const value of touched) {
      const count = onImage[value] ?? 0;
      const accumulator = accumulators.get(value);
      if (accumulator !== undefined) {
        accumulator.voxelCount += count;
        accumulator.imageIndices.push(imageIndex);
        accumulator.imageVoxelCounts.push(count);
        accumulator.sumRow += sumRowOnImage[value] ?? 0;
        accumulator.sumColumn += sumColumnOnImage[value] ?? 0;
        accumulator.sumImageIndex += imageIndex * count;
      }
      onImage[value] = 0;
      sumRowOnImage[value] = 0;
      sumColumnOnImage[value] = 0;
    }
    touched.length = 0;

    if (frames.length > 1) countOverlaps(frames, pixels, overlapCounts);
  }

  const segments = [...accumulators.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, accumulator]) => ({ number, ...accumulator }));
  const overlaps = [...overlapCounts.entries()]
    .map(([key, voxelCount]) => ({
      a: Math.floor(key / (MAX_SEGMENT_NUMBER + 1)),
      b: key % (MAX_SEGMENT_NUMBER + 1),
      voxelCount,
    }))
    .sort((x, y) => x.a - y.a || x.b - y.b);
  return { segments, overlaps };
}

/** Adds, for one image, the voxels where two layers both have a segment. */
function countOverlaps(
  frames: readonly (ArrayLike<number> | undefined)[],
  pixels: number,
  counts: Map<number, number>,
): void {
  const present = frames.flatMap((frame) => (frame === undefined ? [] : [frame]));
  if (present.length < 2) return;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    let found = 0;
    const values: number[] = [];
    for (const frame of present) {
      const value = frame[pixel] ?? 0;
      if (value !== 0) {
        found += 1;
        values.push(value);
      }
    }
    if (found < 2) continue;
    for (let first = 0; first < values.length; first += 1) {
      for (let second = first + 1; second < values.length; second += 1) {
        const x = values[first] ?? 0;
        const y = values[second] ?? 0;
        if (x === y) continue;
        const key = Math.min(x, y) * (MAX_SEGMENT_NUMBER + 1) + Math.max(x, y);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
}
