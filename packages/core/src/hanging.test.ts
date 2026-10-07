import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HANGING_PROTOCOLS,
  type HangingProtocol,
  isDisplayableModality,
  matchHangingProtocol,
  parseHangingProtocols,
} from './hanging';
import type { SeriesSummary } from './data/types';

const series = (
  uid: number,
  modality: string,
  description?: string,
  instanceCount?: number,
): SeriesSummary => ({
  seriesInstanceUID: `1.2.${uid.toString()}`,
  modality,
  description,
  seriesNumber: uid,
  instanceCount,
});

const ct = series(1, 'CT', 'Chest', 40);
const mr = series(2, 'MR', 'T2 axial', 24);
const seg = series(3, 'SEG', 'Organs', 1);
const ct2 = series(4, 'CT', 'Chest lung window', 60);

describe('isDisplayableModality', () => {
  it('is false for the modalities that hold no picture', () => {
    for (const modality of ['SEG', 'SR', 'KO', 'PR', 'DOC', 'REG', 'RWV']) {
      expect(isDisplayableModality(modality)).toBe(false);
    }
    expect(isDisplayableModality('CT')).toBe(true);
    expect(isDisplayableModality('MR')).toBe(true);
  });
});

describe('matchHangingProtocol', () => {
  const single: HangingProtocol = {
    id: 'single',
    layout: '1x1',
    viewports: [{ id: 'vp-0', series: {} }],
  };
  const pair: HangingProtocol = {
    id: 'pair',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', series: {} },
      { id: 'vp-1', series: {} },
    ],
  };
  const ctMr: HangingProtocol = {
    id: 'ct-mr',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', series: { modality: 'CT' } },
      { id: 'vp-1', series: { modality: 'MR' } },
    ],
  };

  it('gives nothing when there are no protocols or nothing to show', () => {
    expect(matchHangingProtocol([], [ct])).toBeUndefined();
    expect(matchHangingProtocol([single], [])).toBeUndefined();
    expect(matchHangingProtocol([single], [seg])).toBeUndefined();
  });

  it('fills the viewports in order with series that can be shown, never a SEG', () => {
    const result = matchHangingProtocol([pair], [seg, ct, mr]);
    expect(result?.protocol.id).toBe('pair');
    expect(result?.assignments).toEqual([
      { viewportId: 'vp-0', seriesInstanceUID: ct.seriesInstanceUID },
      { viewportId: 'vp-1', seriesInstanceUID: mr.seriesInstanceUID },
    ]);
  });

  it('uses a series once', () => {
    const result = matchHangingProtocol([pair], [ct, mr]);
    const used = result?.assignments.map((entry) => entry.seriesInstanceUID);
    expect(new Set(used).size).toBe(2);
  });

  it('prefers the protocol that fills more viewports', () => {
    expect(matchHangingProtocol([single, pair], [ct, mr])?.protocol.id).toBe('pair');
    expect(matchHangingProtocol([pair, single], [ct])?.protocol.id).toBe('single');
  });

  it('prefers the protocol that names the modality, which is what scores per modality', () => {
    expect(matchHangingProtocol([pair, ctMr], [ct, mr])?.protocol.id).toBe('ct-mr');
    // Without an MR the CT-MR protocol fills one viewport and pair fills two, so pair wins, listed after or not.
    expect(matchHangingProtocol([ctMr, pair], [ct, ct2])?.protocol.id).toBe('pair');
  });

  it('needs the first viewport filled, or the protocol does not apply', () => {
    const mrFirst: HangingProtocol = {
      id: 'mr-first',
      layout: '1x2',
      viewports: [
        { id: 'vp-0', series: { modality: 'MR' } },
        { id: 'vp-1', series: {} },
      ],
    };
    expect(matchHangingProtocol([mrFirst], [ct, ct2])).toBeUndefined();
  });

  it('breaks a tie in favour of the protocol listed first, and of a higher priority', () => {
    const a: HangingProtocol = { ...single, id: 'a' };
    const b: HangingProtocol = { ...single, id: 'b' };
    expect(matchHangingProtocol([a, b], [ct])?.protocol.id).toBe('a');
    expect(matchHangingProtocol([a, { ...b, priority: 1 }], [ct])?.protocol.id).toBe('b');
  });

  it('chooses among a modality list, a description, and a smallest size', () => {
    const lung: HangingProtocol = {
      id: 'lung',
      layout: '1x1',
      viewports: [
        {
          id: 'vp-0',
          series: { modality: ['CT', 'MR'], descriptionIncludes: 'LUNG', minInstances: 50 },
        },
      ],
    };
    const result = matchHangingProtocol([lung], [ct, ct2]);
    expect(result?.assignments).toEqual([
      { viewportId: 'vp-0', seriesInstanceUID: ct2.seriesInstanceUID },
    ]);
    expect(matchHangingProtocol([lung], [ct])).toBeUndefined();
  });

  it('takes the largest series for a viewport that asks for it', () => {
    const biggest: HangingProtocol = {
      id: 'biggest',
      layout: '1x1',
      viewports: [{ id: 'vp-0', series: { pick: 'largest' } }],
    };
    expect(matchHangingProtocol([biggest], [ct, ct2, mr])?.assignments[0]?.seriesInstanceUID).toBe(
      ct2.seriesInstanceUID,
    );
  });

  it('does not change its input', () => {
    const list = [ct, mr];
    const protocols = [pair];
    matchHangingProtocol(protocols, list);
    expect(list).toEqual([ct, mr]);
    expect(protocols).toEqual([pair]);
  });
});

