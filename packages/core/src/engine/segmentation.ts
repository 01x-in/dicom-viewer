import { adaptersSEG } from '@cornerstonejs/adapters';
import { type Types, metaData } from '@cornerstonejs/core';
import { z } from 'zod';
import type { LoadedSeriesData } from '../data/types';

export interface SegmentInfo {
  readonly number: number;
  readonly label: string;
}

export interface SegmentationHandle {
  readonly segments: readonly SegmentInfo[];
  /** Number of referenced images that received a labelmap frame (one per CT slice). */
  readonly labelmapFrameCount: number;
  /** Segment number stored at one pixel of one CT slice, or 0 for background. */
  sample(sliceIndex: number, row: number, column: number): number;
}

/**
 * The adapters return `any`-typed results, so everything this module relies on is checked here.
 * `segMetadata.data[n]` describes segment n (index 0 is unused).
 */
const segMetadataSchema = z.object({
  data: z.array(
    z.union([
      z.null(),
      z.undefined(),
      z.object({ SegmentNumber: z.number(), SegmentLabel: z.string() }).loose(),
    ]),
  ),
});

function isLabelmapImage(value: unknown): value is Types.IImage {
  return (
    typeof value === 'object' && value !== null && 'columns' in value && 'voxelManager' in value
  );
}

/** Parses a DICOM SEG against the series it segments, through the Cornerstone adapters. */
export async function parseSegmentation(
  series: LoadedSeriesData,
  bytes: ArrayBuffer,
): Promise<SegmentationHandle> {
  const result: unknown = await adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
    [...series.imageIds],
    bytes,
    { metadataProvider: metaData },
  );
  const { labelMapImages, segMetadata } = z
    .object({ labelMapImages: z.array(z.array(z.unknown())), segMetadata: segMetadataSchema })
    .parse(result);

  const segments: SegmentInfo[] = [];
  for (const entry of segMetadata.data) {
    if (entry !== null && entry !== undefined) {
      segments.push({ number: entry.SegmentNumber, label: entry.SegmentLabel });
    }
  }

  const [firstLayer] = labelMapImages;
  if (firstLayer === undefined) throw new Error('The SEG produced no labelmap images.');
  const frames = firstLayer.filter(isLabelmapImage);
  return {
    segments,
    labelmapFrameCount: frames.length,
    sample(sliceIndex, row, column): number {
      const image = frames[sliceIndex];
      if (image === undefined)
        throw new RangeError(`No labelmap for slice ${sliceIndex.toString()}.`);
      return image.voxelManager?.getScalarData()[row * image.columns + column] ?? 0;
    },
  };
}
