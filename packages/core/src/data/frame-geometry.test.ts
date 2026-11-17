import { describe, expect, it } from 'vitest';
import { frameCountOf, readFrames } from './frame-geometry';
import type { DicomJsonInstance } from './types';

const SHARED = '52009229';
const PER_FRAME = '52009230';

function seq(...items: DicomJsonInstance[]): { vr: string; Value: DicomJsonInstance[] } {
  return { vr: 'SQ', Value: items };
}

function shared(): DicomJsonInstance {
  return {
    '00209116': seq({ '00200037': { vr: 'DS', Value: [1, 0, 0, 0, 1, 0] } }),
    '00289110': seq({
      '00280030': { vr: 'DS', Value: [1.5, 1.5] },
      '00180050': { vr: 'DS', Value: [2.5] },
    }),
    '00289145': seq({
      '00281052': { vr: 'DS', Value: [-1024] },
      '00281053': { vr: 'DS', Value: [1] },
      '00281054': { vr: 'LO', Value: ['HU'] },
    }),
  };
}

function perFrame(z: number): DicomJsonInstance {
  return {
    '00209113': seq({ '00200032': { vr: 'DS', Value: [0, 0, z] } }),
    '00209111': seq({ '00209057': { vr: 'UL', Value: [z + 1] } }),
  };
}

function enhanced(frames: number, extra: DicomJsonInstance = {}): DicomJsonInstance {
  return {
    '00080018': { vr: 'UI', Value: ['1.2.3'] },
    '00280008': { vr: 'IS', Value: [frames] },
    '00280010': { vr: 'US', Value: [128] },
    '00280011': { vr: 'US', Value: [128] },
    [SHARED]: seq(shared()),
    [PER_FRAME]: seq(...Array.from({ length: frames }, (_, i) => perFrame(i * 2.5))),
    ...extra,
  };
}

describe('frameCountOf', () => {
  it('is 1 when NumberOfFrames is missing or 1', () => {
    expect(frameCountOf({})).toBe(1);
    expect(frameCountOf({ '00280008': { vr: 'IS', Value: [1] } })).toBe(1);
  });

  it('reads a number or a numeric string', () => {
    expect(frameCountOf({ '00280008': { vr: 'IS', Value: [64] } })).toBe(64);
    expect(frameCountOf({ '00280008': { vr: 'IS', Value: ['40'] } })).toBe(40);
  });

  it.each([[0], [-3], [1.5], ['abc'], ['']])('rejects %j, naming the attribute', (value) => {
    expect(() => frameCountOf({ '00280008': { vr: 'IS', Value: [value] } })).toThrow(
      /NumberOfFrames/,
    );
  });
});

