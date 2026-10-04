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
  /** Number of labelmap layers; SEGs with overlapping segments have more than one. */
  readonly layerCount: number;
  /** Segment number at one pixel of one CT slice (the lowest layer that has one), or 0. */
  sample(sliceIndex: number, row: number, column: number): number;
  /** Every segment number at one pixel, one per layer that has one. More than one means overlap. */
  sampleAll(sliceIndex: number, row: number, column: number): number[];
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

  const layers = labelMapImages.map((layer) => layer.filter(isLabelmapImage));
  const [firstLayer] = layers;
  if (firstLayer === undefined) throw new Error('The SEG produced no labelmap images.');
  const valueAt = (image: Types.IImage, row: number, column: number): number =>
    image.voxelManager?.getScalarData()[row * image.columns + column] ?? 0;
  const sampleAll = (sliceIndex: number, row: number, column: number): number[] =>
    layers.flatMap((layer) => {
      const image = layer[sliceIndex];
      if (image === undefined)
        throw new RangeError(`No labelmap for slice ${sliceIndex.toString()}.`);
      const value = valueAt(image, row, column);
      return value === 0 ? [] : [value];
    });
  return {
    segments,
    labelmapFrameCount: firstLayer.length,
    layerCount: layers.length,
    sample: (sliceIndex, row, column) => sampleAll(sliceIndex, row, column)[0] ?? 0,
    sampleAll,
  };
}
