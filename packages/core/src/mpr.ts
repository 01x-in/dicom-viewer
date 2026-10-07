import type { NotReconstructable, SeriesStack } from './data/types';

/** The three planes of a reformatted view. A viewport without one shows the slices as they were acquired. */
export const MPR_ORIENTATIONS = ['axial', 'sagittal', 'coronal'] as const;

export type MprOrientation = (typeof MPR_ORIENTATIONS)[number];

export function isMprOrientation(value: unknown): value is MprOrientation {
  return typeof value === 'string' && (MPR_ORIENTATIONS as readonly string[]).includes(value);
}

/** Why a viewport that asked for a plane shows the slices instead. */
export type MprFallbackReason = NotReconstructable | 'over-memory-budget' | 'engine-unsupported';

export type MprDecision =
  | { readonly ok: true; readonly bytes: number }
  | { readonly ok: false; readonly reason: MprFallbackReason };

const MIB = 1024 * 1024;

/** Cornerstone holds a scaled CT volume as 32-bit floats, so four bytes a voxel is the safe count. */
const BYTES_PER_VOXEL = 4;

/**
 * About how much memory the volume of a stack takes. Infinite when the size of the images is not
 * known: a volume that cannot be sized must not slip under a budget.
 */
export function estimateVolumeBytes(stack: SeriesStack): number {
  const first = stack.instances[0]?.metadata;
  const rows = first?.['00280010']?.Value?.[0];
  const columns = first?.['00280011']?.Value?.[0];
  if (typeof rows !== 'number' || typeof columns !== 'number') return Number.POSITIVE_INFINITY;
  return rows * columns * stack.imageIds.length * BYTES_PER_VOXEL;
}

/** 1 GiB, or 512 MiB on a device that reports 4 GiB of memory or less (`navigator.deviceMemory`). */
export function defaultMaxCacheBytes(deviceMemoryGiB: number | undefined): number {
  return deviceMemoryGiB !== undefined && deviceMemoryGiB <= 4 ? 512 * MIB : 1024 * MIB;
}

/**
 * Whether a stack can be shown as a volume: it must be reconstructable, and its volume must fit in
 * what is left of the budget after the volumes already held. Pure.
 */
export function decideMpr(
  stack: SeriesStack,
  budget: { readonly maxBytes: number; readonly inUseBytes: number },
): MprDecision {
  if (!stack.reconstructable.ok) return { ok: false, reason: stack.reconstructable.reason };
  const bytes = estimateVolumeBytes(stack);
  if (bytes > budget.maxBytes - budget.inUseBytes) {
    return { ok: false, reason: 'over-memory-budget' };
  }
  return { ok: true, bytes };
}

const EXPLANATIONS: Readonly<Record<MprFallbackReason, string>> = {
  'missing-geometry': 'The images have no position or orientation, so they cannot be reformatted.',
  'too-few-slices': 'The series has too few slices to be reformatted.',
  'missing-pixel-spacing':
    'The images do not say how large a pixel is, so they cannot be reformatted.',
  'inconsistent-image-size': 'The images are not all the same size, so they cannot be reformatted.',
  tilted:
    'The slices lean against the direction they are stacked in, so they cannot be reformatted.',
  'non-uniform-spacing': 'The slices are not evenly spaced, so they cannot be reformatted.',
  'over-memory-budget':
    'The volume is larger than the memory the viewer may use, so the slices are shown.',
  'engine-unsupported': 'This browser cannot draw a reformatted view, so the slices are shown.',
};

/** A sentence for the shell to show where a viewport asked for a plane and got the slices. */
export function describeFallback(reason: MprFallbackReason): string {
  return EXPLANATIONS[reason];
}
