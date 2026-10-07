import { describe, expect, it } from 'vitest';
import type { DicomJsonInstance, SeriesStack } from './data/types';
import {
  decideMpr,
  defaultMaxCacheBytes,
  describeFallback,
  estimateVolumeBytes,
  isMprOrientation,
  resolveMaxCacheBytes,
  MPR_ORIENTATIONS,
  type MprFallbackReason,
} from './mpr';

const MIB = 1024 * 1024;

function instance(
  index: number,
  rows: number | undefined,
  columns: number | undefined,
): SeriesStack['instances'][number] {
  const metadata: DicomJsonInstance = {
    ...(rows === undefined ? {} : { '00280010': { vr: 'US', Value: [rows] } }),
    ...(columns === undefined ? {} : { '00280011': { vr: 'US', Value: [columns] } }),
  };
  return {
    sopInstanceUID: `1.2.${index.toString()}`,
    instanceNumber: index,
    imageId: `wadors:x/${index.toString()}`,
    metadata,
  };
}

function stack(
  slices: number,
  reconstructable: SeriesStack['reconstructable'] = { ok: true, spacingMm: 2.5 },
  size: { rows?: number; columns?: number } = { rows: 512, columns: 512 },
): SeriesStack {
  const instances = Array.from({ length: slices }, (_, index) =>
    instance(index, size.rows, size.columns),
  );
  return { index: 0, instances, imageIds: instances.map((item) => item.imageId), reconstructable };
}

describe('MPR_ORIENTATIONS', () => {
  it('are the three planes', () => {
    expect(MPR_ORIENTATIONS).toEqual(['axial', 'sagittal', 'coronal']);
    expect(isMprOrientation('coronal')).toBe(true);
    expect(isMprOrientation('oblique')).toBe(false);
    expect(isMprOrientation(undefined)).toBe(false);
  });
});

describe('estimateVolumeBytes', () => {
  it('counts four bytes a voxel, since a scaled CT volume is held as floats', () => {
    expect(estimateVolumeBytes(stack(300))).toBe(512 * 512 * 300 * 4);
    expect(estimateVolumeBytes(stack(64, undefined, { rows: 128, columns: 128 }))).toBe(
      128 * 128 * 64 * 4,
    );
  });

  it('is infinite when the image size is not known, so it can never pass a budget by accident', () => {
    expect(estimateVolumeBytes(stack(10, undefined, {}))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('defaultMaxCacheBytes', () => {
  it('is 1 GiB, or 512 MiB on a device that says it has 4 GiB or less', () => {
    expect(defaultMaxCacheBytes(undefined)).toBe(1024 * MIB);
    expect(defaultMaxCacheBytes(8)).toBe(1024 * MIB);
    expect(defaultMaxCacheBytes(4)).toBe(512 * MIB);
    expect(defaultMaxCacheBytes(2)).toBe(512 * MIB);
  });
});

describe('resolveMaxCacheBytes', () => {
  it('is what the host asked for, or the default', () => {
    expect(resolveMaxCacheBytes(123_456)).toBe(123_456);
    expect([512 * MIB, 1024 * MIB]).toContain(resolveMaxCacheBytes(undefined));
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (bad) => {
    expect(() => resolveMaxCacheBytes(bad)).toThrow(RangeError);
  });
});

describe('decideMpr', () => {
  const room = { maxBytes: 1024 * MIB, inUseBytes: 0 };

  it('accepts a stack that can be reconstructed and fits', () => {
    expect(decideMpr(stack(300), room)).toEqual({ ok: true, bytes: 512 * 512 * 300 * 4 });
  });

  it.each([
    'missing-geometry',
    'too-few-slices',
    'missing-pixel-spacing',
    'inconsistent-image-size',
    'tilted',
    'non-uniform-spacing',
  ] as const)('refuses a stack that is %s, and says so before it looks at memory', (reason) => {
    expect(decideMpr(stack(300, { ok: false, reason }), { maxBytes: 1, inUseBytes: 0 })).toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses a volume over the budget', () => {
    expect(decideMpr(stack(400), { maxBytes: 300 * MIB, inUseBytes: 0 })).toEqual({
      ok: false,
      reason: 'over-memory-budget',
    });
  });

  it('counts what other volumes already hold', () => {
    const bytes = 512 * 512 * 300 * 4;
    expect(decideMpr(stack(300), { maxBytes: bytes + 10, inUseBytes: 0 }).ok).toBe(true);
    expect(decideMpr(stack(300), { maxBytes: bytes + 10, inUseBytes: 11 })).toEqual({
      ok: false,
      reason: 'over-memory-budget',
    });
  });

  it('accepts a volume that is exactly the room left', () => {
    const bytes = 128 * 128 * 64 * 4;
    const small = stack(64, undefined, { rows: 128, columns: 128 });
    expect(decideMpr(small, { maxBytes: bytes, inUseBytes: 0 }).ok).toBe(true);
  });
});

describe('describeFallback', () => {
  const reasons: MprFallbackReason[] = [
    'missing-geometry',
    'too-few-slices',
    'missing-pixel-spacing',
    'inconsistent-image-size',
    'tilted',
    'non-uniform-spacing',
    'over-memory-budget',
    'engine-unsupported',
  ];

  it.each(reasons)('says something a person can read for %s', (reason) => {
    const text = describeFallback(reason);
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/\.$/);
    expect(text).not.toContain(reason);
  });

  it('gives each reason its own sentence', () => {
    expect(new Set(reasons.map(describeFallback)).size).toBe(reasons.length);
  });
});
