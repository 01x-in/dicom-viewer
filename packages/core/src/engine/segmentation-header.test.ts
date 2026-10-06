import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDicom } from 'dicom-parser';
import { describe, expect, it } from 'vitest';
import { pixelDataHeader, readSegmentationHeader } from './segmentation-header';

const PHANTOM = fileURLToPath(new URL('../../../../fixtures/phantom', import.meta.url));

function header(series: string): ReturnType<typeof readSegmentationHeader> {
  const file = readFileSync(`${PHANTOM}/${series}/0001.dcm`);
  return readSegmentationHeader(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
}

describe('readSegmentationHeader', () => {
  it('reads the segments of a SEG, with their numbers and labels', () => {
    expect(header('seg-body-bone').segments.map(({ number, label }) => [number, label])).toEqual([
      [1, 'Body'],
      [2, 'Bone insert'],
    ]);
    expect(header('seg-inserts').segments.map(({ label }) => label)).toEqual([
      'Air',
      'Water',
      'Fat',
      'Bone',
    ]);
  });

  it('reads the size, the series it segments, and the instances it names', () => {
    const body = header('seg-body-bone');
    expect(body).toMatchObject({ rows: 128, columns: 128 });
    expect(body.referencedSeriesInstanceUID).toMatch(/^2\.25\./);
    expect(body.referencedSopInstanceUIDs).toHaveLength(64);
    expect(new Set(body.referencedSopInstanceUIDs).size).toBe(64);
    expect(header('seg-inserts').referencedSopInstanceUIDs).toHaveLength(48);
    expect(header('seg-overlap').referencedSopInstanceUIDs).toHaveLength(21);
  });

  it('reads one entry for each frame: its segment, the instance it is on, and where it is', () => {
    const inserts = header('seg-inserts');
    // Four segments on each of 48 slices.
    expect(inserts.frames).toHaveLength(192);
    for (const number of [1, 2, 3, 4]) {
      expect(inserts.frames.filter((frame) => frame.segmentNumber === number)).toHaveLength(48);
    }
    // Frames are not promised to be in slice order, so each is checked against what it names.
    const named = new Set(inserts.referencedSopInstanceUIDs);
    expect(inserts.frames.every((frame) => named.has(frame.referencedSopInstanceUID ?? ''))).toBe(
      true,
    );
    // Slice n is 2.5 mm above slice n - 1, and the inserts are on slices 8 to 55.
    const heights = new Set(inserts.frames.map((frame) => frame.position?.[2]));
    expect([...heights].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 48 }, (_, offset) => (8 + offset) * 2.5),
    );
    expect(inserts.frames.every((frame) => frame.position?.[0] === -95.25)).toBe(true);
  });

  it('gives each frame of a SEG of one segment that segment, which the file names once for all of them', () => {
    const mismatch = header('seg-mismatch');
    expect(mismatch.segments).toHaveLength(1);
    expect(mismatch.frames).toHaveLength(21);
    expect(mismatch.frames.every((frame) => frame.segmentNumber === 1)).toBe(true);
  });

  it('reads how the SEG lies in space, and the frame of reference it names', () => {
    const body = header('seg-body-bone');
    expect(body.orientation).toEqual([1, 0, 0, 0, 1, 0]);
    expect(body.pixelSpacing).toEqual([1.5, 1.5]);
    expect(body.frameOfReferenceUID).toBeDefined();
    expect(header('seg-inserts').frameOfReferenceUID).toBe(body.frameOfReferenceUID);
  });

  it('reads a SEG that is not on the CT: another frame of reference, planes 12 mm along', () => {
    const body = header('seg-body-bone');
    const mismatch = header('seg-mismatch');
    expect(mismatch.frameOfReferenceUID).not.toBe(body.frameOfReferenceUID);
    expect(mismatch.frames.every((frame) => frame.position?.[0] === -95.25 + 12)).toBe(true);
  });

  it('reads how the pixels are stored and where they are in the file', () => {
    const file = readFileSync(`${PHANTOM}/seg-body-bone/0001.dcm`);
    const body = header('seg-body-bone');
    expect(body.segmentationType).toBe('BINARY');
    expect(body.pixelData?.bitsAllocated).toBe(1);
    // One bit a pixel, for each of the 112 frames, and the pixel data is the last element of the file.
    expect(body.pixelData?.length).toBe((112 * 128 * 128) / 8);
    expect((body.pixelData?.offset ?? 0) + (body.pixelData?.length ?? 0)).toBe(file.byteLength);
  });

  it('does not call encapsulated pixel data native: it has no length to read as bits', () => {
    // The check in the reader is on this flag, which a compressed file has and a native one does not.
    const parsed = (series: string): boolean | undefined => {
      const file = readFileSync(`${PHANTOM}/${series}/0001.dcm`);
      const dataSet = parseDicom(new Uint8Array(file.buffer, file.byteOffset, file.byteLength), {
        untilTag: 'x7fe00010',
      });
      return dataSet.elements['x7fe00010']?.hadUndefinedLength;
    };
    expect(parsed('ct-j2k')).toBe(true);
    expect(parsed('ct-evrle')).not.toBe(true);
    expect(parsed('seg-body-bone')).not.toBe(true);
  });

  it('gives the pixel data of a native file, and none for encapsulated data or a missing size', () => {
    const native = { dataOffset: 100, length: 4096 };
    expect(pixelDataHeader(native, 1)).toEqual({ offset: 100, length: 4096, bitsAllocated: 1 });
    // What dicom-parser gives for encapsulated data: an undefined length, read as 0xffffffff.
    expect(
      pixelDataHeader({ dataOffset: 100, length: 0xffffffff, hadUndefinedLength: true }, 8),
    ).toBeUndefined();
    expect(pixelDataHeader({ ...native, hadUndefinedLength: false }, 8)).toBeDefined();
    expect(pixelDataHeader(undefined, 1)).toBeUndefined();
    expect(pixelDataHeader(native, undefined)).toBeUndefined();
  });

  it('has no colour for a segment the SEG gave none', () => {
    expect(header('seg-body-bone').segments.every(({ color }) => color === undefined)).toBe(true);
  });

  it('refuses a file that is not DICOM, with a message that says so', () => {
    expect(() => readSegmentationHeader(new ArrayBuffer(16))).toThrow(/not a readable DICOM file/);
  });

  it('refuses a DICOM file that is not a SEG, with what is missing', () => {
    const ct = readFileSync(`${PHANTOM}/ct-evrle/0001.dcm`);
    expect(() =>
      readSegmentationHeader(ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength)),
    ).toThrow(/no segments/i);
  });
});
