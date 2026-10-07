// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type { ViewerConfigV1, ViewerOptions } from '@scope/viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DvToolbarElement } from './toolbar';
import type { DvViewerElement, ViewerErrorDetail } from './viewer-element';

const made: FakeViewer[] = [];

vi.mock('@scope/viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@scope/viewer-core/testing');
  return {
    ...actual,
    createViewer: (options: ViewerOptions): unknown => {
      // What the real one would do with the settings: the fake takes the same options.
      const fake = make({
        ...(options.config === undefined ? {} : { config: options.config }),
        ...(options.commands === undefined ? {} : { commands: options.commands }),
      });
      made.push(fake);
      return fake.viewer;
    },
    createDicomWebDataSource: (): object => ({}),
  };
});

await import('./define');
const { elementTag } = await import('./tags');

afterEach(() => {
  document.body.replaceChildren();
  for (const fake of made.splice(0)) fake.viewer.destroy();
});

const layer = (body: Omit<ViewerConfigV1, 'version'>): ViewerConfigV1 => ({ version: 1, ...body });

async function ready(
  setup: (element: DvViewerElement) => void = () => undefined,
): Promise<{ element: DvViewerElement; fake: FakeViewer; errors: ViewerErrorDetail[] }> {
  const element = document.createElement(elementTag('viewer')) as DvViewerElement;
  element.options = { dataSource: createFakeViewer().source };
  element.studyInstanceUid = FAKE_IDS.study;
  const errors: ViewerErrorDetail[] = [];
  element.addEventListener('dv-error', (event) => {
    errors.push((event as CustomEvent<ViewerErrorDetail>).detail);
  });
  setup(element);
  const done = new Promise<void>((resolve) => {
    element.addEventListener('dv-ready', () => {
      resolve();
    });
  });
  document.body.append(element);
  await done;
  await element.updateComplete;
  const fake = made.at(-1);
  if (fake === undefined) throw new Error('No viewer was made');
  return { element, fake, errors };
}

const toolbarOf = (element: DvViewerElement): DvToolbarElement => {
  const found = element.shadowRoot?.querySelector<DvToolbarElement>('dv-toolbar');
  if (found === null || found === undefined) throw new Error('No toolbar');
  return found;
};
const inToolbar = (element: DvViewerElement, selector: string): Element | null =>
  toolbarOf(element).shadowRoot?.querySelector(selector) ?? null;

