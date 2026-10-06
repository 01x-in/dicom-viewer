import { describe, expect, it } from 'vitest';
import type { DicomJsonInstance, SeriesInstance, SeriesStack } from '../data/types';
import { centroidInVoxels, centroidMm, imageToShow, largestImage, nearestImage } from './locate';
import { buildSegmentIndex, type SegmentIndexEntry } from './segment-index';

/** A segment with these voxel counts on these images. */
function entry(counts: Readonly<Record<number, number>>): SegmentIndexEntry {
  const imageIndices = Object.keys(counts).map(Number);
  const imageVoxelCounts = imageIndices.map((imageIndex) => counts[imageIndex] ?? 0);
  const voxelCount = imageVoxelCounts.reduce((sum, count) => sum + count, 0);
  return {
    number: 1,
    layer: 0,
    voxelCount,
    imageIndices,
    imageVoxelCounts,
    sumRow: voxelCount * 2,
    sumColumn: voxelCount * 3,
    sumImageIndex: imageIndices.reduce(
      (sum, imageIndex) => sum + imageIndex * (counts[imageIndex] ?? 0),
      0,
    ),
  };
}

describe('largestImage', () => {
  it('is the image with the most pixels', () => {
    expect(largestImage(entry({ 4: 10, 5: 30, 6: 20 }))).toBe(5);
  });

  it('is the first of the images that tie', () => {
    expect(largestImage(entry({ 4: 30, 5: 30 }))).toBe(4);
  });
});

describe('nearestImage', () => {
  it('is the image of the segment nearest the target, on either side', () => {
    const segment = entry({ 10: 1, 20: 1, 40: 1 });
    expect(nearestImage(segment, 0)).toBe(10);
    expect(nearestImage(segment, 16)).toBe(20);
    expect(nearestImage(segment, 29)).toBe(20);
    expect(nearestImage(segment, 31)).toBe(40);
    expect(nearestImage(segment, 99)).toBe(40);
  });

  it('is the lower image when two are as near', () => {
    expect(nearestImage(entry({ 10: 1, 20: 1 }), 15)).toBe(10);
  });

  it('is the target itself when the segment is on it', () => {
    expect(nearestImage(entry({ 10: 1, 20: 1 }), 20)).toBe(20);
  });
});

describe('imageToShow', () => {
  // A long segment with its middle off the images it is on: two lumps, 10 and 30, centre at 20.
  const lumps = entry({ 10: 5, 11: 5, 29: 5, 30: 5 });

  it('picks the largest image for largestSlice', () => {
    expect(imageToShow(entry({ 3: 1, 4: 9 }), 'largestSlice', 99)).toBe(4);
  });

  it('picks the image of the segment nearest its centre for centroid, even when the centre is in a gap', () => {
    expect(centroidInVoxels(lumps).imageIndex).toBeCloseTo(20);
    expect(imageToShow(lumps, 'centroid', 0)).toBe(11);
  });

  it('picks the image of the segment nearest the one on screen for nearestTo', () => {
    expect(imageToShow(lumps, 'nearestTo', 0)).toBe(10);
    expect(imageToShow(lumps, 'nearestTo', 28)).toBe(29);
    expect(imageToShow(lumps, 'nearestTo', 100)).toBe(30);
  });

  it('falls back to the centre for nearestTo when nothing is on screen', () => {
    expect(imageToShow(lumps, 'nearestTo', undefined)).toBe(11);
  });
});

describe('centroidMm', () => {
  function stack(count: number): SeriesStack {
    const instances: SeriesInstance[] = Array.from({ length: count }, (_, index) => {
      const metadata: DicomJsonInstance = {
        '00200032': { vr: 'DS', Value: [-10, -20, index * 2.5] },
        '00200037': { vr: 'DS', Value: [1, 0, 0, 0, 1, 0] },
        '00280010': { vr: 'US', Value: [8] },
        '00280011': { vr: 'US', Value: [8] },
        '00280030': { vr: 'DS', Value: [2, 3] },
      };
      return {
        sopInstanceUID: `1.${index.toString()}`,
        instanceNumber: index + 1,
        imageId: `i:${index.toString()}`,
        metadata,
      };
    });
    return {
      index: 0,
      instances,
      imageIds: instances.map((instance) => instance.imageId),
      reconstructable: { ok: true, spacingMm: 2.5 },
    };
  }

  it('turns a centre in voxels into patient millimetres', () => {
    // One voxel at row 1, column 2, on image 2.
    const only = buildSegmentIndex({
      rows: 4,
      columns: 4,
      layers: [
        [undefined, undefined, Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      ],
    }).segments[0];
    if (only === undefined) throw new Error('the labelmap has no segment');
    // PixelSpacing is [between rows, between columns] = [2, 3]: column 2 is 6 mm along, row 1 is
    // 2 mm down, from the corner at (-10, -20) on a plane at 5 mm.
    expect(centroidMm(only, stack(3))).toEqual([-4, -18, 5]);
  });

  it('blends the planes of the two images it falls between', () => {
    const between: SegmentIndexEntry = { ...entry({ 0: 1, 1: 1 }), sumRow: 0, sumColumn: 0 };
    const point = centroidMm(between, stack(3));
    expect(point?.[2]).toBeCloseTo(1.25);
  });

  it('takes the middle from where the images are, not from their numbers', () => {
    // Images 0, 1, 2, and 3 are at 0, 1, 2, and 10 mm. A segment with the same pixels on images 0
    // and 3 is at 5 mm, not on the planes of the images between them.
    const uneven: SeriesStack = {
      ...stack(4),
      instances: stack(4).instances.map((instance, at) => ({
        ...instance,
        metadata: {
          ...instance.metadata,
          '00200032': { vr: 'DS', Value: [-10, -20, [0, 1, 2, 10][at] ?? 0] },
        },
      })),
    };
    const ends: SegmentIndexEntry = { ...entry({ 0: 4, 3: 4 }), sumRow: 0, sumColumn: 0 };
    expect(centroidMm(ends, uneven)?.[2]).toBeCloseTo(5);
    const weighted: SegmentIndexEntry = { ...entry({ 0: 3, 3: 1 }), sumRow: 0, sumColumn: 0 };
    expect(centroidMm(weighted, uneven)?.[2]).toBeCloseTo(2.5);
  });

  it('is undefined when the images do not say where they are, or the segment is empty', () => {
    const bare: SeriesStack = {
      ...stack(2),
      instances: stack(2).instances.map((instance) => ({ ...instance, metadata: {} })),
    };
    expect(centroidMm(entry({ 0: 1 }), bare)).toBeUndefined();
    expect(centroidMm({ ...entry({}), voxelCount: 0 }, stack(2))).toBeUndefined();
  });
});
