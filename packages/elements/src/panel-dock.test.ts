// @vitest-environment jsdom
import { createFakeViewer, type FakeViewer } from '@scope/viewer-core/testing';
import type { PanelDefinition } from '@scope/viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './define';
import type { DvPanelDockElement } from './panel-dock';

const open: FakeViewer[] = [];

afterEach(() => {
  document.body.replaceChildren();
  for (const fake of open.splice(0)) fake.viewer.destroy();
});

function panel(id: string, overrides: Partial<PanelDefinition> = {}): PanelDefinition {
  return {
    id,
    title: id.toUpperCase(),
    placement: 'left',
    mount: (container) => {
      container.textContent = `content of ${id}`;
    },
    ...overrides,
  };
}

async function mount(
  placement: 'left' | 'right' = 'left',
): Promise<{ dock: DvPanelDockElement; fake: FakeViewer }> {
  const fake = createFakeViewer();
  open.push(fake);
  const dock = document.createElement('dv-panel-dock') as DvPanelDockElement;
  dock.viewer = fake.viewer;
  dock.placement = placement;
  document.body.append(dock);
  await dock.updateComplete;
  return { dock, fake };
}

const tabs = (dock: DvPanelDockElement): HTMLElement[] => [
  ...(dock.shadowRoot?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
];
const panels = (dock: DvPanelDockElement): HTMLElement[] => [
  ...(dock.shadowRoot?.querySelectorAll<HTMLElement>('[role="tabpanel"]') ?? []),
];
const nth = <T>(list: readonly T[], index: number): T => {
  const found = list.at(index);
  if (found === undefined) throw new Error(`No item at ${index.toString()}`);
  return found;
};

describe('<dv-panel-dock>', () => {
  it('hides itself with no panels, and shows them as tabs when they are registered', async () => {
    const { dock, fake } = await mount();
    expect(dock.hidden).toBe(true);
    fake.viewer.ui.registerPanel(panel('series'));
    fake.viewer.ui.registerPanel(panel('notes'));
    await dock.updateComplete;
    expect(dock.hidden).toBe(false);
    expect(tabs(dock).map((tab) => tab.textContent.trim())).toEqual(['SERIES', 'NOTES']);
  });

  it('shows a picture on the tab of a built-in panel and only the title on any other', async () => {
    const { dock, fake } = await mount();
    fake.viewer.ui.registerPanel(panel('series'));
    fake.viewer.ui.registerPanel(panel('notes'));
    await dock.updateComplete;
    const [series, notes] = tabs(dock);
    expect(series?.querySelector('svg.icon[aria-hidden="true"]')).not.toBeNull();
    expect(notes?.querySelector('svg')).toBeNull();
  });

  it('folds to a strip of pictures, keeps what the panels hold, and opens on a click on a tab', async () => {
    const { dock, fake } = await mount('right');
    fake.viewer.ui.registerPanel(panel('series', { placement: 'right' }));
    fake.viewer.ui.registerPanel(panel('notes', { placement: 'right' }));
    await dock.updateComplete;
    const collapse = (): HTMLElement => {
      const found = dock.shadowRoot?.querySelector<HTMLElement>('[data-action="collapse"]');
      if (found === null || found === undefined) throw new Error('No collapse button');
      return found;
    };
    expect(collapse().getAttribute('aria-expanded')).toBe('true');
    expect(collapse().getAttribute('aria-label')).toBe('Collapse the right panels');
    const content = nth(panels(dock), 0).textContent;
    collapse().click();
    await dock.updateComplete;
    expect(dock.collapsed).toBe(true);
    expect(dock.hasAttribute('collapsed')).toBe(true);
    expect(collapse().getAttribute('aria-expanded')).toBe('false');
    expect(collapse().getAttribute('aria-label')).toBe('Expand the right panels');
    expect(panels(dock).every((item) => item.hidden)).toBe(true);
    // A folded tab has no text to read, so it is named by its label.
    expect(nth(tabs(dock), 1).getAttribute('aria-label')).toBe('NOTES');
    expect(
      dock.shadowRoot?.querySelector('[role="tablist"]')?.getAttribute('aria-orientation'),
    ).toBe('vertical');
    nth(tabs(dock), 1).click();
    await dock.updateComplete;
    expect(dock.collapsed).toBe(false);
    expect(nth(tabs(dock), 1).getAttribute('aria-selected')).toBe('true');
    expect(nth(panels(dock), 1).hidden).toBe(false);
    expect(nth(panels(dock), 0).textContent).toBe(content);
  });

  it('keeps the collapse button out of the tab list, which holds tabs only', async () => {
    const { dock, fake } = await mount();
    fake.viewer.ui.registerPanel(panel('series'));
    await dock.updateComplete;
    const list = dock.shadowRoot?.querySelector('[role="tablist"]');
    expect(list?.querySelector('[data-action="collapse"]')).toBeNull();
    expect([...(list?.children ?? [])].every((child) => child.getAttribute('role') === 'tab')).toBe(
      true,
    );
  });

  it('shows only the panels of its own side', async () => {
    const { dock, fake } = await mount('right');
    fake.viewer.ui.registerPanel(panel('left-one'));
    fake.viewer.ui.registerPanel(panel('right-one', { placement: 'right' }));
    await dock.updateComplete;
    expect(tabs(dock).map((tab) => tab.dataset['panel'])).toEqual(['right-one']);
  });

  it('wires tabs and panels together for assistive technology', async () => {
    const { dock, fake } = await mount();
    fake.viewer.ui.registerPanel(panel('series'));
    await dock.updateComplete;
    const tab = nth(tabs(dock), 0);
    const body = nth(panels(dock), 0);
    expect(dock.shadowRoot?.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Left panels',
    );
    expect(tab.getAttribute('aria-controls')).toBe(body.id);
    expect(body.getAttribute('aria-labelledby')).toBe(tab.id);
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('fills a panel when it is first shown, not before', async () => {
    const { dock, fake } = await mount();
    const second = vi.fn((container: HTMLElement): void => {
      container.textContent = 'second';
    });
    fake.viewer.ui.registerPanel(panel('first'));
    fake.viewer.ui.registerPanel(panel('second', { mount: second }));
    await dock.updateComplete;
    expect(nth(panels(dock), 0).textContent).toBe('content of first');
    expect(second).not.toHaveBeenCalled();
    nth(tabs(dock), 1).click();
    await dock.updateComplete;
    expect(second).toHaveBeenCalledOnce();
    expect(nth(panels(dock), 1).hidden).toBe(false);
    expect(nth(panels(dock), 0).hidden).toBe(true);
  });

  it('keeps a panel filled while another tab is shown, and does not fill it twice', async () => {
    const { dock, fake } = await mount();
    const mountFirst = vi.fn((container: HTMLElement): void => {
      container.textContent = 'first';
    });
    fake.viewer.ui.registerPanel(panel('first', { mount: mountFirst }));
    fake.viewer.ui.registerPanel(panel('second'));
    await dock.updateComplete;
    nth(tabs(dock), 1).click();
    await dock.updateComplete;
    nth(tabs(dock), 0).click();
    await dock.updateComplete;
    expect(mountFirst).toHaveBeenCalledOnce();
    expect(nth(panels(dock), 0).textContent).toBe('first');
  });

  it('moves between tabs with the arrows, wrapping, and shows the one it lands on', async () => {
    const { dock, fake } = await mount();
    fake.viewer.ui.registerPanel(panel('a'));
    fake.viewer.ui.registerPanel(panel('b'));
    await dock.updateComplete;
    nth(tabs(dock), 0).focus();
    nth(tabs(dock), 0).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await dock.updateComplete;
    expect(dock.shadowRoot?.activeElement).toBe(nth(tabs(dock), 1));
    expect(nth(tabs(dock), 1).getAttribute('aria-selected')).toBe('true');
    expect(tabs(dock).map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    nth(tabs(dock), 1).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await dock.updateComplete;
    expect(nth(tabs(dock), 0).getAttribute('aria-selected')).toBe('true');
  });

  it("runs a panel's cleanup when it is unregistered, and shows the next one", async () => {
    const { dock, fake } = await mount();
    const cleanup = vi.fn();
    const remove = fake.viewer.ui.registerPanel(panel('first', { mount: () => cleanup }));
    fake.viewer.ui.registerPanel(panel('second'));
    await dock.updateComplete;
    remove();
    await dock.updateComplete;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(tabs(dock).map((tab) => tab.dataset['panel'])).toEqual(['second']);
    expect(nth(tabs(dock), 0).getAttribute('aria-selected')).toBe('true');
    expect(nth(panels(dock), 0).textContent).toBe('content of second');
  });

  it('runs cleanups when the dock is removed, and fills the panels again if it comes back', async () => {
    const { dock, fake } = await mount();
    const cleanup = vi.fn();
    const mountIt = vi.fn(() => cleanup);
    fake.viewer.ui.registerPanel(panel('only', { mount: mountIt }));
    await dock.updateComplete;
    dock.remove();
    expect(cleanup).toHaveBeenCalledOnce();
    document.body.append(dock);
    await dock.updateComplete;
    expect(mountIt).toHaveBeenCalledTimes(2);
  });

  it('reports a panel that fails to fill as dv-error, and keeps the other panels', async () => {
    const { dock, fake } = await mount();
    const errors: { error: Error; context: string }[] = [];
    dock.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error; context: string }>).detail);
    });
    fake.viewer.ui.registerPanel(
      panel('broken', {
        mount: () => {
          throw new Error('no good');
        },
      }),
    );
    fake.viewer.ui.registerPanel(panel('fine'));
    await dock.updateComplete;
    expect(errors).toEqual([{ error: expect.any(Error) as Error, context: 'panel' }]);
    nth(tabs(dock), 1).click();
    await dock.updateComplete;
    expect(nth(panels(dock), 1).textContent).toBe('content of fine');
  });

  it('forgets the panels of a viewer it is no longer given', async () => {
    const { dock, fake } = await mount();
    fake.viewer.ui.registerPanel(panel('mine'));
    await dock.updateComplete;
    const other = createFakeViewer();
    open.push(other);
    dock.viewer = other.viewer;
    await dock.updateComplete;
    expect(tabs(dock)).toEqual([]);
    expect(dock.hidden).toBe(true);
  });
});
