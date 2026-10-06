import { describe, expect, it } from 'vitest';
import { assertFraction, colorToHex, defaultSegmentColor, PALETTE, parseColor } from './model';

describe('defaultSegmentColor', () => {
  it('gives the first segment the first colour, and goes round when the palette ends', () => {
    expect(defaultSegmentColor(1)).toEqual(PALETTE[0]);
    expect(defaultSegmentColor(2)).toEqual(PALETTE[1]);
    expect(defaultSegmentColor(PALETTE.length)).toEqual(PALETTE[PALETTE.length - 1]);
    expect(defaultSegmentColor(PALETTE.length + 1)).toEqual(PALETTE[0]);
  });

  it('gives each of the first twelve segments a colour of its own', () => {
    const colors = new Set(
      Array.from({ length: PALETTE.length }, (_, at) => defaultSegmentColor(at + 1).join(',')),
    );
    expect(colors.size).toBe(PALETTE.length);
  });

  it('copes with a segment number below 1 rather than reading outside the palette', () => {
    expect(defaultSegmentColor(0)).toEqual(PALETTE[0]);
    expect(defaultSegmentColor(-5)).toEqual(PALETTE[0]);
  });
});

describe('parseColor', () => {
  it('reads red, green, and blue', () => {
    expect(parseColor([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseColor([0, 255, 0])).toEqual([0, 255, 0]);
  });

  it('reads CSS hex, short and long, in either case', () => {
    expect(parseColor('#ff8000')).toEqual([255, 128, 0]);
    expect(parseColor('#FF8000')).toEqual([255, 128, 0]);
    expect(parseColor('#f80')).toEqual([255, 136, 0]);
  });

  it.each([
    ['too few channels', [1, 2]],
    ['too many', [1, 2, 3, 4]],
    ['a channel above 255', [0, 0, 256]],
    ['a channel below 0', [-1, 0, 0]],
    ['a fraction', [0.5, 0, 0]],
    ['not a number', [0, 0, Number.NaN]],
    ['a name', 'red'],
    ['hex with no hash', 'ff0000'],
    ['hex with a bad digit', '#gg0000'],
    ['hex of a wrong length', '#ff00'],
    ['nothing', undefined],
    ['an array of three holes', new Array<number>(3)],
    [
      'an array with a hole',
      (() => {
        const holey = new Array<number>(3);
        holey[0] = 1;
        holey[2] = 3;
        return holey;
      })(),
    ],
  ])('refuses %s', (_name, input) => {
    expect(() => parseColor(input)).toThrow(RangeError);
  });
});

describe('colorToHex', () => {
  it('writes lower-case hex that parseColor reads back', () => {
    expect(colorToHex([255, 128, 0])).toBe('#ff8000');
    expect(colorToHex([0, 0, 5])).toBe('#000005');
    expect(parseColor(colorToHex([17, 34, 51]))).toEqual([17, 34, 51]);
  });
});

describe('assertFraction', () => {
  it('accepts 0 to 1, ends included', () => {
    expect(() => {
      assertFraction(0, 'x');
      assertFraction(1, 'x');
      assertFraction(0.25, 'x');
    }).not.toThrow();
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.5', undefined])(
    'refuses %s',
    (value) => {
      expect(() => {
        assertFraction(value, 'The opacity');
      }).toThrow(RangeError);
    },
  );

  it('names what it checked', () => {
    expect(() => {
      assertFraction(2, 'The opacity');
    }).toThrow('The opacity is a number from 0 to 1, not 2.');
  });
});
