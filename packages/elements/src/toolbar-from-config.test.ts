// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@01x/dicom-viewer-core/testing';
import type { ToolbarItemConfig } from '@01x/dicom-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem, MenuItem, ToolbarContext } from './toolbar-config';
import { toolbarFromConfig } from './toolbar-from-config';

const open: FakeViewer[] = [];
afterEach(() => {
  for (const fake of open.splice(0)) fake.viewer.destroy();
});

async function made(): Promise<{ fake: FakeViewer; context: ToolbarContext }> {
  const fake = createFakeViewer();
  open.push(fake);
  fake.viewer.viewports.attach('vp-0', document.createElement('div'));
  await fake.viewer.loadStudy(FAKE_IDS.study);
  await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
  return { fake, context: { viewer: fake.viewer, viewportId: 'vp-0' } };
}

const ITEMS: ToolbarItemConfig[] = [
  { type: 'tool', tool: 'pan', label: 'Move', icon: 'pan' },
  { type: 'separator' },
  { type: 'command', id: 'zoom-in', label: 'Zoom in', icon: 'zoom-in', command: 'view.zoomIn' },
  { type: 'command', id: 'flip', label: 'Flip', icon: 'no-such-picture', command: 'view.invert' },
  {
    type: 'menu',
    id: 'windows',
    label: 'Windows',
    icon: 'presets',
    items: [
      { id: 'bone', label: 'Bone', command: 'preset.apply', args: { id: 'bone' } },
      { id: 'pan', label: 'Pan', command: 'tool.set', args: { tool: 'pan' } },
    ],
  },
];

describe('toolbarFromConfig', () => {
  it('turns each kind of item into the item the toolbar draws', async () => {
    const { fake } = await made();
    const items = toolbarFromConfig(ITEMS, fake.viewer);
    expect(items.map((item) => item.type)).toEqual([
      'tool',
      'separator',
      'action',
      'action',
      'menu',
    ]);
    expect(items[0]).toEqual({ type: 'tool', tool: 'pan', label: 'Move', icon: 'pan' });
    const zoom = items[2] as ActionItem;
    expect(zoom).toMatchObject({ id: 'zoom-in', label: 'Zoom in', icon: 'zoom-in' });
  });

  it('gives a picture only when the shell has one of that name, so any other name is a text button', async () => {
    const { fake } = await made();
    const flip = toolbarFromConfig(ITEMS, fake.viewer)[3] as ActionItem;
    expect(flip.icon).toBeUndefined();
    expect(flip.label).toBe('Flip');
  });

  it('runs the command of a button, on the viewport of the toolbar', async () => {
    const { fake, context } = await made();
    const run = vi.fn<(viewportId: string, args: unknown) => void>();
    fake.viewer.commands.register('acme.go', (c, args) => {
      run(c.viewportId, args);
    });
    const [button] = toolbarFromConfig(
      [{ type: 'command', id: 'go', label: 'Go', command: 'acme.go', args: { a: 1 } }],
      fake.viewer,
    ) as [ActionItem];
    await button.run(context);
    expect(run).toHaveBeenCalledWith('vp-0', { a: 1 });
  });

  it('asks the command whether it is on, and only for a command that can say', async () => {
    const { fake, context } = await made();
    const items = toolbarFromConfig(ITEMS, fake.viewer);
    const zoom = items[2] as ActionItem;
    const flip = items[3] as ActionItem;
    expect('pressed' in zoom).toBe(false);
    expect(flip.pressed?.(context)).toBe(false);
    await fake.viewer.commands.run('view.invert');
    expect(flip.pressed?.(context)).toBe(true);
  });

  it('prints the key that is bound to the command a button runs', async () => {
    const { fake } = await made();
    const items = toolbarFromConfig(ITEMS, fake.viewer);
    const zoom = items[2] as ActionItem;
    const keys = fake.viewer.tools.shortcuts().filter((entry) => zoom.shortcut?.(entry.action));
    expect(keys.map((entry) => entry.chord)).toContain('Plus');
  });

  it('builds a menu whose entries run commands, and whose tool entry is a choice', async () => {
    const { fake, context } = await made();
    const menu = toolbarFromConfig(ITEMS, fake.viewer)[4] as MenuItem;
    const entries = typeof menu.items === 'function' ? menu.items(context) : menu.items;
    expect(entries.map((entry) => entry.id)).toEqual(['bone', 'pan']);
    const [bone, pan] = entries;
    // Bone is an action that cannot say whether it is on, so it is a plain entry.
    expect(bone?.pressed).toBeUndefined();
    expect(pan?.pressed?.(context)).toBe(false);
    await pan?.run(context);
    expect(pan?.pressed?.(context)).toBe(true);
    await bone?.run(context);
    expect(fake.viewer.viewports.get('vp-0')?.getView()?.window).toEqual({
      center: 480,
      width: 2500,
    });
  });

  it('is enabled the way the command is: a view command needs a series, a tool does not', () => {
    const fake = createFakeViewer();
    open.push(fake);
    const context: ToolbarContext = { viewer: fake.viewer, viewportId: 'vp-0' };
    const items = toolbarFromConfig(ITEMS, fake.viewer);
    expect((items[2] as ActionItem).enabled?.(context)).toBe(false);
    const menu = items[4] as MenuItem;
    const entries = typeof menu.items === 'function' ? menu.items(context) : menu.items;
    expect(entries[1]?.enabled?.(context)).toBe(true);
  });
});
