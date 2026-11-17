import { describe, expect, it } from 'vitest';
import { cineRateOf } from './cine';
import type { DicomJsonInstance } from './data/types';

const tag = (id: string, value: unknown): DicomJsonInstance => ({
  [id]: { vr: 'DS', Value: [value] },
});

describe('cineRateOf', () => {
  it('is nothing for an image that says nothing about its rate', () => {
    expect(cineRateOf({})).toBeUndefined();
  });

  it('takes the recommended display rate first', () => {
    expect(
      cineRateOf({
        ...tag('00082144', 30),
        ...tag('00180040', 15),
        ...tag('00181063', 100),
      }),
    ).toBe(30);
  });

  it('takes the cine rate when there is no recommended rate', () => {
    expect(cineRateOf({ ...tag('00180040', 15), ...tag('00181063', 100) })).toBe(15);
  });

  it('works the rate out from the frame time, which is in milliseconds', () => {
    expect(cineRateOf(tag('00181063', 40))).toBe(25);
    expect(cineRateOf(tag('00181063', '33.333333'))).toBeCloseTo(30, 2);
  });

  it('keeps the rate within what cine can play', () => {
    expect(cineRateOf(tag('00180040', 120))).toBe(60);
    expect(cineRateOf(tag('00181063', 1))).toBe(60);
  });

  it.each([[0], [-5], ['abc'], [Number.NaN]])(
    'ignores a value of %j and goes on to the next',
    (bad) => {
      expect(cineRateOf({ ...tag('00082144', bad), ...tag('00181063', 50) })).toBe(20);
      expect(cineRateOf(tag('00181063', bad))).toBeUndefined();
    },
  );

  it('reads a value that is a number written as text', () => {
    expect(cineRateOf(tag('00180040', '24'))).toBe(24);
  });
});
