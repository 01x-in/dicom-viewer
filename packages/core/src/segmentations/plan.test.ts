import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSegmentationHeader } from '../engine/segmentation-header';
import { decodeBinarySegmentation } from './decode-binary';
import type { SegmentationHeader } from './header';
import { planBinaryDecode } from './plan';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));

function load(series: string): { header: SegmentationHeader; bytes: Uint8Array } {
  const file = readFileSync(`${PHANTOM}/${series}/0001.dcm`);
  const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  return {
    header: readSegmentationHeader(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    ),
    bytes,
  };
}

/** The SOP instance UIDs of the CT, in slice order: the SEG that covers all of it says where each is. */
function ctOrder(): string[] {
  const { header } = load('seg-body-bone');
  const heightOf = new Map(
    header.frames.map((frame) => [frame.referencedSopInstanceUID, frame.position?.[2] ?? 0]),
  );
  return [...header.referencedSopInstanceUIDs].sort(
    (a, b) => (heightOf.get(a) ?? 0) - (heightOf.get(b) ?? 0),
  );
}

/** Reads a phantom SEG the way the engine does: plan the frames, then decode them. */
function decode(
  series: string,
  sops: readonly string[] = ctOrder(),
): ReturnType<typeof decodeBinarySegmentation> {
  const { header, bytes } = load(series);
  const plan = planBinaryDecode(header, sops);
  if (plan === undefined || header.pixelData === undefined) throw new Error('no plan');
  return decodeBinarySegmentation({
    pixelData: bytes.subarray(
      header.pixelData.offset,
      header.pixelData.offset + header.pixelData.length,
    ),
    rows: header.rows,
    columns: header.columns,
    imageCount: sops.length,
    frames: plan.frames,
  });
}

describe('planBinaryDecode', () => {
  it('puts each frame on the image it names, and keeps the frames in the order of the file', () => {
    const sops = ctOrder();
    const { header } = load('seg-inserts');
    const plan = planBinaryDecode(header, sops);
    expect(plan?.skipped).toBe(0);
    expect(plan?.frames).toHaveLength(192);
    plan?.frames.forEach((frame, at) => {
      expect(frame.segmentNumber).toBe(header.frames[at]?.segmentNumber);
      expect(sops[frame.imageIndex]).toBe(header.frames[at]?.referencedSopInstanceUID);
    });
  });

  it('counts the frames that name an image the stack does not have, and gives them no image', () => {
    const { header } = load('seg-inserts');
    const fewer = ctOrder().slice(0, 40);
    const plan = planBinaryDecode(header, fewer);
    const placed = plan?.frames.filter((frame) => frame.imageIndex >= 0).length ?? 0;
    expect(plan?.skipped).toBe(192 - placed);
    expect(plan?.skipped).toBeGreaterThan(0);
    expect(plan?.frames).toHaveLength(192);
  });

  it.each([
    ['a SEG that is not binary', { segmentationType: 'FRACTIONAL' as const }],
    [
      'a SEG whose pixel data is not one bit a pixel',
      { pixelData: { offset: 0, length: 8, bitsAllocated: 8 } },
    ],
    ['a SEG with no pixel data', { pixelData: undefined }],
    ['a SEG that does not say what type it is', { segmentationType: undefined }],
  ])('has no plan for %s, so the adapters read it', (_name, change) => {
    expect(
      planBinaryDecode({ ...load('seg-body-bone').header, ...change }, ctOrder()),
    ).toBeUndefined();
  });

  it('has no plan when a frame does not say which segment or which image it is', () => {
    const { header } = load('seg-body-bone');
    const [first, ...rest] = header.frames;
    expect(
      planBinaryDecode(
        { ...header, frames: [{ ...first, segmentNumber: undefined }, ...rest] },
        ctOrder(),
      ),
    ).toBeUndefined();
    expect(
      planBinaryDecode(
        { ...header, frames: [{ ...first, referencedSopInstanceUID: undefined }, ...rest] },
        ctOrder(),
      ),
    ).toBeUndefined();
  });

  it('has no plan when the pixel data is too short for the frames', () => {
    const { header } = load('seg-body-bone');
    expect(
      planBinaryDecode(
        { ...header, pixelData: { offset: 0, length: 10, bitsAllocated: 1 } },
        ctOrder(),
      ),
    ).toBeUndefined();
  });
});

describe('decoding the phantom SEGs', () => {
  // The counts are what the Cornerstone adapters make of the same files, in the real engine.
  it('finds the body and the bone insert of seg-body-bone', () => {
    const { index, layers } = decode('seg-body-bone');
    expect(layers).toHaveLength(1);
    expect(index.segments.map((segment) => [segment.number, segment.voxelCount])).toEqual([
      [1, 618640],
      [2, 12144],
    ]);
    expect(index.segments[1]).toMatchObject({
      imageIndices: expect.arrayContaining([8, 55]) as number[],
    });
    expect(index.segments[1]?.imageIndices).toHaveLength(48);
  });

  it('finds the four inserts of seg-inserts, each on 48 images', () => {
    const { index } = decode('seg-inserts');
    expect(index.segments.map((segment) => [segment.number, segment.voxelCount])).toEqual([
      [1, 12144],
      [2, 12144],
      [3, 12144],
      [4, 12144],
    ]);
  });

  it('puts the overlapping slab and disc of seg-overlap on two layers', () => {
    const { index, layers } = decode('seg-overlap');
    expect(layers).toHaveLength(2);
    expect(
      index.segments.map((segment) => [segment.number, segment.layer, segment.voxelCount]),
    ).toEqual([
      [1, 0, 39858],
      [2, 1, 26397],
    ]);
    expect(index.overlaps).toEqual([{ a: 1, b: 2, voxelCount: 13797 }]);
  });

  it('puts the disc of seg-mismatch on the images it names', () => {
    const { index } = decode('seg-mismatch');
    expect(index.segments.map((segment) => [segment.number, segment.voxelCount])).toEqual([
      [1, 16737],
    ]);
    expect(index.segments[0]?.imageIndices[0]).toBe(20);
    expect(index.segments[0]?.imageIndices.at(-1)).toBe(40);
  });
});
