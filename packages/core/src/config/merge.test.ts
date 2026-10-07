import { describe, expect, it } from 'vitest';
import { mergeLayers, resolveConfig } from './merge';

describe('mergeLayers', () => {
  it('lets a later scalar win and keeps what the later layer does not mention', () => {
    const merged = mergeLayers([{ theme: 'dark', palette: 'navy' }, { theme: 'light' }]);
    expect(merged).toEqual({ theme: 'light', palette: 'navy' });
  });

  it('puts a top-level key back to its default with null', () => {
    const merged = mergeLayers([{ palette: 'navy', theme: 'light' }, { palette: null }]);
    expect(merged).toEqual({ theme: 'light' });
  });

  it('merges objects key by key', () => {
    const merged = mergeLayers([{ toolbar: { labels: 'inline' } }, { toolbar: { hidden: true } }]);
    expect(merged).toEqual({ toolbar: { labels: 'inline', hidden: true } });
  });

  it('replaces the toolbar items, and keeps the labels of the earlier layer', () => {
    const merged = mergeLayers([
      { toolbar: { labels: 'inline', items: [{ type: 'separator' }] } },
      { toolbar: { items: [{ type: 'tool', tool: 'pan' }] } },
    ]);
    expect(merged.toolbar).toEqual({ labels: 'inline', items: [{ type: 'tool', tool: 'pan' }] });
  });

  it('merges keybindings key by key, writes chords the way the keymap does, and keeps a removal', () => {
    const merged = mergeLayers([
      { keybindings: { 'Shift+I': { type: 'invert' }, r: null } },
      { keybindings: { 'shift+i': { type: 'reset' }, m: { type: 'tool', tool: 'pan' } } },
    ]);
    expect(merged.keybindings).toEqual({
      'Shift+i': { type: 'reset' },
      r: null,
      m: { type: 'tool', tool: 'pan' },
    });
  });

  it('lets false turn the keyboard off, and a later record turn it on again', () => {
    expect(mergeLayers([{ keybindings: { r: null } }, { keybindings: false }]).keybindings).toBe(
      false,
    );
    expect(
      mergeLayers([{ keybindings: false }, { keybindings: { m: { type: 'invert' } } }]).keybindings,
    ).toEqual({ m: { type: 'invert' } });
  });

  it('replaces an array that has no ids, such as the panels to hide, and the window presets', () => {
    const merged = mergeLayers([
      {
        panels: { hide: ['series'] },
        windowLevelPresets: [{ id: 'a', label: 'A', center: 1, width: 2 }],
      },
      {
        panels: { hide: ['segmentations'] },
        windowLevelPresets: [{ id: 'b', label: 'B', center: 3, width: 4 }],
      },
    ]);
    expect(merged.panels).toEqual({ hide: ['segmentations'] });
    expect(merged.windowLevelPresets?.map((preset) => preset.id)).toEqual(['b']);
  });

  it('lets false turn the overlay off, and a later object turn it on again', () => {
    expect(mergeLayers([{ overlay: { showPatientInfo: true } }, { overlay: false }]).overlay).toBe(
      false,
    );
    expect(
      mergeLayers([{ overlay: false }, { overlay: { showPatientInfo: true } }]).overlay,
    ).toEqual({ showPatientInfo: true });
  });

  it('does not change the layers it is given', () => {
    const first = { keybindings: { r: null } };
    const frozen = JSON.stringify(first);
    mergeLayers([first, { keybindings: { m: { type: 'invert' } } }]);
    expect(JSON.stringify(first)).toBe(frozen);
  });

  it('throws a RangeError for a chord that cannot be pressed', () => {
    expect(() => mergeLayers([{ keybindings: { 'Ctrl+': { type: 'invert' } } }])).toThrow(
      RangeError,
    );
  });
});

describe('resolveConfig', () => {
  it('is the defaults for no layers: no theme or palette chosen, the usual presets, the keyboard on', () => {
    const resolved = resolveConfig([]);
    expect(resolved.theme).toBeUndefined();
    expect(resolved.palette).toBeUndefined();
    expect(resolved.toolbar).toEqual({ labels: undefined, hidden: false, items: undefined });
    expect(resolved.keybindings).toEqual({});
    expect(resolved.overlay).toEqual({ showPatientInfo: false });
    expect(resolved.panels).toEqual({ hide: [] });
    expect(resolved.windowLevelPresets.map((preset) => preset.id)).toEqual([
      'lung',
      'soft-tissue',
      'bone',
      'brain',
      'liver',
    ]);
    expect(resolved.tools).toEqual({ active: 'window-level' });
  });

  it('takes what the layers say over the defaults', () => {
    const resolved = resolveConfig([
      { theme: 'light', palette: 'graphite', tools: { active: 'pan' }, overlay: false },
    ]);
    expect(resolved).toMatchObject({
      theme: 'light',
      palette: 'graphite',
      tools: { active: 'pan' },
      overlay: false,
    });
  });
});
