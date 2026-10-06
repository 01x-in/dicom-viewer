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
  const { row, column, imageIndex } = centroidInVoxels(entry);
  const below = Math.floor(imageIndex);
  const above = Math.min(Math.ceil(imageIndex), stack.instances.length - 1);
  const lower = planeAt(stack, below);
  const upper = planeAt(stack, above);
  if (lower === undefined || upper === undefined) return undefined;
  const a = pixelToWorld(lower, { row, column });
  const b = pixelToWorld(upper, { row, column });
  const share = above === below ? 0 : imageIndex - below;
  return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share];
}
