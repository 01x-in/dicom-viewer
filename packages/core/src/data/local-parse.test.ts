import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { numbers } from './dicom-json';
import { readFrames } from './frame-geometry';
import { parseLocalInstance } from './local-parse';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));

function parse(path: string): ReturnType<typeof parseLocalInstance> {
  return parseLocalInstance(new Uint8Array(readFileSync(`${PHANTOM}/${path}`)));
}

describe('parseLocalInstance of an Enhanced CT', () => {
  const enhanced = parse('multiframe-ct/0001.dcm');

  it('reads the number of frames and the two functional group sequences', () => {
    expect(numbers(enhanced, '00280008')).toEqual([64]);
    const shared = enhanced['52009229']?.Value;
    const perFrame = enhanced['52009230']?.Value;
    expect(shared).toHaveLength(1);
    expect(perFrame).toHaveLength(64);
  });

  it('reads what a frame says about its position, in the shape DICOMweb gives', () => {
    const [first] = enhanced['52009230']?.Value ?? [];
    expect(first).toMatchObject({
      '00209113': { vr: 'SQ', Value: [{ '00200032': { vr: 'DS' } }] },
    });
  });

  it('gives frames whose geometry is that of the same slice of the single-frame series', () => {
    const frames = readFrames(enhanced)?.frames ?? [];
    expect(frames).toHaveLength(64);
    for (const index of [0, 1, 31, 62, 63]) {
      const slice = parse(`ct-j2k/${(index + 1).toString().padStart(4, '0')}.dcm`);
      const frame = frames[index];
      if (frame === undefined) throw new Error('no frame');
      for (const tag of ['00200032', '00200037', '00280030']) {
        const wanted = numbers(slice, tag);
        const got = numbers(frame, tag);
        expect(got).toHaveLength(wanted.length);
        for (const [at, value] of wanted.entries()) {
          expect(got[at]).toBeCloseTo(value, 6);
        }
      }
    }
  });

  it('leaves a single-frame file with no functional groups', () => {
    const slice = parse('ct-j2k/0001.dcm');
    expect(slice['52009229']).toBeUndefined();
    expect(slice['52009230']).toBeUndefined();
  });
});
