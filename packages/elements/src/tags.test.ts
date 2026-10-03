import { describe, expect, it } from 'vitest';
import { ELEMENT_PREFIX, elementTag } from './tags';

describe('elementTag', () => {
  it('prefixes a component name with the library prefix', () => {
    expect(ELEMENT_PREFIX).toBe('dv');
    expect(elementTag('viewer')).toBe('dv-viewer');
    expect(elementTag('segments-panel')).toBe('dv-segments-panel');
  });

  it('rejects names that would make an invalid custom element tag', () => {
    expect(() => elementTag('')).toThrow(/Invalid element name/);
    expect(() => elementTag('Viewer')).toThrow(/Invalid element name/);
    expect(() => elementTag('viewer panel')).toThrow(/Invalid element name/);
    expect(() => elementTag('-viewer')).toThrow(/Invalid element name/);
  });
});
