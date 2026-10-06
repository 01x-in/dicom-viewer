import type { SeriesStack } from '../data/types';
import { type ImagePlane, pixelToWorld, planeOf } from '../measurements/geometry';
import type { Point3 } from '../measurements/model';
import type { SegmentIndexEntry } from './segment-index';

/** Where to take a person who asks to see a segment. */
export type JumpStrategy = 'largestSlice' | 'centroid' | 'nearestTo';

export const JUMP_STRATEGIES: readonly JumpStrategy[] = ['largestSlice', 'centroid', 'nearestTo'];

/** The image with the most pixels of the segment. The first of them, when several tie. */
export function largestImage(entry: SegmentIndexEntry): number {
  let best = entry.imageIndices[0] ?? 0;
  let most = -1;
  entry.imageIndices.forEach((imageIndex, at) => {
    const count = entry.imageVoxelCounts[at] ?? 0;
    if (count > most) {
      most = count;
      best = imageIndex;
    }
  });
  return best;
}

/** Of the images the segment is on, the one nearest `target`. The lower one, when two are as near. */
export function nearestImage(entry: SegmentIndexEntry, target: number): number {
  let best = entry.imageIndices[0] ?? 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const imageIndex of entry.imageIndices) {
    const distance = Math.abs(imageIndex - target);
    if (distance < nearest) {
      nearest = distance;
      best = imageIndex;
    }
  }
  return best;
}

/** Where the middle of the segment is among the images, as a fractional position in the stack: row, column, and image. */
export function centroidInVoxels(entry: SegmentIndexEntry): {
  readonly row: number;
  readonly column: number;
  readonly imageIndex: number;
} {
  return {
    row: entry.sumRow / entry.voxelCount,
    column: entry.sumColumn / entry.voxelCount,
    imageIndex: entry.sumImageIndex / entry.voxelCount,
  };
}

/** The image of the segment that a jump shows. `current` is the image on screen, for `nearestTo`. */
export function imageToShow(
  entry: SegmentIndexEntry,
  strategy: JumpStrategy,
  current: number | undefined,
): number {
  switch (strategy) {
    case 'largestSlice':
      return largestImage(entry);
    case 'centroid':
      return nearestImage(entry, centroidInVoxels(entry).imageIndex);
    case 'nearestTo':
      return nearestImage(entry, current ?? centroidInVoxels(entry).imageIndex);
  }
}

function planeAt(stack: SeriesStack, imageIndex: number): ImagePlane | undefined {
  const instance = stack.instances[imageIndex];
  return instance === undefined ? undefined : planeOf(instance.metadata);
}

/**
 * The middle of the segment in patient millimetres. Between two images the plane is the blend of
 * theirs. `undefined` when the images do not say where they are.
 */
export function centroidMm(entry: SegmentIndexEntry, stack: SeriesStack): Point3 | undefined {
  if (entry.voxelCount === 0) return undefined;
  const { row, column } = centroidInVoxels(entry);
  // The mean of where each image's pixels are, weighted by how many the segment has on it: a mean
  // of image numbers would be wrong between images that are not evenly spaced.
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [at, imageIndex] of entry.imageIndices.entries()) {
    const plane = planeAt(stack, imageIndex);
    if (plane === undefined) return undefined;
    const weight = entry.imageVoxelCounts[at] ?? 0;
    const point = pixelToWorld(plane, { row, column });
    x += point[0] * weight;
    y += point[1] * weight;
    z += point[2] * weight;
  }
  return [x / entry.voxelCount, y / entry.voxelCount, z / entry.voxelCount];
}
