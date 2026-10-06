import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DicomJsonInstance, SeriesInstance, SeriesStack } from '../data/types';
import { readSegmentationHeader } from '../engine/segmentation-header';
import type { SegmentationHeader } from './header';
import { buildSegmentIndex, type SegmentIndexResult } from './segment-index';
import { checkSegmentation } from './validate';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));

function headerOf(series: string): SegmentationHeader {
  const file = readFileSync(`${PHANTOM}/${series}/0001.dcm`);
  return readSegmentationHeader(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
}

/** The phantom CT as a stack: 64 slices of 128 by 128, 1.5 mm pixels, 2.5 mm apart. */
function phantomStack(
  frameOfReference: string | undefined,
  referenced: readonly string[],
  change: Partial<Record<string, { vr: string; Value: unknown[] }>> = {},
): SeriesStack {
  const instances: SeriesInstance[] = referenced.map((sopInstanceUID, index) => {
    const metadata: DicomJsonInstance = {
      '00080018': { vr: 'UI', Value: [sopInstanceUID] },
      '00200032': { vr: 'DS', Value: [-95.25, -95.25, index * 2.5] },
      '00200037': { vr: 'DS', Value: [1, 0, 0, 0, 1, 0] },
      '00280010': { vr: 'US', Value: [128] },
      '00280011': { vr: 'US', Value: [128] },
      '00280030': { vr: 'DS', Value: [1.5, 1.5] },
      ...(frameOfReference === undefined
        ? {}
        : { '00200052': { vr: 'UI', Value: [frameOfReference] } }),
      ...change,
    };
    return {
      sopInstanceUID,
      instanceNumber: index + 1,
      imageId: `id:${index.toString()}`,
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

/**
 * The CT that seg-body-bone names, in slice order: the SEG lists its instances in its own order, so
 * the slice number comes from the plane of the frame that names each one.
 */
function ctStack(): SeriesStack {
  const body = headerOf('seg-body-bone');
  const heightOf = new Map(
    body.frames.map((frame) => [frame.referencedSopInstanceUID, frame.position?.[2] ?? 0]),
  );
  const inOrder = [...body.referencedSopInstanceUIDs].sort(
    (a, b) => (heightOf.get(a) ?? 0) - (heightOf.get(b) ?? 0),
  );
  return phantomStack(body.frameOfReferenceUID, inOrder);
}

describe('checkSegmentation on the phantom SEGs', () => {
  const stack = ctStack();

  it.each(['seg-body-bone', 'seg-inserts', 'seg-overlap'])(
    'has nothing to say about %s, which lies on the CT',
    (series) => {
      const header = headerOf(series);
      // One pixel of every segment, so none of them is empty.
      const index = buildSegmentIndex({
        rows: 1,
        columns: header.segments.length,
        layers: [[Uint8Array.from(header.segments.map((segment) => segment.number))]],
      });
      expect(checkSegmentation({ header, stack, index })).toEqual([]);
    },
  );

  it('says the mismatch SEG is in another frame of reference, and how far its planes are', () => {
    const warnings = checkSegmentation({
      header: headerOf('seg-mismatch'),
      stack,
      index: buildSegmentIndex({ rows: 1, columns: 1, layers: [[Uint8Array.of(1)]] }),
    });
    expect(warnings.map((warning) => warning.code)).toEqual([
      'frame-of-reference',
      'plane-position',
    ]);
    expect(warnings[1]?.message).toBe(
      '21 frames of the SEG are not on the plane of the image they name, by up to 12.0 mm.',
    );
  });
});

describe('checkSegmentation', () => {
  const header = headerOf('seg-body-bone');
  const stack = ctStack();
  const present = buildSegmentIndex({ rows: 1, columns: 2, layers: [[Uint8Array.of(1, 2)]] });
  const check = (
    changed: Partial<SegmentationHeader>,
    on: SeriesStack = stack,
  ): ReturnType<typeof checkSegmentation> =>
    checkSegmentation({ header: { ...header, ...changed }, stack: on, index: present });

  it('is silent when the SEG and the images agree', () => {
    expect(check({})).toEqual([]);
  });

  it('is silent about what the SEG or the images do not say', () => {
    expect(
      check({ frameOfReferenceUID: undefined, orientation: undefined, pixelSpacing: undefined }),
    ).toEqual([]);
    expect(
      checkSegmentation({
        header,
        stack: phantomStack(
          undefined,
          stack.instances.map((i) => i.sopInstanceUID),
        ),
        index: present,
      }),
    ).toEqual([]);
  });

  it('says when the size differs', () => {
    expect(check({ rows: 256, columns: 128 })).toEqual([
      {
        code: 'image-size',
        message: 'The SEG is 256 by 128 pixels and the images are 128 by 128.',
      },
    ]);
  });

  it('says when the direction differs', () => {
    expect(check({ orientation: [0, 1, 0, 1, 0, 0] }).map((warning) => warning.code)).toEqual([
      'plane-orientation',
    ]);
    // A difference below what a pixel could show is not one.
    expect(check({ orientation: [1, 0.0001, 0, 0, 1, 0] })).toEqual([]);
  });

  it('says when the pixels are another size', () => {
    expect(check({ pixelSpacing: [1.5, 3] })).toEqual([
      {
        code: 'pixel-spacing',
        message: 'The SEG has pixels of 1.5 mm by 3.0 mm and the images have 1.5 mm by 1.5 mm.',
      },
    ]);
  });

  it('says how many images the SEG names that are not on screen', () => {
    const fewer = phantomStack(
      header.frameOfReferenceUID,
      stack.instances.slice(0, 62).map((instance) => instance.sopInstanceUID),
    );
    expect(check({}, fewer).map((warning) => warning.message)).toEqual([
      'The SEG names 2 images that are not in the series on screen.',
    ]);
    const one = phantomStack(
      header.frameOfReferenceUID,
      stack.instances.slice(0, 63).map((instance) => instance.sopInstanceUID),
    );
    expect(check({}, one)[0]?.message).toBe(
      'The SEG names 1 image that is not in the series on screen.',
    );
  });

  it('does not count a position it cannot compare, and tolerates a tenth of a millimetre', () => {
    const [frame] = header.frames;
    const near = {
      ...frame,
      position: [
        (frame?.position?.[0] ?? 0) + 0.05,
        frame?.position?.[1] ?? 0,
        frame?.position?.[2] ?? 0,
      ] as const,
    };
    expect(check({ frames: [near] })).toEqual([]);
    expect(check({ frames: [{ ...frame, position: undefined }] })).toEqual([]);
    expect(check({ frames: [{ segmentNumber: 1, position: [0, 0, 0] }] })).toEqual([]);
  });

  it('names the segments that share pixels', () => {
    const overlap: SegmentIndexResult = {
      segments: present.segments,
      overlaps: [{ a: 1, b: 2, voxelCount: 4 }],
    };
    expect(checkSegmentation({ header, stack, index: overlap })).toEqual([
      { code: 'overlapping-segments', message: 'Segments share pixels: Body and Bone insert.' },
    ]);
  });

  it('names three pairs at most', () => {
    const many: SegmentIndexResult = {
      segments: present.segments,
      overlaps: [
        { a: 1, b: 2, voxelCount: 1 },
        { a: 1, b: 3, voxelCount: 1 },
        { a: 1, b: 4, voxelCount: 1 },
        { a: 2, b: 3, voxelCount: 1 },
        { a: 2, b: 4, voxelCount: 1 },
      ],
    };
    expect(checkSegmentation({ header, stack, index: many })[0]?.message).toBe(
      'Segments share pixels: Body and Bone insert, Body and segment 3, Body and segment 4, and 2 other pairs.',
    );
  });

  it('says which segments have no pixels', () => {
    const onlyBody = buildSegmentIndex({ rows: 1, columns: 1, layers: [[Uint8Array.of(1)]] });
    expect(checkSegmentation({ header, stack, index: onlyBody })).toEqual([
      { code: 'empty-segment', message: 'The segment Bone insert has no pixels.' },
    ]);
  });
});
