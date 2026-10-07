// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function show(h: Harness): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 5 });
}

describe('viewer.commands', () => {
  it('lists the built-in commands, namespaced, and nothing else', () => {
    const { viewer } = harness();
    expect(viewer.commands.list()).toEqual([
      'cine.toggle',
      'preset.apply',
      'tool.set',
      'view.invert',
      'view.reset',
      'view.zoomIn',
      'view.zoomOut',
    ]);
    expect(viewer.commands.has('tool.set')).toBe(true);
    expect(viewer.commands.has('nope.nothing')).toBe(false);
  });

  it('runs tool.set, and says whether it is the tool in use', async () => {
    const h = harness();
    expect(h.viewer.commands.pressed('tool.set', { tool: 'pan' })).toBe(false);
    await h.viewer.commands.run('tool.set', { tool: 'pan' });
    expect(h.viewer.tools.getActive()).toBe('pan');
    expect(h.viewer.commands.pressed('tool.set', { tool: 'pan' })).toBe(true);
  });

  it('runs the view commands on a viewport, and says when a switch is on', async () => {
    const h = harness();
    await show(h);
    expect(h.viewer.commands.pressed('view.invert')).toBe(false);
    await h.viewer.commands.run('view.invert');
    expect(h.viewer.commands.pressed('view.invert')).toBe(true);
    const before = h.viewer.viewports.get('vp-0')?.getView()?.zoom ?? 1;
    await h.viewer.commands.run('view.zoomIn');
    expect(h.viewer.viewports.get('vp-0')?.getView()?.zoom).toBeGreaterThan(before);
    await h.viewer.commands.run('view.reset');
    expect(h.viewer.viewports.get('vp-0')?.getView()?.zoom).toBe(before);
    await h.viewer.commands.run('preset.apply', { id: 'bone' });
    expect(h.viewer.viewports.get('vp-0')?.getView()?.window).toEqual({ center: 480, width: 2500 });
  });

  it('is enabled only when there is a series to act on, except for choosing a tool', async () => {
    const h = harness();
    expect(h.viewer.commands.enabled('view.zoomIn')).toBe(false);
    expect(h.viewer.commands.enabled('tool.set', { tool: 'pan' })).toBe(true);
    await show(h);
    expect(h.viewer.commands.enabled('view.zoomIn')).toBe(true);
  });

  it('rejects an unknown command and arguments that do not fit, with a RangeError', async () => {
    const { viewer } = harness();
    await expect(viewer.commands.run('nope.nothing')).rejects.toThrow(RangeError);
    await expect(viewer.commands.run('tool.set', { tool: 'laser' })).rejects.toThrow(RangeError);
    await expect(viewer.commands.run('tool.set')).rejects.toThrow(RangeError);
    await expect(viewer.commands.run('preset.apply', { id: 3 })).rejects.toThrow(RangeError);
  });

  it('checks a command and its arguments without running it', () => {
    const { viewer } = harness();
    expect(viewer.commands.check('tool.set', { tool: 'pan' })).toBeUndefined();
    expect(viewer.commands.check('view.zoomIn')).toBeUndefined();
    expect(viewer.commands.check('nope.nothing')).toMatch(/no command/i);
    expect(viewer.commands.check('tool.set', { tool: 'laser' })).toMatch(/tool/);
    expect(viewer.viewports.get('vp-0')).toBeUndefined();
  });

  it('runs a command of the host, with the viewer and the viewport', async () => {
    const h = harness();
    const run = vi.fn<(context: { viewportId: string }, args: unknown) => void>();
    const off = h.viewer.commands.register('acme.export', (context, args) => {
      run({ viewportId: context.viewportId }, args);
    });
    await h.viewer.commands.run('acme.export', { all: true }, { viewportId: 'vp-0' });
    expect(run).toHaveBeenCalledWith({ viewportId: 'vp-0' }, { all: true });
    off();
    expect(h.viewer.commands.has('acme.export')).toBe(false);
  });

  it('lets a host command say when it is on, and when it is off limits', () => {
    const h = harness();
    h.viewer.commands.register('acme.flag', {
      run: () => undefined,
      pressed: () => true,
      enabled: () => false,
    });
    expect(h.viewer.commands.pressed('acme.flag')).toBe(true);
    expect(h.viewer.commands.enabled('acme.flag')).toBe(false);
    expect(h.viewer.commands.pressed('acme.other')).toBeUndefined();
  });

  it('refuses an id that is not namespaced, or is taken, including a built-in', () => {
    const { viewer } = harness();
    expect(() => viewer.commands.register('export', () => undefined)).toThrow(RangeError);
    expect(() => viewer.commands.register('Acme.Export', () => undefined)).toThrow(RangeError);
    expect(() => viewer.commands.register('tool.set', () => undefined)).toThrow(/already/);
    viewer.commands.register('acme.once', () => undefined);
    expect(() => viewer.commands.register('acme.once', () => undefined)).toThrow(/already/);
  });

  it('takes the commands of the host at the start, before a config can name them', () => {
    const h = harness({ viewer: { commands: { 'acme.hello': () => undefined } } });
    expect(h.viewer.commands.has('acme.hello')).toBe(true);
  });

  it('turns a failure of a command into a rejection, and tells the host which key matches it', async () => {
    const h = harness();
    h.viewer.commands.register('acme.fail', () => {
      throw new Error('boom');
    });
    await expect(h.viewer.commands.run('acme.fail')).rejects.toThrow('boom');
    expect(h.viewer.commands.keyMatcher('view.zoomIn')?.({ type: 'zoom', factor: 2 })).toBe(true);
    expect(h.viewer.commands.keyMatcher('view.zoomIn')?.({ type: 'zoom', factor: 0.5 })).toBe(
      false,
    );
    expect(
      h.viewer.commands.keyMatcher('tool.set', { tool: 'pan' })?.({ type: 'tool', tool: 'pan' }),
    ).toBe(true);
    expect(h.viewer.commands.keyMatcher('acme.fail')).toBeUndefined();
  });
});