describe('<dv-viewer config>', () => {
  it('sets the theme and the palette', async () => {
    const { element } = await ready((el) => {
      el.config = layer({ theme: 'light', palette: 'navy' });
    });
    expect(element.getAttribute('data-theme')).toBe('light');
    expect(element.getAttribute('data-palette')).toBe('navy');
  });

  it('takes JSON text, as an attribute gives it, and several layers, the last one winning', async () => {
    const { element } = await ready((el) => {
      el.setAttribute('config', '{"version":1,"palette":"graphite"}');
    });
    expect(element.getAttribute('data-palette')).toBe('graphite');
    const layered = await ready((el) => {
      el.config = [layer({ palette: 'navy', theme: 'light' }), layer({ palette: 'graphite' })];
    });
    expect(layered.element.getAttribute('data-palette')).toBe('graphite');
    expect(layered.element.getAttribute('data-theme')).toBe('light');
  });

  it('yields to what the page set: a theme or palette of its own wins', async () => {
    const { element } = await ready((el) => {
      el.config = layer({ theme: 'light', palette: 'navy' });
      el.theme = 'dark';
      el.palette = 'default';
    });
    expect(element.hasAttribute('data-theme')).toBe(false);
    expect(element.hasAttribute('data-palette')).toBe(false);
  });

  it('is refused whole when it has a problem, with a dv-error that names the path, and the viewer starts without it', async () => {
    // What a host reads from a file is `unknown` to the compiler.
    const bad = JSON.parse('{"version":1,"palette":"pink"}') as unknown;
    const { element, errors } = await ready((el) => {
      el.config = bad as ViewerConfigV1;
    });
    expect(element.status).toBe('ready');
    expect(element.hasAttribute('data-palette')).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('config');
    expect(errors[0]?.error.message).toMatch(/Invalid config:\npalette/);
  });

  it('reports JSON text that is not JSON, and starts without it', async () => {
    const { element, errors } = await ready((el) => {
      el.setAttribute('config', '{not json');
    });
    expect(element.status).toBe('ready');
    expect(errors[0]?.context).toBe('config');
  });

  it('leaves out only the layer that is wrong', async () => {
    const bad = JSON.parse('{"version":3}') as unknown;
    const { element, errors } = await ready((el) => {
      el.config = [layer({ palette: 'navy' }), bad as ViewerConfigV1];
    });
    expect(element.getAttribute('data-palette')).toBe('navy');
    expect(errors[0]?.error.message).toContain('config[1]');
  });

  it('hides the panels it names', async () => {
    const { fake } = await ready((el) => {
      el.config = layer({ panels: { hide: ['series', 'segmentations'] } });
    });
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual(['measurements']);
  });

  it('adds to the panels the page hides, and does not show one the page hid', async () => {
    const { fake } = await ready((el) => {
      el.hideMeasurementsPanel = true;
      el.config = layer({ panels: { hide: ['series'] } });
    });
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual(['segmentations']);
  });

  it('draws the toolbar it describes, with the labels it asks for', async () => {
    const { element } = await ready((el) => {
      el.config = layer({
        toolbar: {
          labels: 'inline',
          items: [
            { type: 'tool', tool: 'pan', label: 'Move' },
            { type: 'separator' },
            {
              type: 'command',
              id: 'zoom-in',
              label: 'Zoom in',
              icon: 'zoom-in',
              command: 'view.zoomIn',
            },
          ],
        },
      });
    });
    expect(inToolbar(element, '[data-tool="pan"]')?.textContent).toContain('Move');
    expect(inToolbar(element, '[data-action="zoom-in"]')).not.toBeNull();
    expect(inToolbar(element, '[data-tool="window-level"]')).toBeNull();
    expect(inToolbar(element, '[data-action="cine"]')).toBeNull();
    expect(toolbarOf(element).labels).toBe('inline');
  });

  it('runs a command of the page from a button of the config', async () => {
    const run = vi.fn<() => void>();
    const { element } = await ready((el) => {
      el.commands = { 'acme.hello': run };
      el.config = layer({
        toolbar: {
          items: [{ type: 'command', id: 'hello', label: 'Hello', command: 'acme.hello' }],
        },
      });
    });
    (inToolbar(element, '[data-action="hello"]') as HTMLElement).click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps the built-in toolbar, and says why, when the config names a command that is not there', async () => {
    const { element, errors } = await ready((el) => {
      el.config = layer({
        palette: 'navy',
        toolbar: { items: [{ type: 'command', id: 'x', label: 'X', command: 'acme.missing' }] },
      });
    });
    expect(element.status).toBe('ready');
    expect(errors[0]?.context).toBe('config');
    expect(errors[0]?.error.message).toContain('toolbar.items.0.command');
    expect(inToolbar(element, '[data-tool="window-level"]')).not.toBeNull();
    expect(element.hasAttribute('data-palette')).toBe(false);
  });

  it('removes the toolbar when the config hides it', async () => {
    const { element } = await ready((el) => {
      el.config = layer({ toolbar: { hidden: true } });
    });
    expect(element.shadowRoot?.querySelector('dv-toolbar')).toBeNull();
  });

  it('follows a layer put on and taken off while it runs', async () => {
    const { element, fake } = await ready();
    expect(element.hasAttribute('data-palette')).toBe(false);
    const off = fake.viewer.config.apply(
      layer({ palette: 'graphite', panels: { hide: ['series'] } }),
    );
    await element.updateComplete;
    expect(element.getAttribute('data-palette')).toBe('graphite');
    expect(fake.viewer.ui.panels().some((panel) => panel.id === 'series')).toBe(false);
    off();
    await element.updateComplete;
    expect(element.hasAttribute('data-palette')).toBe(false);
    expect(fake.viewer.ui.panels().some((panel) => panel.id === 'series')).toBe(true);
  });

  it('starts again when the config changes', async () => {
    const { element } = await ready((el) => {
      el.config = layer({ palette: 'navy' });
    });
    expect(made).toHaveLength(1);
    const next = new Promise<void>((resolve) => {
      element.addEventListener('dv-ready', () => {
        resolve();
      });
    });
    element.config = layer({ palette: 'graphite' });
    await next;
    await element.updateComplete;
    expect(made).toHaveLength(2);
    expect(element.getAttribute('data-palette')).toBe('graphite');
  });
});
