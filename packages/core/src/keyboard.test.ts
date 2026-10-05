import { describe, expect, it } from 'vitest';
import { buildKeymap, chordOf, DEFAULT_KEYBINDINGS, normalizeChord } from './keyboard';
import type { PrimaryTool } from './tools';
import { DEFAULT_WINDOW_PRESETS } from './window-presets';

const key = (
  name: string,
  modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
): { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean } => ({
  key: name,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

// A host that passes strings can name a tool that does not exist.
const asTool = (name: string): PrimaryTool => name as PrimaryTool;

describe('chordOf', () => {
  it('names a key press, with its modifiers in a fixed order', () => {
    expect(chordOf(key('ArrowDown'))).toBe('ArrowDown');
    expect(chordOf(key('z', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+z');
    expect(chordOf(key('a', { metaKey: true, altKey: true }))).toBe('Alt+Meta+a');
  });

  it('treats letters as lower case, so caps lock does not matter, but keeps shift', () => {
    expect(chordOf(key('I', { shiftKey: true }))).toBe('Shift+i');
    expect(chordOf(key('i'))).toBe('i');
  });

  it('ignores shift for characters that shift produces, so + and digits work on any layout', () => {
    expect(chordOf(key('+', { shiftKey: true }))).toBe('Plus');
    expect(chordOf(key('1', { shiftKey: true }))).toBe('1');
    expect(chordOf(key('-'))).toBe('-');
  });

  it('names the space bar', () => {
    expect(chordOf(key(' '))).toBe('Space');
  });

  it('has no chord for a modifier on its own', () => {
    expect(chordOf(key('Shift', { shiftKey: true }))).toBeUndefined();
    expect(chordOf(key('Control', { ctrlKey: true }))).toBeUndefined();
  });
});

describe('normalizeChord', () => {
  it('accepts the spellings a person would write', () => {
    expect(normalizeChord('ctrl+shift+Z')).toBe('Ctrl+Shift+z');
    expect(normalizeChord('shift+ctrl+z')).toBe('Ctrl+Shift+z');
    expect(normalizeChord('arrowdown')).toBe('ArrowDown');
    expect(normalizeChord('space')).toBe('Space');
    expect(normalizeChord('Plus')).toBe('Plus');
    expect(normalizeChord('PageDown')).toBe('PageDown');
  });

  it.each(['', '+', 'Ctrl+', 'Ctrl+Ctrl+a', 'Banana+a', 'Ctrl+ab'])('rejects "%s"', (spec) => {
    expect(() => normalizeChord(spec)).toThrow(RangeError);
  });
});

describe('the default keymap', () => {
  const keymap = buildKeymap(DEFAULT_WINDOW_PRESETS, {});

  it('scrolls, zooms, inverts, resets, plays, and picks tools', () => {
    expect(keymap.get('ArrowDown')).toEqual({ type: 'scroll', by: 1 });
    expect(keymap.get('ArrowUp')).toEqual({ type: 'scroll', by: -1 });
    expect(keymap.get('PageDown')).toEqual({ type: 'scroll', by: 10 });
    expect(keymap.get('Home')).toEqual({ type: 'scroll-to', position: 'first' });
    expect(keymap.get('End')).toEqual({ type: 'scroll-to', position: 'last' });
    expect(keymap.get('Plus')).toEqual({ type: 'zoom', factor: 1.25 });
    expect(keymap.get('-')).toEqual({ type: 'zoom', factor: 0.8 });
    expect(keymap.get('i')).toEqual({ type: 'invert' });
    expect(keymap.get('r')).toEqual({ type: 'reset' });
    expect(keymap.get('Space')).toEqual({ type: 'cine' });
    expect(keymap.get('w')).toEqual({ type: 'tool', tool: 'window-level' });
    expect(keymap.get('p')).toEqual({ type: 'tool', tool: 'pan' });
  });

  it('puts the window presets on the digits, in order', () => {
    expect(keymap.get('1')).toEqual({ type: 'preset', id: 'lung' });
    expect(keymap.get('5')).toEqual({ type: 'preset', id: 'liver' });
    expect(keymap.has('6')).toBe(false);
  });

  it('is what DEFAULT_KEYBINDINGS lists, so a host can show it', () => {
    expect(Object.keys(DEFAULT_KEYBINDINGS)).toContain('ArrowDown');
  });
});

describe('buildKeymap', () => {
  it('adds, replaces, and removes bindings', () => {
    const keymap = buildKeymap(DEFAULT_WINDOW_PRESETS, {
      x: { type: 'invert' },
      'ctrl+i': { type: 'reset' },
      i: null,
      ArrowDown: { type: 'scroll', by: 2 },
    });
    expect(keymap.get('x')).toEqual({ type: 'invert' });
    expect(keymap.get('Ctrl+i')).toEqual({ type: 'reset' });
    expect(keymap.has('i')).toBe(false);
    expect(keymap.get('ArrowDown')).toEqual({ type: 'scroll', by: 2 });
  });

  it('refuses a preset the viewer does not have, and a tool that does not exist', () => {
    expect(() =>
      buildKeymap(DEFAULT_WINDOW_PRESETS, { m: { type: 'preset', id: 'muscle' } }),
    ).toThrow(/muscle/);
    expect(() =>
      buildKeymap(DEFAULT_WINDOW_PRESETS, { m: { type: 'tool', tool: asTool('lasso') } }),
    ).toThrow(RangeError);
  });

  it('refuses a scroll or zoom that does nothing', () => {
    expect(() => buildKeymap([], { m: { type: 'scroll', by: 0 } })).toThrow(RangeError);
    expect(() => buildKeymap([], { m: { type: 'zoom', factor: -1 } })).toThrow(RangeError);
  });

  it('refuses two keys that are the same chord', () => {
    expect(() =>
      buildKeymap([], { 'ctrl+x': { type: 'invert' }, 'Ctrl+X': { type: 'reset' } }),
    ).toThrow(/twice/);
  });
});
