// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';
import type { ViewerConfigV1 } from './config/types';
import type { WindowPreset } from './window-presets';

destroyViewersAfterEach();

const layer = (body: Omit<ViewerConfigV1, 'version'>): ViewerConfigV1 => ({ version: 1, ...body });

async function show(h: Harness): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  document.body.append(h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 5 });
}

async function press(target: Element, key: string): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
}

const presetIds = (h: Harness): string[] => h.viewer.tools.windowPresets().map((item) => item.id);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('config given at the start', () => {
  it('sets the window presets, the keys, the overlay, and the first tool', () => {
    const h = harness({
      viewer: {
        config: layer({
          windowLevelPresets: [{ id: 'mine', label: 'Mine', center: 1, width: 2 }],
          keybindings: { m: { type: 'tool', tool: 'pan' } },
          overlay: { showPatientInfo: true },
          tools: { active: 'zoom' },
          palette: 'navy',
        }),
      },
    });
    expect(presetIds(h)).toEqual(['mine']);
    expect(h.viewer.tools.shortcuts()).toContainEqual({
      chord: 'm',
      action: { type: 'tool', tool: 'pan' },
    });
    expect(h.viewer.tools.getActive()).toBe('zoom');
    expect(h.viewer.config.get()).toMatchObject({
      palette: 'navy',
      overlay: { showPatientInfo: true },
    });
  });

  it('takes several layers, the last one winning', () => {
    const h = harness({
      viewer: {
        config: [
          layer({ palette: 'navy', theme: 'light' }),
          layer({ palette: 'graphite', keybindings: { m: { type: 'invert' } } }),
        ],
      },
    });
    expect(h.viewer.config.get()).toMatchObject({ palette: 'graphite', theme: 'light' });
  });

  it('is refused whole, with every path named, when it has a problem', () => {
    // What a host would read from a file is `unknown` to the compiler.
    const badTheme = JSON.parse('{"version":1,"theme":"blue"}') as unknown;
    const badVersion = JSON.parse('{"version":2}') as unknown;
    expect(() => harness({ viewer: { config: badTheme as ViewerConfigV1 } })).toThrow(
      /Invalid config:[\s\S]*theme/,
    );
    expect(() =>
      harness({ viewer: { config: [layer({}), badVersion as ViewerConfigV1] } }),
    ).toThrow(/Invalid config\[1\]/);
  });

  it('is what the viewer was before when no config is given', () => {
    const h = harness();
    expect(presetIds(h)).toEqual(['lung', 'soft-tissue', 'bone', 'brain', 'liver']);
    expect(h.viewer.config.get().theme).toBeUndefined();
    expect(h.viewer.config.get().tools.active).toBe('window-level');
  });

  it('is not changed by a later change to the object the host passed', () => {
    const presets: WindowPreset[] = [{ id: 'a', label: 'A', center: 0, width: 1 }];
    const h = harness({ viewer: { config: layer({ windowLevelPresets: presets }) } });
    presets[0] = { id: 'changed', label: 'Changed', center: 0, width: 1 };
    expect(presetIds(h)).toEqual(['a']);
  });
});

describe('the options written in code', () => {
  it('win over the config, and merge with it key by key', () => {
    const h = harness({
      viewer: {
        config: layer({
          windowLevelPresets: [{ id: 'from-config', label: 'C', center: 1, width: 2 }],
          keybindings: { m: { type: 'tool', tool: 'pan' }, n: { type: 'invert' } },
        }),
        windowLevelPresets: [{ id: 'from-code', label: 'K', center: 1, width: 2 }],
        keybindings: { m: null },
      },
    });
    expect(presetIds(h)).toEqual(['from-code']);
    const chords = h.viewer.tools.shortcuts().map((entry) => entry.chord);
    expect(chords).not.toContain('m');
    expect(chords).toContain('n');
  });

  it('still throw for what they always threw for', () => {
    expect(() => harness({ viewer: { keybindings: { 'Ctrl+': { type: 'invert' } } } })).toThrow(
      RangeError,
    );
    expect(() =>
      harness({
        viewer: { keybindings: { 'Shift+i': { type: 'invert' }, 'shift+I': { type: 'reset' } } },
      }),
    ).toThrow(/bound twice/);
  });
});

