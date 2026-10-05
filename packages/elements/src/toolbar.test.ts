// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './define';
import { nextFocusIndex, type ToolbarErrorDetail, type ToolbarItem } from './index';
import type { DvToolbarElement } from './toolbar';

const open: FakeViewer[] = [];

afterEach(() => {
  document.body.replaceChildren();
  for (const fake of open.splice(0)) fake.viewer.destroy();
});

async function mount(
  options: { items?: readonly ToolbarItem[]; withSeries?: boolean } = {},
): Promise<{ toolbar: DvToolbarElement; fake: FakeViewer }> {
  const fake = createFakeViewer();
  open.push(fake);
  const { viewer } = fake;
  if (options.withSeries !== false) {
    viewer.viewports.attach('vp-0', document.createElement('div'));
    await viewer.loadStudy(FAKE_IDS.study);
    await viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
  }
  const toolbar = document.createElement('dv-toolbar') as DvToolbarElement;
  if (options.items !== undefined) toolbar.items = options.items;
  toolbar.viewer = viewer;
  document.body.append(toolbar);
  await toolbar.updateComplete;
  return { toolbar, fake };
}

const buttons = (toolbar: DvToolbarElement): HTMLButtonElement[] => [
  ...(toolbar.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-roving]') ?? []),
];
const button = (toolbar: DvToolbarElement, selector: string): HTMLButtonElement => {
  const found = toolbar.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (found === null || found === undefined) throw new Error(`No ${selector}`);
  return found;
};
const menuItems = (toolbar: DvToolbarElement): HTMLElement[] => [
  ...(toolbar.shadowRoot?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
];
const nth = <T>(list: readonly T[], index: number): T => {
  const found = list.at(index);
  if (found === undefined) throw new Error(`No item at ${index.toString()}`);
  return found;
};
const press = (element: HTMLElement, key: string): void => {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }),
  );
};

describe('nextFocusIndex', () => {
  it('moves with the arrows, wraps, and jumps with Home and End', () => {
    expect(nextFocusIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextFocusIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextFocusIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextFocusIndex('Home', 2, 3)).toBe(0);
    expect(nextFocusIndex('End', 0, 3)).toBe(2);
  });

  it('ignores other keys, and an empty toolbar', () => {
    expect(nextFocusIndex('a', 0, 3)).toBeUndefined();
    expect(nextFocusIndex('ArrowRight', 0, 0)).toBeUndefined();
  });
});

