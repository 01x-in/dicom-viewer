import { describe, expect, it } from 'vitest';
import { parseViewerConfig } from './schema';

function errorsOf(input: unknown): readonly string[] {
  const result = parseViewerConfig(input);
  if (result.ok) throw new Error('The config was accepted.');
  return result.errors;
}

describe('parseViewerConfig', () => {
  it('accepts a config that has only its version', () => {
    expect(parseViewerConfig({ version: 1 })).toEqual({ ok: true, config: { version: 1 } });
  });

  it('accepts every key of the config', () => {
    const config = {
      version: 1,
      theme: 'light',
      palette: 'navy',
      toolbar: { labels: 'inline', hidden: false },
      keybindings: {
        m: { type: 'tool', tool: 'length' },
        'Shift+i': { type: 'invert' },
        r: null,
        ArrowDown: { type: 'scroll', by: 2 },
        End: { type: 'scroll-to', position: 'last' },
        Plus: { type: 'zoom', factor: 1.5 },
        1: { type: 'preset', id: 'lung' },
        Space: { type: 'cine' },
        Delete: { type: 'delete-measurement' },
        z: { type: 'reset' },
      },
      overlay: { showPatientInfo: true },
      panels: { hide: ['series', 'segmentations'] },
      windowLevelPresets: [{ id: 'mediastinum', label: 'Mediastinum', center: 50, width: 350 }],
      tools: { active: 'pan' },
    };
    expect(parseViewerConfig(config)).toEqual({ ok: true, config });
  });

  it('accepts false for the keyboard and the overlay, and null for a key that goes back to its default', () => {
    expect(parseViewerConfig({ version: 1, keybindings: false, overlay: false }).ok).toBe(true);
    expect(parseViewerConfig({ version: 1, palette: null, toolbar: null, tools: null }).ok).toBe(
      true,
    );
  });

  it('is not a config when it is not an object, or has another version', () => {
    expect(errorsOf(null)[0]).toContain('config');
    expect(errorsOf('{"version":1}')[0]).toContain('config');
    expect(errorsOf({ version: 2 }).join()).toContain('version');
    expect(errorsOf({}).join()).toContain('version');
  });

  it('refuses a key it does not know, and names it, so a typo is found', () => {
    expect(errorsOf({ version: 1, pallete: 'navy' }).join()).toContain('pallete');
    expect(errorsOf({ version: 1, toolbar: { lables: 'inline' } }).join()).toContain('toolbar');
  });

  it('names the path of each problem', () => {
    const errors = errorsOf({
      version: 1,
      theme: 'blue',
      toolbar: { labels: 'big' },
      keybindings: { m: { type: 'explode' } },
      windowLevelPresets: [{ id: 'a', label: 'A', center: 0, width: 0 }],
    });
    const text = errors.join('\n');
    expect(text).toContain('theme');
    expect(text).toContain('toolbar.labels');
    expect(text).toContain('keybindings.m');
    expect(text).toContain('windowLevelPresets.0.width');
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses a chord that cannot be pressed, and two spellings of one chord', () => {
    expect(errorsOf({ version: 1, keybindings: { 'Ctrl+': { type: 'invert' } } }).join()).toContain(
      'keybindings',
    );
    expect(
      errorsOf({
        version: 1,
        keybindings: { 'Shift+i': { type: 'invert' }, 'shift+I': { type: 'reset' } },
      }).join(),
    ).toContain('twice');
  });

  it('refuses a tool that does not exist, a zoom factor of 1, and a scroll of 0', () => {
    expect(errorsOf({ version: 1, tools: { active: 'laser' } }).join()).toContain('tools.active');
    expect(
      errorsOf({ version: 1, keybindings: { m: { type: 'zoom', factor: 1 } } }).join(),
    ).toContain('keybindings.m');
    expect(
      errorsOf({ version: 1, keybindings: { m: { type: 'scroll', by: 0 } } }).join(),
    ).toContain('keybindings.m');
  });

  it('refuses window presets with the same id', () => {
    const preset = { id: 'a', label: 'A', center: 0, width: 1 };
    expect(errorsOf({ version: 1, windowLevelPresets: [preset, preset] }).join()).toContain(
      'windowLevelPresets',
    );
  });

  it('refuses a panel that is not built in', () => {
    expect(errorsOf({ version: 1, panels: { hide: ['notes'] } }).join()).toContain('panels.hide');
  });

  it('does not let the result be changed through the input', () => {
    const input = { version: 1, panels: { hide: ['series'] } };
    const result = parseViewerConfig(input);
    input.panels.hide.push('measurements');
    expect(result.ok && result.config.panels?.hide).toEqual(['series']);
  });
});