describe('readFrames', () => {
  it('is undefined for an instance of one frame, which needs no splitting', () => {
    expect(readFrames({ '00280008': { vr: 'IS', Value: [1] } })).toBeUndefined();
    expect(readFrames({})).toBeUndefined();
  });

  it('gives one entry for each frame, with the shared values and the frame own position at the top level', () => {
    const set = readFrames(enhanced(3));
    expect(set?.frames).toHaveLength(3);
    const second = set?.frames[1];
    expect(second?.['00200032']?.Value).toEqual([0, 0, 2.5]);
    expect(second?.['00200037']?.Value).toEqual([1, 0, 0, 0, 1, 0]);
    expect(second?.['00280030']?.Value).toEqual([1.5, 1.5]);
    expect(second?.['00180050']?.Value).toEqual([2.5]);
    expect(second?.['00281052']?.Value).toEqual([-1024]);
    expect(second?.['00281053']?.Value).toEqual([1]);
    expect(second?.['00281054']?.Value).toEqual(['HU']);
    expect(set?.withoutGroup).toBe(0);
  });

  it('leaves the two big sequences out of every frame and shares the rest of the instance', () => {
    const instance = enhanced(3);
    const set = readFrames(instance);
    for (const frame of set?.frames ?? []) {
      expect(frame[SHARED]).toBeUndefined();
      expect(frame[PER_FRAME]).toBeUndefined();
      expect(frame['00280010']).toBe(instance['00280010']);
      expect(frame['00080018']).toBe(instance['00080018']);
    }
  });

  it('lets a value of the frame win over the shared one', () => {
    const instance = enhanced(2);
    const items = instance[PER_FRAME]?.Value as DicomJsonInstance[];
    items[1] = {
      ...perFrame(2.5),
      '00289145': seq({ '00281052': { vr: 'DS', Value: [-1000] } }),
    };
    const set = readFrames(instance);
    expect(set?.frames[0]?.['00281052']?.Value).toEqual([-1024]);
    expect(set?.frames[1]?.['00281052']?.Value).toEqual([-1000]);
    // What the frame does not say, the shared group still gives.
    expect(set?.frames[1]?.['00281053']?.Value).toEqual([1]);
  });

  it('gives frames with no geometry for an instance with no functional groups, as a cine loop is', () => {
    const set = readFrames({
      '00080018': { vr: 'UI', Value: ['1.2.3'] },
      '00280008': { vr: 'IS', Value: [24] },
    });
    expect(set?.frames).toHaveLength(24);
    expect(set?.frames[5]?.['00200032']).toBeUndefined();
    expect(set?.withoutGroup).toBe(24);
  });

  it('keeps every frame when the per-frame sequence has fewer items, and counts the ones with no item', () => {
    const instance = enhanced(4);
    (instance[PER_FRAME] as { Value: unknown[] }).Value.length = 2;
    const set = readFrames(instance);
    expect(set?.frames).toHaveLength(4);
    expect(set?.frames[1]?.['00200032']?.Value).toEqual([0, 0, 2.5]);
    expect(set?.frames[3]?.['00200032']).toBeUndefined();
    // They still have the shared orientation: only the position is missing.
    expect(set?.frames[3]?.['00200037']?.Value).toEqual([1, 0, 0, 0, 1, 0]);
    expect(set?.withoutGroup).toBe(2);
  });

  it('ignores items past the number of frames', () => {
    const instance = enhanced(2);
    (instance[PER_FRAME] as { Value: unknown[] }).Value.push(perFrame(99));
    expect(readFrames(instance)?.frames).toHaveLength(2);
  });

  it('names the tag and the frame when a value has the wrong type', () => {
    const instance = enhanced(3);
    const items = instance[PER_FRAME]?.Value as DicomJsonInstance[];
    items[2] = { '00209113': seq({ '00200032': { vr: 'DS', Value: [0, 'left', 7] } }) };
    expect(() => readFrames(instance)).toThrow(/frame 3.*0020,0032/i);
  });

  it('names the tag and the frame when a sequence is not a sequence', () => {
    const instance = enhanced(2);
    const items = instance[PER_FRAME]?.Value as DicomJsonInstance[];
    items[0] = { '00209113': { vr: 'DS', Value: [5] } };
    expect(() => readFrames(instance)).toThrow(/frame 1.*0020,9113/i);
  });

  it('rejects a position with the wrong number of values', () => {
    const instance = enhanced(1 + 1);
    const items = instance[PER_FRAME]?.Value as DicomJsonInstance[];
    items[0] = { '00209113': seq({ '00200032': { vr: 'DS', Value: [1, 2] } }) };
    expect(() => readFrames(instance)).toThrow(/frame 1.*0020,0032.*3/i);
  });

  it('reads numeric strings, as DICOM JSON from some servers has', () => {
    const instance = enhanced(2);
    const items = instance[PER_FRAME]?.Value as DicomJsonInstance[];
    items[0] = { '00209113': seq({ '00200032': { vr: 'DS', Value: ['0', '0', '1.25'] } }) };
    expect(readFrames(instance)?.frames[0]?.['00200032']?.Value).toEqual(['0', '0', '1.25']);
  });

  it('reads 1,000 frames in well under 50 ms', () => {
    const instance = enhanced(1000);
    const started = performance.now();
    const set = readFrames(instance);
    const elapsed = performance.now() - started;
    expect(set?.frames).toHaveLength(1000);
    expect(elapsed).toBeLessThan(50);
  });
});