describe('<dv-toolbar>', () => {
  it('is a toolbar with a name, and shadow DOM (it is chrome, not a viewport)', async () => {
    const { toolbar } = await mount();
    const bar = toolbar.shadowRoot?.querySelector('[role="toolbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('Viewer tools');
    expect(bar?.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('shows the four tools, the actions, and the presets menu by default', async () => {
    const { toolbar } = await mount();
    expect(buttons(toolbar).map((item) => item.textContent.trim())).toEqual([
      'Window / level',
      'Pan',
      'Zoom',
      'Scroll',
      'Zoom in',
      'Zoom out',
      'Invert',
      'Reset',
      'Cine',
      'Presets',
    ]);
  });

  it('has one tab stop, and the arrows move it', async () => {
    const { toolbar } = await mount();
    const all = buttons(toolbar);
    expect(all.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    all[0]?.focus();
    press(nth(all, 0), 'ArrowRight');
    expect(toolbar.shadowRoot?.activeElement).toBe(all[1]);
    await toolbar.updateComplete;
    expect(buttons(toolbar).map((item) => item.tabIndex)).toEqual([
      -1, 0, -1, -1, -1, -1, -1, -1, -1, -1,
    ]);
    press(nth(buttons(toolbar), 1), 'End');
    expect(toolbar.shadowRoot?.activeElement).toBe(buttons(toolbar).at(-1));
    press(nth(buttons(toolbar), -1), 'ArrowRight');
    expect(toolbar.shadowRoot?.activeElement).toBe(buttons(toolbar)[0]);
  });

  it('shows which tool is active, and changes it', async () => {
    const { toolbar, fake } = await mount();
    expect(button(toolbar, '[data-tool="window-level"]').getAttribute('aria-pressed')).toBe('true');
    button(toolbar, '[data-tool="pan"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await toolbar.updateComplete;
    expect(fake.viewer.tools.getActive()).toBe('pan');
    expect(button(toolbar, '[data-tool="pan"]').getAttribute('aria-pressed')).toBe('true');
    expect(button(toolbar, '[data-tool="window-level"]').getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('follows a tool changed from outside', async () => {
    const { toolbar, fake } = await mount();
    await fake.viewer.tools.setActive('zoom');
    await toolbar.updateComplete;
    expect(button(toolbar, '[data-tool="zoom"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('runs actions on the viewport, and toggles show their state', async () => {
    const { toolbar, fake } = await mount();
    const invert = button(toolbar, '[data-action="invert"]');
    expect(invert.getAttribute('aria-pressed')).toBe('false');
    invert.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await toolbar.updateComplete;
    expect(fake.viewer.getState().viewports[0]?.invert).toBe(true);
    expect(button(toolbar, '[data-action="invert"]').getAttribute('aria-pressed')).toBe('true');
    button(toolbar, '[data-action="zoom-in"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.viewer.getState().viewports[0]?.zoom).toBe(1.25);
    button(toolbar, '[data-action="reset"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.viewer.getState().viewports[0]?.zoom).toBeUndefined();
    expect(fake.viewer.getState().viewports[0]?.invert).toBeUndefined();
  });

  it('keeps actions in the tab order but marks them unavailable, and does nothing, with no series', async () => {
    const { toolbar, fake } = await mount({ withSeries: false });
    const invert = button(toolbar, '[data-action="invert"]');
    expect(invert.getAttribute('aria-disabled')).toBe('true');
    expect(invert.hasAttribute('disabled')).toBe(false);
    invert.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.viewer.getState().viewports[0]?.invert).toBeUndefined();
    // Tools do not need a series.
    expect(button(toolbar, '[data-tool="pan"]').hasAttribute('aria-disabled')).toBe(false);
  });

  it('reports a failing action as dv-error, and keeps working', async () => {
    const failing: ToolbarItem = {
      type: 'action',
      id: 'boom',
      label: 'Boom',
      enabled: () => true,
      run: () => Promise.reject(new Error('it broke')),
    };
    const { toolbar } = await mount({ items: [failing] });
    const errors: ToolbarErrorDetail[] = [];
    toolbar.addEventListener('dv-error', (event) =>
      errors.push((event as CustomEvent<ToolbarErrorDetail>).detail),
    );
    button(toolbar, '[data-action="boom"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.error.message).toBe('it broke');
    expect(errors[0]?.context).toBe('toolbar');
  });

  it('draws separators, custom items, and the start and end slots', async () => {
    const custom: ToolbarItem = {
      type: 'custom',
      id: 'note',
      render: () => html`<span id="note">hi</span>`,
    };
    const { toolbar } = await mount({ items: [{ type: 'separator' }, custom] });
    expect(toolbar.shadowRoot?.querySelector('[role="separator"]')).not.toBeNull();
    expect(toolbar.shadowRoot?.querySelector('#note')?.textContent).toBe('hi');
    expect(toolbar.shadowRoot?.querySelector('slot[name="start"]')).not.toBeNull();
    expect(toolbar.shadowRoot?.querySelector('slot[name="end"]')).not.toBeNull();
  });
});

describe('the presets menu', () => {
  const opener = (toolbar: DvToolbarElement): HTMLButtonElement =>
    button(toolbar, '[data-menu-id="presets"]');

  it('opens from the keyboard, focuses the first entry, and names itself from its button', async () => {
    const { toolbar } = await mount();
    opener(toolbar).focus();
    press(opener(toolbar), 'ArrowDown');
    await toolbar.updateComplete;
    await toolbar.updateComplete;
    const menu = toolbar.shadowRoot?.querySelector('[role="menu"]');
    expect(opener(toolbar).getAttribute('aria-expanded')).toBe('true');
    expect(menu?.getAttribute('aria-labelledby')).toBe(opener(toolbar).id);
    const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];
    expect(items.map((item) => item.textContent.trim())).toEqual([
      'Lung',
      'Soft tissue',
      'Bone',
      'Brain',
      'Liver',
    ]);
    expect(toolbar.shadowRoot?.activeElement).toBe(items[0]);
  });

  it('moves in the menu with the arrows, and does not leak them to the toolbar', async () => {
    const { toolbar } = await mount();
    opener(toolbar).click();
    await toolbar.updateComplete;
    const items = menuItems(toolbar);
    nth(items, 0).focus();
    press(nth(items, 0), 'ArrowDown');
    expect(toolbar.shadowRoot?.activeElement).toBe(items[1]);
    press(nth(items, 1), 'ArrowRight');
    expect(toolbar.shadowRoot?.activeElement).toBe(items[1]);
    press(nth(items, 1), 'End');
    expect(toolbar.shadowRoot?.activeElement).toBe(items.at(-1));
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    const { toolbar } = await mount();
    opener(toolbar).click();
    await toolbar.updateComplete;
    const first = nth(menuItems(toolbar), 0);
    first.focus();
    press(first, 'Escape');
    await toolbar.updateComplete;
    expect(toolbar.shadowRoot?.querySelector('[role="menu"]')).toBeNull();
    expect(toolbar.shadowRoot?.activeElement).toBe(opener(toolbar));
    expect(opener(toolbar).getAttribute('aria-expanded')).toBe('false');
  });

  it('applies a preset, closes, and returns the focus', async () => {
    const { toolbar, fake } = await mount();
    opener(toolbar).click();
    await toolbar.updateComplete;
    button(toolbar, '[data-action="preset-bone"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await toolbar.updateComplete;
    expect(fake.viewer.getState().viewports[0]?.window).toEqual({ center: 480, width: 2500 });
    expect(toolbar.shadowRoot?.querySelector('[role="menu"]')).toBeNull();
    expect(toolbar.shadowRoot?.activeElement).toBe(opener(toolbar));
  });

  it('shows the presets of this viewer, not the defaults', async () => {
    const fake = createFakeViewer({
      windowLevelPresets: [{ id: 'only', label: 'Only', center: 1, width: 2 }],
    });
    open.push(fake);
    const toolbar = document.createElement('dv-toolbar') as DvToolbarElement;
    toolbar.viewer = fake.viewer;
    document.body.append(toolbar);
    await toolbar.updateComplete;
    opener(toolbar).click();
    await toolbar.updateComplete;
    expect(
      [...(toolbar.shadowRoot?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) =>
        item.textContent.trim(),
      ),
    ).toEqual(['Only']);
  });
});

describe('the toolbar and its viewer', () => {
  it('shows what changed while it was removed once it is put back', async () => {
    const { toolbar, fake } = await mount();
    toolbar.remove();
    await fake.viewer.tools.setActive('zoom');
    document.body.append(toolbar);
    await toolbar.updateComplete;
    expect(button(toolbar, '[data-tool="zoom"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('stops listening to the viewer it had when it is given another, and when it is removed', async () => {
    const { toolbar, fake } = await mount();
    const other = createFakeViewer();
    open.push(other);
    toolbar.viewer = other.viewer;
    await toolbar.updateComplete;
    const refresh = vi.spyOn(toolbar, 'requestUpdate');
    await fake.viewer.tools.setActive('pan');
    expect(refresh).not.toHaveBeenCalled();
    await other.viewer.tools.setActive('pan');
    expect(refresh).toHaveBeenCalled();
    refresh.mockClear();
    toolbar.remove();
    await other.viewer.tools.setActive('zoom');
    expect(refresh).not.toHaveBeenCalled();
  });
});
