import { describe, expect, it } from 'vitest';
import { PRIMARY_TOOLS } from '../tools';
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

  it('does not let the arguments of a toolbar command be changed through the input', () => {
    const args = { id: 'lung', nested: [1, 2] };
    const input = {
      version: 1,
      toolbar: {
        items: [{ type: 'command', id: 'lung', label: 'Lung', command: 'preset.apply', args }],
      },
    };
    const result = parseViewerConfig(input);
    args.nested.push(3);
    args.id = 'changed';
    const item = result.ok ? result.config.toolbar?.items?.[0] : undefined;
    expect(item?.type === 'command' && item.args).toEqual({ id: 'lung', nested: [1, 2] });
  });

  it('accepts a toolbar written as data: tools, command buttons, menus, and separators', () => {
    const toolbar = {
      labels: 'inline',
      items: [
        { type: 'tool', tool: 'pan', label: 'Move', icon: 'pan' },
        { type: 'separator' },
        {
          type: 'command',
          id: 'zoom-in',
          label: 'Zoom in',
          icon: 'zoom-in',
          command: 'view.zoomIn',
        },
        {
          type: 'menu',
          id: 'windows',
          label: 'Windows',
          items: [
            { id: 'bone', label: 'Bone', command: 'preset.apply', args: { id: 'bone' } },
            { id: 'lung', label: 'Lung', command: 'preset.apply', args: { id: 'lung' } },
          ],
        },
      ],
    };
    expect(parseViewerConfig({ version: 1, toolbar })).toEqual({
      ok: true,
      config: { version: 1, toolbar },
    });
  });

  it('refuses toolbar items that cannot work, and names each path', () => {
    const errors = errorsOf({
      version: 1,
      toolbar: {
        items: [
          { type: 'button', id: 'a', label: 'A', command: 'x.y' },
          { type: 'command', id: 'Bad Id', label: 'B', command: 'x.y' },
          { type: 'menu', id: 'm', label: 'M', items: [] },
          { type: 'command', id: 'f', label: 'F', command: 'x.y', args: { run: () => 1 } },
          { type: 'tool', tool: 'laser' },
          { type: 'separator', id: 'extra' },
        ],
      },
    }).join('\n');
    expect(errors).toContain('toolbar.items.0');
    expect(errors).toContain('toolbar.items.1.id');
    expect(errors).toContain('toolbar.items.2.items');
    expect(errors).toContain('toolbar.items.3.args');
    expect(errors).toContain('toolbar.items.4.tool');
    expect(errors).toContain('toolbar.items.5');
  });

  it('refuses two toolbar buttons with one id', () => {
    const button = { type: 'command', id: 'dup', label: 'A', command: 'x.y' };
    expect(errorsOf({ version: 1, toolbar: { items: [button, button] } }).join()).toContain(
      'toolbar.items.1.id',
    );
  });

  it('refuses two menu entries with one id', () => {
    const entry = { id: 'a', label: 'A', command: 'x.y' };
    expect(
      errorsOf({
        version: 1,
        toolbar: { items: [{ type: 'menu', id: 'm', label: 'M', items: [entry, entry] }] },
      }).join(),
    ).toContain('toolbar.items.0.items.1.id');
  });

  it('accepts overlay items: lines of its own, tags by keyword or by number, and removals', () => {
    const overlay = {
      showPatientInfo: false,
      corners: {
        topLeft: [{ id: 'patientId', kind: 'remove' }],
        topRight: [
          { id: 'kvp', kind: 'tag', tag: 'KVP', label: 'kVp', format: 'number', decimals: 1 },
          { id: 'protocol', kind: 'tag', tag: '00181030' },
          { id: 'size', kind: 'builtin', name: 'size' },
        ],
      },
    };
    expect(parseViewerConfig({ version: 1, overlay })).toEqual({
      ok: true,
      config: { version: 1, overlay },
    });
  });

  it('refuses overlay items that cannot work, and names each path', () => {
    const errors = errorsOf({
      version: 1,
      overlay: {
        corners: {
          topLeft: [
            { id: 'a', kind: 'tag', tag: 'NotAKeyword' },
            { id: 'b', kind: 'builtin', name: 'colour' },
            { id: 'c', kind: 'tag', tag: 'KVP', format: 'hex' },
            { id: 'd', kind: 'tag', tag: 'KVP', decimals: 20 },
            { id: 'Bad Id', kind: 'remove' },
            { id: 'e', kind: 'remove', extra: 1 },
          ],
          middle: [],
        },
      },
    }).join('\n');
    expect(errors).toContain('overlay.corners.topLeft.0.tag');
    expect(errors).toContain('overlay.corners.topLeft.1.name');
    expect(errors).toContain('overlay.corners.topLeft.2.format');
    expect(errors).toContain('overlay.corners.topLeft.3.decimals');
    expect(errors).toContain('overlay.corners.topLeft.4.id');
    expect(errors).toContain('overlay.corners.topLeft.5');
    expect(errors).toContain('middle');
  });

  it('refuses two overlay items of one corner with one id, and a corner with too many lines', () => {
    const item = { id: 'a', kind: 'builtin', name: 'series' };
    expect(
      errorsOf({ version: 1, overlay: { corners: { topLeft: [item, item] } } }).join(),
    ).toContain('overlay.corners.topLeft.1.id');
    const many = Array.from({ length: 13 }, (_, index) => ({
      id: `line-${index.toString()}`,
      kind: 'builtin',
      name: 'series',
    }));
    expect(errorsOf({ version: 1, overlay: { corners: { topLeft: many } } }).join()).toContain(
      'overlay.corners.topLeft',
    );
  });

  it('knows every tool the viewer has, and no other', () => {
    for (const tool of PRIMARY_TOOLS) {
      expect(parseViewerConfig({ version: 1, tools: { active: tool.id } }).ok, tool.id).toBe(true);
    }
    expect(parseViewerConfig({ version: 1, tools: { active: 'laser' } }).ok).toBe(false);
  });

  it('shows the problem inside an option of a union, not a bare "no option matched"', () => {
    expect(errorsOf({ version: 1, overlay: { showPatientInfo: 'yes' } }).join()).toContain(
      'overlay.showPatientInfo',
    );
    expect(errorsOf({ version: 1, keybindings: 'm' }).join()).toContain('keybindings');
  });

  it('lets a file name its schema, for an editor', () => {
    expect(parseViewerConfig({ $schema: './viewer-config.schema.json', version: 1 }).ok).toBe(true);
  });
});
