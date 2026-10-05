import { describe, expect, it } from 'vitest';
import { assertWindowPresets, DEFAULT_WINDOW_PRESETS } from './window-presets';

describe('the default window presets', () => {
  it('are the five usual CT windows', () => {
    expect(DEFAULT_WINDOW_PRESETS.map(({ id, width, center }) => [id, width, center])).toEqual([
      ['lung', 1500, -600],
      ['soft-tissue', 400, 40],
      ['bone', 2500, 480],
      ['brain', 80, 40],
      ['liver', 150, 30],
    ]);
  });

  it('are valid', () => {
    expect(() => {
      assertWindowPresets(DEFAULT_WINDOW_PRESETS);
    }).not.toThrow();
  });
});

describe('assertWindowPresets', () => {
  const ok = { id: 'a', label: 'A', center: 0, width: 1 };

  it.each([
    ['a repeated id', [ok, ok]],
    ['an empty id', [{ ...ok, id: '' }]],
    ['a width of zero', [{ ...ok, width: 0 }]],
    ['a center that is not a number', [{ ...ok, center: Number.NaN }]],
  ])('rejects %s', (_name, presets) => {
    expect(() => {
      assertWindowPresets(presets);
    }).toThrow(RangeError);
  });

  it('accepts none at all', () => {
    expect(() => {
      assertWindowPresets([]);
    }).not.toThrow();
  });
});