describe('viewer.config.apply', () => {
  it('puts a layer on, tells the host, and takes it off again', () => {
    const h = harness();
    const off = h.viewer.config.apply(
      layer({ windowLevelPresets: [{ id: 'mine', label: 'Mine', center: 1, width: 2 }] }),
    );
    expect(presetIds(h)).toEqual(['mine']);
    expect(h.events['config:changed']).toHaveLength(1);
    expect(h.events['config:changed'][0]?.config.windowLevelPresets.map((p) => p.id)).toEqual([
      'mine',
    ]);
    off();
    expect(presetIds(h)).toEqual(['lung', 'soft-tissue', 'bone', 'brain', 'liver']);
    expect(h.events['config:changed']).toHaveLength(2);
    // Taking it off twice does nothing the second time.
    off();
    expect(h.events['config:changed']).toHaveLength(2);
  });

  it('puts later layers over earlier ones, and taking one off keeps the other', () => {
    const h = harness();
    const first = h.viewer.config.apply(layer({ palette: 'navy', theme: 'light' }));
    const second = h.viewer.config.apply(layer({ palette: 'graphite' }));
    expect(h.viewer.config.get()).toMatchObject({ palette: 'graphite', theme: 'light' });
    first();
    expect(h.viewer.config.get()).toMatchObject({ palette: 'graphite', theme: undefined });
    second();
    expect(h.viewer.config.get().palette).toBeUndefined();
  });

  it('wins over the options written in code', () => {
    const h = harness({
      viewer: { windowLevelPresets: [{ id: 'from-code', label: 'K', center: 1, width: 2 }] },
    });
    const off = h.viewer.config.apply(
      layer({ windowLevelPresets: [{ id: 'later', label: 'L', center: 1, width: 2 }] }),
    );
    expect(presetIds(h)).toEqual(['later']);
    off();
    expect(presetIds(h)).toEqual(['from-code']);
  });

  it('refuses a layer with a problem whole, names each path, and changes nothing', () => {
    const h = harness();
    expect(() =>
      h.viewer.config.apply({ version: 1, palette: 'pink', keybindings: { m: { type: 'x' } } }),
    ).toThrow(/palette[\s\S]*keybindings\.m/);
    expect(() => h.viewer.config.apply('not an object')).toThrow(RangeError);
    expect(h.events['config:changed']).toHaveLength(0);
    expect(h.viewer.config.get().palette).toBeUndefined();
  });

  it('refuses a layer that cannot work together with the rest, and changes nothing', () => {
    const h = harness();
    // A key for a window preset that no layer has.
    expect(() =>
      h.viewer.config.apply(layer({ keybindings: { m: { type: 'preset', id: 'nope' } } })),
    ).toThrow(RangeError);
    expect(h.events['config:changed']).toHaveLength(0);
    expect(h.viewer.tools.shortcuts().some((entry) => entry.chord === 'm')).toBe(false);
  });

  it('refuses a layer with tools, which are read when the viewer starts', () => {
    const h = harness();
    expect(() => h.viewer.config.apply(layer({ tools: { active: 'pan' } }))).toThrow(/tools/);
  });

  it('turns the keyboard on and off for an element that is already attached', async () => {
    const h = harness({ viewer: { keybindings: false } });
    await show(h);
    expect(h.element.hasAttribute('tabindex')).toBe(false);
    await press(h.element, 'i');
    expect(h.viewer.getState().viewports[0]?.invert).toBeFalsy();

    const off = h.viewer.config.apply(layer({ keybindings: { m: { type: 'tool', tool: 'pan' } } }));
    expect(h.element.getAttribute('tabindex')).toBe('0');
    await press(h.element, 'm');
    expect(h.viewer.tools.getActive()).toBe('pan');

    off();
    expect(h.element.hasAttribute('tabindex')).toBe(false);
    await press(h.element, 'w');
    expect(h.viewer.tools.getActive()).toBe('pan');
  });

  it('changes what a key does without listening twice', async () => {
    const h = harness();
    await show(h);
    const off = h.viewer.config.apply(
      layer({ keybindings: { i: { type: 'reset' }, m: { type: 'invert' } } }),
    );
    await press(h.element, 'm');
    expect(h.viewer.getState().viewports[0]?.invert).toBe(true);
    off();
    await press(h.element, 'm');
    expect(h.viewer.getState().viewports[0]?.invert).toBe(true);
    await press(h.element, 'i');
    expect(h.viewer.getState().viewports[0]?.invert).toBeFalsy();
  });

  it('removes the overlay for a stack on screen, and draws it again when the layer comes off', async () => {
    const h = harness();
    await show(h);
    expect(h.element.querySelector('.dv-overlay')).not.toBeNull();
    const off = h.viewer.config.apply(layer({ overlay: false }));
    expect(h.element.querySelector('.dv-overlay')).toBeNull();
    off();
    const text = h.element.querySelector('[data-dv-corner="bottom-right"]')?.textContent;
    expect(text).toBe('Image 6 / 10');
  });

  it('does nothing after the viewer is destroyed', () => {
    const h = harness();
    const off = h.viewer.config.apply(layer({ palette: 'navy' }));
    h.viewer.destroy();
    expect(() => {
      off();
    }).not.toThrow();
    expect(() => h.viewer.config.apply(layer({ palette: 'navy' }))).toThrow();
  });

  describe('overlay items in the config', () => {
    const corner = (h: Harness, name: string): string | undefined =>
      h.element.querySelector(`[data-dv-corner="${name}"]`)?.textContent;

    it('add a line from a tag to the overlay on screen, and take it off with the layer', async () => {
      const h = harness();
      await show(h);
      expect(corner(h, 'top-right')).toBe('CT\n512 \u00d7 256');
      const off = h.viewer.config.apply(
        layer({
          overlay: {
            corners: {
              topRight: [
                { id: 'rows', kind: 'tag', tag: 'Rows', label: 'Rows', format: 'number' },
                { id: 'size', kind: 'remove' },
              ],
            },
          },
        }),
      );
      expect(corner(h, 'top-right')).toBe('CT\nRows 256');
      off();
      expect(corner(h, 'top-right')).toBe('CT\n512 \u00d7 256');
    });

    it('keep a patient tag off the picture until showPatientInfo is on, from any layer', async () => {
      const h = harness({
        viewer: {
          config: layer({
            overlay: {
              corners: {
                topLeft: [{ id: 'name', kind: 'tag', tag: 'PatientName', format: 'person-name' }],
              },
            },
          }),
        },
      });
      await show(h);
      expect(corner(h, 'top-left')).toBe('CT');
      const off = h.viewer.config.apply(layer({ overlay: { showPatientInfo: true } }));
      expect(corner(h, 'top-left')).toContain('DOE JANE');
      off();
      expect(corner(h, 'top-left')).toBe('CT');
    });

    it('take the items from the options in code, over the config', async () => {
      const h = harness({
        viewer: {
          config: layer({
            overlay: { corners: { bottomRight: [{ id: 'image', kind: 'remove' }] } },
          }),
          overlay: {
            corners: { bottomRight: [{ id: 'image', kind: 'builtin', name: 'modality' }] },
          },
        },
      });
      await show(h);
      expect(corner(h, 'bottom-right')).toBe('CT');
    });
  });

  describe('a toolbar in the config', () => {
    const button = (command: string, args?: unknown): ViewerConfigV1 =>
      layer({
        toolbar: {
          items: [
            {
              type: 'command',
              id: 'one',
              label: 'One',
              command,
              ...(args === undefined ? {} : { args }),
            },
          ],
        },
      });

    it('is kept when every command it names exists', () => {
      const h = harness({
        viewer: {
          commands: { 'acme.export': () => undefined },
          config: button('acme.export'),
        },
      });
      expect(h.viewer.config.get().toolbar.items).toHaveLength(1);
    });

    it('is refused at the start when it names a command that is not there, with the path', () => {
      expect(() => harness({ viewer: { config: button('acme.export') } })).toThrow(
        /Invalid config:\ntoolbar\.items\.0\.command: There is no command "acme\.export"/,
      );
    });

    it('is refused when a command is given arguments it will not take', () => {
      expect(() => harness({ viewer: { config: button('tool.set', { tool: 'laser' }) } })).toThrow(
        /toolbar\.items\.0\.command/,
      );
    });

    it('is checked when a layer is applied, and a layer that names a command of the host works once it is registered', () => {
      const h = harness();
      expect(() => h.viewer.config.apply(button('acme.export'))).toThrow(RangeError);
      expect(h.events['config:changed']).toHaveLength(0);
      h.viewer.commands.register('acme.export', () => undefined);
      const off = h.viewer.config.apply(button('acme.export'));
      expect(h.viewer.config.get().toolbar.items).toHaveLength(1);
      off();
      expect(h.viewer.config.get().toolbar.items).toBeUndefined();
    });
  });
});