describe('DEFAULT_HANGING_PROTOCOLS', () => {
  it('are valid, and show one series alone, two side by side, and a CT next to an MR', () => {
    expect(parseHangingProtocols(DEFAULT_HANGING_PROTOCOLS)).toEqual(DEFAULT_HANGING_PROTOCOLS);
    expect(matchHangingProtocol(DEFAULT_HANGING_PROTOCOLS, [ct])?.protocol.layout).toBe('1x1');
    expect(matchHangingProtocol(DEFAULT_HANGING_PROTOCOLS, [ct, ct2])?.protocol.layout).toBe('1x2');
    expect(matchHangingProtocol(DEFAULT_HANGING_PROTOCOLS, [ct, mr])?.protocol.id).toBe('ct-mr');
  });
});

describe('parseHangingProtocols', () => {
  it('accepts a valid list, and returns plain data', () => {
    const list = [{ id: 'one', layout: '1x1', viewports: [{ id: 'vp-0', series: {} }] }];
    expect(parseHangingProtocols(list)).toEqual(list);
  });

  it.each([
    ['not a list', {}],
    [
      'an id that is not lower case',
      [{ id: 'One', layout: '1x1', viewports: [{ id: 'vp-0', series: {} }] }],
    ],
    [
      'a layout that does not exist',
      [{ id: 'one', layout: '3x3', viewports: [{ id: 'vp-0', series: {} }] }],
    ],
    [
      'a viewport the layout does not have',
      [
        {
          id: 'one',
          layout: '1x1',
          viewports: [
            { id: 'vp-0', series: {} },
            { id: 'vp-1', series: {} },
          ],
        },
      ],
    ],
    ['no viewport 0', [{ id: 'one', layout: '1x2', viewports: [{ id: 'vp-1', series: {} }] }]],
    [
      'a viewport twice',
      [
        {
          id: 'one',
          layout: '1x2',
          viewports: [
            { id: 'vp-0', series: {} },
            { id: 'vp-0', series: {} },
          ],
        },
      ],
    ],
    [
      'two protocols with one id',
      [
        { id: 'one', layout: '1x1', viewports: [{ id: 'vp-0', series: {} }] },
        { id: 'one', layout: '1x1', viewports: [{ id: 'vp-0', series: {} }] },
      ],
    ],
    [
      'a key it does not know',
      [{ id: 'one', layout: '1x1', color: 'red', viewports: [{ id: 'vp-0', series: {} }] }],
    ],
    [
      'a rule key it does not know',
      [{ id: 'one', layout: '1x1', viewports: [{ id: 'vp-0', series: { colour: 1 } }] }],
    ],
    [
      'a size below zero',
      [{ id: 'one', layout: '1x1', viewports: [{ id: 'vp-0', series: { minInstances: -1 } }] }],
    ],
  ])('refuses %s with a RangeError that says where', (_name, input) => {
    expect(() => parseHangingProtocols(input)).toThrow(RangeError);
  });
});
