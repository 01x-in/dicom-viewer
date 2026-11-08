import { describe, expect, it } from 'vitest';
import { isUtf8, repairUtf8 } from './sr-items';

/** What dcmjs makes of text written in UTF-8: one character for each byte, by a browser's "latin1" (Windows-1252). */
function asDcmjsReadsIt(text: string): string {
  const high = new Map([
    [0x80, 0x20ac],
    [0x82, 0x201a],
    [0x83, 0x0192],
    [0x84, 0x201e],
    [0x85, 0x2026],
    [0x86, 0x2020],
    [0x87, 0x2021],
    [0x88, 0x02c6],
    [0x89, 0x2030],
    [0x8a, 0x0160],
    [0x8b, 0x2039],
    [0x8c, 0x0152],
    [0x8e, 0x017d],
    [0x91, 0x2018],
    [0x92, 0x2019],
    [0x93, 0x201c],
    [0x94, 0x201d],
    [0x95, 0x2022],
    [0x96, 0x2013],
    [0x97, 0x2014],
    [0x98, 0x02dc],
    [0x99, 0x2122],
    [0x9a, 0x0161],
    [0x9b, 0x203a],
    [0x9c, 0x0153],
    [0x9e, 0x017e],
    [0x9f, 0x0178],
  ]);
  return [...new TextEncoder().encode(text)]
    .map((byte) => String.fromCharCode(high.get(byte) ?? byte))
    .join('');
}

describe('repairUtf8', () => {
  it('puts text right that was written in UTF-8 and read a byte at a time, for accents, other scripts, and symbols', () => {
    for (const text of [
      'é',
      'Aorte ascendante é',
      '肺 結節',
      'Größe 5 µm',
      'Ωmega ≥ 3 — “quoted”',
      '😀 ok',
    ]) {
      const dataset = { Label: asDcmjsReadsIt(text) };
      repairUtf8(dataset);
      expect(dataset.Label).toBe(text);
    }
  });

  it('works inside sequences and lists, in place, and leaves numbers and plain text alone', () => {
    const inner = { CodeMeaning: asDcmjsReadsIt('naïve') };
    const dataset = {
      ContentSequence: [{ ConceptCodeSequence: inner }, 'plain', 4],
      Count: 3,
    };
    const sequence = dataset.ContentSequence;
    repairUtf8(dataset);
    expect(inner.CodeMeaning).toBe('naïve');
    expect(dataset.ContentSequence).toBe(sequence);
    expect(dataset.ContentSequence.slice(1)).toEqual(['plain', 4]);
    expect(dataset.Count).toBe(3);
  });

  it('leaves text that was Latin-1 all along, and text that is already right', () => {
    const latin1 = { value: 'café' };
    repairUtf8(latin1);
    expect(latin1.value).toBe('café');
    const already = { value: '肺 ok' };
    repairUtf8(already);
    expect(already.value).toBe('肺 ok');
  });
});

describe('isUtf8', () => {
  it('is true for ISO_IR 192, as a value or in a list, and false otherwise', () => {
    expect(isUtf8({ SpecificCharacterSet: 'ISO_IR 192' })).toBe(true);
    expect(isUtf8({ SpecificCharacterSet: ['ISO_IR 192'] })).toBe(true);
    expect(isUtf8({ SpecificCharacterSet: 'ISO_IR 100' })).toBe(false);
    expect(isUtf8({})).toBe(false);
  });
});
