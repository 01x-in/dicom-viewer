// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';
import { PRIMARY_TOOLS } from './tools';

destroyViewersAfterEach();

async function show(h: Harness, series = CT): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', series);
}

describe('the tools of a viewer', () => {
  it('lists the tools the left button can drive, with window / level first and the measurements after', () => {
    const { viewer } = harness();
    expect(viewer.tools.list().map((tool) => tool.id)).toEqual([
      'window-level',
      'pan',
      'zoom',
      'stack-scroll',
      'length',
      'bidirectional',
      'ellipse',
      'rectangle',
      'probe',
      'angle',
    ]);
    expect(viewer.tools.list().filter((tool) => tool.kind === 'measure')).toHaveLength(6);
    expect(viewer.tools.list()).toEqual(PRIMARY_TOOLS);
    expect(viewer.tools.getActive()).toBe('window-level');
  });

  it('gives the active tool to every stack it draws', async () => {
    const h = harness();
    await show(h);
    expect(h.port.stacks[0]?.primaryTool).toBe('window-level');
    await h.viewer.tools.setActive('zoom');
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(h.port.stacks[1]?.primaryTool).toBe('zoom');
  });

  it('lets the left button draw a measurement, and gives the tool to the next stack too', async () => {
    const h = harness();
    await show(h);
    await h.viewer.tools.setActive('ellipse');
    expect(h.port.stacks[0]?.primaryTool).toBe('ellipse');
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(h.port.stacks[1]?.primaryTool).toBe('ellipse');
    expect(h.events['tool:active']).toEqual([{ tool: 'ellipse', previous: 'window-level' }]);
  });

  it('starts with the tool the options ask for', async () => {
    const h = harness({ viewer: { tools: { active: 'pan' } } });
    await show(h);
    expect(h.viewer.tools.getActive()).toBe('pan');
    expect(h.port.stacks[0]?.primaryTool).toBe('pan');
  });
});

describe('setActive', () => {
  it('switches the tool on what is shown, and announces it once', async () => {
    const h = harness();
    await show(h);

    await h.viewer.tools.setActive('pan');
    await h.viewer.tools.setActive('pan');

    expect(h.port.stacks[0]?.primaryTool).toBe('pan');
    expect(h.viewer.tools.getActive()).toBe('pan');
    expect(h.events['tool:active']).toEqual([{ tool: 'pan', previous: 'window-level' }]);
  });

  it('works before anything is shown, and the tool is used once something is', async () => {
    const h = harness();
    await h.viewer.tools.setActive('stack-scroll');
    await show(h);
    expect(h.port.stacks[0]?.primaryTool).toBe('stack-scroll');
  });

  it('refuses a tool that does not exist, and leaves the active tool alone', async () => {
    const { viewer } = harness();
    // @ts-expect-error -- the type forbids it; the runtime check is for hosts that pass strings
    await expect(viewer.tools.setActive('lasso')).rejects.toThrow(RangeError);
    expect(viewer.tools.getActive()).toBe('window-level');
  });

  it('rejects an initial tool that does not exist', () => {
    // @ts-expect-error -- the type forbids it
    expect(() => harness({ viewer: { tools: { active: 'lasso' } } })).toThrow(RangeError);
  });

  it('is applied after the calls queued before it', async () => {
    const h = harness();
    await show(h);
    const switching = h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    const choosing = h.viewer.tools.setActive('zoom');
    await Promise.all([switching, choosing]);
    expect(h.port.stacks[1]?.primaryTool).toBe('zoom');
  });

  it('fails after destroy', async () => {
    const { viewer } = harness();
    viewer.destroy();
    await expect(viewer.tools.setActive('pan')).rejects.toThrow(/destroyed/);
  });
});

describe('the shortcuts of a viewer', () => {
  it('lists the keys that are bound, so a toolbar can show them', () => {
    const { viewer } = harness();
    const shortcuts = viewer.tools.shortcuts();
    expect(shortcuts).toContainEqual({
      chord: 'w',
      action: { type: 'tool', tool: 'window-level' },
    });
    expect(shortcuts).toContainEqual({ chord: 'Space', action: { type: 'cine' } });
  });

  it('follows what the host rebound or removed', () => {
    const { viewer } = harness({
      viewer: { keybindings: { m: { type: 'tool', tool: 'pan' }, p: null } },
    });
    const shortcuts = viewer.tools.shortcuts();
    expect(shortcuts).toContainEqual({ chord: 'm', action: { type: 'tool', tool: 'pan' } });
    expect(shortcuts.some((entry) => entry.chord === 'p')).toBe(false);
  });

  it('is empty when the keyboard is off', () => {
    const { viewer } = harness({ viewer: { keybindings: false } });
    expect(viewer.tools.shortcuts()).toEqual([]);
  });
});
