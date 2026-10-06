import { describe, expect, it } from 'vitest';
import { cielabToRgb, parseSegmentationHeader } from './header';

const near = (actual: readonly number[] | undefined, expected: readonly number[], by = 3): void => {
  expect(actual).toBeDefined();
  expected.forEach((value, index) => {
    expect(Math.abs((actual?.[index] ?? Number.NaN) - value)).toBeLessThanOrEqual(by);
  });
};

/** The value DICOM stores for a CIELab triple: L* 0 to 100, a* and b* -128 to 127. */
const stored = (l: number, a: number, b: number): number[] => [
  Math.round((l * 65535) / 100),
  Math.round(((a + 128) * 65535) / 255),
  Math.round(((b + 128) * 65535) / 255),
];

describe('cielabToRgb', () => {
  it('turns the ends of the lightness axis into black and white', () => {
    near(cielabToRgb(stored(0, 0, 0)), [0, 0, 0]);
    near(cielabToRgb(stored(100, 0, 0)), [255, 255, 255], 1);
  });

  it('turns a mid grey into a grey', () => {
    const grey = cielabToRgb(stored(53.4, 0, 0));
    near(grey, [128, 128, 128], 4);
    expect(Math.abs((grey?.[0] ?? 0) - (grey?.[2] ?? 255))).toBeLessThanOrEqual(2);
  });

  it('turns colours into the hues they have', () => {
    const [redR, redG, redB] = cielabToRgb(stored(53, 80, 67)) ?? [];
    expect(redR).toBeGreaterThan(220);
    expect(redG).toBeLessThan(60);
    expect(redB).toBeLessThan(60);
    const [greenR, greenG] = cielabToRgb(stored(88, -80, 80)) ?? [];
    expect(greenG).toBeGreaterThan(220);
    expect(greenR).toBeLessThan(150);
    const [blueR, , blueB] = cielabToRgb(stored(30, 68, -112)) ?? [];
    expect(blueB).toBeGreaterThan(180);
    expect(blueR).toBeLessThan(120);
  });

  it('keeps every channel inside 0 to 255 for colours sRGB cannot show', () => {
    for (const [l, a, b] of [
      [50, 127, 127],
      [50, -128, -128],
      [100, 127, -128],
      [0, 127, 127],
    ] as const) {
      const rgb = cielabToRgb(stored(l, a, b));
      expect(rgb).toHaveLength(3);
      for (const channel of rgb ?? []) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
        expect(Number.isInteger(channel)).toBe(true);
      }
    }
  });

  it('gives nothing for a value that is not three numbers in range', () => {
    expect(cielabToRgb([])).toBeUndefined();
    expect(cielabToRgb([1, 2])).toBeUndefined();
    expect(cielabToRgb([1, 2, 3, 4])).toBeUndefined();
    expect(cielabToRgb([-1, 0, 0])).toBeUndefined();
    expect(cielabToRgb([70000, 0, 0])).toBeUndefined();
    expect(cielabToRgb([1.5, 0, 0])).toBeUndefined();
  });
});

describe('parseSegmentationHeader', () => {
  const valid = {
    sopInstanceUID: '1.2.3.4',
    seriesInstanceUID: '1.2.3',
    studyInstanceUID: '1.2',
    rows: 2,
    columns: 2,
    segments: [{ number: 1, label: 'A' }],
    referencedSopInstanceUIDs: [],
    frames: [],
  };

  it('accepts what a reader makes of a SEG', () => {
    expect(parseSegmentationHeader(valid).segments).toEqual([{ number: 1, label: 'A' }]);
  });

  it('refuses a header that has no segments, and says so', () => {
    expect(() => parseSegmentationHeader({ ...valid, segments: [] })).toThrow(/no segments/i);
  });

  it.each([
    ['a size of zero', { rows: 0 }],
    ['a UID with a slash', { seriesInstanceUID: '1.2/3' }],
    ['a segment number of zero', { segments: [{ number: 0, label: 'A' }] }],
    ['a colour out of range', { segments: [{ number: 1, label: 'A', color: [0, 0, 300] }] }],
    ['a position that is not three numbers', { frames: [{ position: [1, 2] }] }],
  ])('refuses %s', (_name, change) => {
    expect(() => parseSegmentationHeader({ ...valid, ...change })).toThrow(/not readable/);
  });
});
