import { describe, expect, it } from 'vitest';
import type { LoadedSeriesData, SeriesInstance, SeriesStack } from '../data/types';
import type { SegmentationHeader } from './header';
import { stackOf } from './registry';

const SOP = '1.2.3.4.5';
const OTHER = '1.2.3.4.6';

function image(sop: string, frameNumber: number, frameCount: number): SeriesInstance {
  return {
    sopInstanceUID: sop,
    frameNumber,
    frameCount,
    instanceNumber: 1,
    imageId: `id:${sop}:${frameNumber.toString()}`,
    metadata: {},
    instanceMetadata: {},
  };
}

function stack(index: number, instances: readonly SeriesInstance[]): SeriesStack {
  return {
    index,
    instances,
    imageIds: instances.map((instance) => instance.imageId),
    reconstructable: { ok: true, spacingMm: 1 },
  };
}

function series(stacks: readonly SeriesStack[]): LoadedSeriesData {
  return {
    studyInstanceUID: '1.2.3',
    seriesInstanceUID: '1.2.3.9',
    modality: 'MR',
    description: 'MR',
    instances: [],
    stacks,
  };
}

function header(frames: SegmentationHeader['frames']): SegmentationHeader {
  return {
    sopInstanceUID: '1.2.3.8.1',
    seriesInstanceUID: '1.2.3.8',
    studyInstanceUID: '1.2.3',
    rows: 1,
    columns: 1,
    segments: [],
    referencedSopInstanceUIDs: [
      ...new Set(frames.flatMap((f) => f.referencedSopInstanceUID ?? [])),
    ],
    frames,
  };
}

describe('stackOf for an instance of many frames that is split into stacks', () => {
  // Frames 1 to 6 are one stack (the first phase), and 7 to 8 another (the second): the larger
  // one has most of the instance's frames, but the SEG names frames of the smaller one.
  const first = stack(
    0,
    [1, 2, 3, 4, 5, 6].map((frame) => image(SOP, frame, 8)),
  );
  const second = stack(
    1,
    [7, 8].map((frame) => image(SOP, frame, 8)),
  );
  const both = series([first, second]);

  it('picks the stack that has the frames the SEG names, not the larger one', () => {
    const named = header([
      { segmentNumber: 1, referencedSopInstanceUID: SOP, referencedFrameNumber: 7 },
      { segmentNumber: 1, referencedSopInstanceUID: SOP, referencedFrameNumber: 8 },
    ]);
    expect(stackOf(both, named).index).toBe(1);
  });

  it('picks the larger stack when the SEG names frames in it', () => {
    const named = header([
      { segmentNumber: 1, referencedSopInstanceUID: SOP, referencedFrameNumber: 2 },
      { segmentNumber: 1, referencedSopInstanceUID: SOP, referencedFrameNumber: 3 },
    ]);
    expect(stackOf(both, named).index).toBe(0);
  });

  it('still picks the stack of single-frame images by their SOP instances', () => {
    const singles = series([stack(0, [image(OTHER, 1, 1)]), stack(1, [image(SOP, 1, 1)])]);
    expect(
      stackOf(singles, header([{ segmentNumber: 1, referencedSopInstanceUID: SOP }])).index,
    ).toBe(1);
  });

  it('says so when the SEG names no frame the stacks have', () => {
    const named = header([
      { segmentNumber: 1, referencedSopInstanceUID: SOP, referencedFrameNumber: 99 },
    ]);
    expect(() => stackOf(both, named)).toThrow(/names no image/);
  });
});
