// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@01x/dicom-viewer-core/testing';
import type { ViewerConfigV1, ViewerOptions } from '@01x/dicom-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DvToolbarElement } from './toolbar';
import type { DvViewerElement, ViewerErrorDetail } from './viewer-element';

const made: FakeViewer[] = [];

vi.mock('@01x/dicom-viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@01x/dicom-viewer-core/testing');
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
  vi.unstubAllGlobals();
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

  it('starts without a config whose layers cannot work together, and says why', async () => {
    // Each layer is fine alone, but a key for a preset that no layer has cannot be built.
    const { element, errors } = await ready((el) => {
      el.config = layer({
        palette: 'navy',
        keybindings: { m: { type: 'preset', id: 'nope' } },
      });
    });
    expect(element.status).toBe('ready');
    expect(element.hasAttribute('data-palette')).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('config');
    expect(errors[0]?.error.message).toMatch(/preset/);
  });

  it('starts without the config of its options too, when that is the layer that cannot work', async () => {
    // The fake viewer made by the mock above only throws for what the real one would.
    const { element, errors } = await ready((el) => {
      el.options = {
        dataSource: createFakeViewer().source,
        config: layer({ keybindings: { m: { type: 'preset', id: 'nope' } } }),
      };
    });
    expect(element.status).toBe('ready');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('config');
    expect(errors[0]?.error.message).toMatch(/preset/);
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

describe('<dv-viewer config-url>', () => {
  const URL_OK = 'https://cdn.example.org/viewer-config.json';
  const reply = (body: unknown, init: ResponseInit = {}): Response =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), init);

  it('fetches the file from an allowed origin, and applies it', async () => {
    const fetchMock = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(reply(layer({ palette: 'graphite' }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { element } = await ready((el) => {
      el.configUrl = URL_OK;
      el.configOrigins = ['https://cdn.example.org'];
    });
    expect(element.getAttribute('data-palette')).toBe('graphite');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(URL_OK);
    // No cookies go to it, and a redirect that could leave the list is an error.
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it('takes the url and the origins as attributes', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(reply(layer({ palette: 'navy' }))));
    const { element } = await ready((el) => {
      el.setAttribute('config-url', URL_OK);
      el.setAttribute('config-origins', 'https://other.example.org, https://cdn.example.org');
    });
    expect(element.getAttribute('data-palette')).toBe('navy');
  });

  it('does not ask for a file whose origin is not in the list, and says so', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    const { element, errors } = await ready((el) => {
      el.configUrl = 'https://evil.example.net/config.json';
      el.configOrigins = ['https://cdn.example.org'];
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.status).toBe('ready');
    expect(errors[0]?.context).toBe('config');
    expect(errors[0]?.error.message).toContain('https://evil.example.net');
  });

  it("is off with no origins at all, even for the page's own origin", async () => {
    const fetchMock = vi.fn<() => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    const { errors } = await ready((el) => {
      el.configUrl = '/viewer-config.json';
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errors[0]?.error.message).toContain('config-origins');
  });

  it("allows the page's own origin when it is listed, and reads a relative url against the page", async () => {
    const fetchMock = vi.fn<(url: URL) => Promise<Response>>(() =>
      Promise.resolve(reply(layer({ palette: 'navy' }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { element } = await ready((el) => {
      el.configUrl = '/viewer-config.json';
      el.configOrigins = [location.origin];
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${location.origin}/viewer-config.json`);
    expect(element.getAttribute('data-palette')).toBe('navy');
  });

  it.each([
    ['a failing answer', () => reply('nope', { status: 404 }), /answered 404/],
    ['text that is not JSON', () => reply('{not json'), /not valid JSON/],
    [
      'a config with a problem',
      () => reply({ version: 1, palette: 'pink' }),
      /Invalid config at[\s\S]*palette/,
    ],
    [
      'a file that is too large',
      () => reply(JSON.stringify({ version: 1, pad: 'x'.repeat(300_000) })),
      /larger than/,
    ],
  ])('starts without the file, and reports %s', async (_name, answer, message) => {
    vi.stubGlobal('fetch', () => Promise.resolve(answer()));
    const { element, errors } = await ready((el) => {
      el.configUrl = URL_OK;
      el.configOrigins = ['https://cdn.example.org'];
    });
    expect(element.status).toBe('ready');
    expect(element.hasAttribute('data-palette')).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('config');
    expect(errors[0]?.error.message).toMatch(message);
  });

  it('starts without the file when the request itself fails', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const { element, errors } = await ready((el) => {
      el.configUrl = URL_OK;
      el.configOrigins = ['https://cdn.example.org'];
    });
    expect(element.status).toBe('ready');
    expect(errors[0]?.error.message).toBe('Failed to fetch');
  });

  it("puts the page's own config over the file", async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(reply(layer({ palette: 'graphite', theme: 'light' }))),
    );
    const { element } = await ready((el) => {
      el.configUrl = URL_OK;
      el.configOrigins = ['https://cdn.example.org'];
      el.config = layer({ palette: 'navy' });
    });
    expect(element.getAttribute('data-palette')).toBe('navy');
    expect(element.getAttribute('data-theme')).toBe('light');
  });

  it('asks for nothing when there is no url', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    await ready();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts the config in the options of the page over the file', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(reply(layer({ palette: 'graphite', theme: 'light' }))),
    );
    const { element } = await ready((el) => {
      el.options = { dataSource: createFakeViewer().source, config: layer({ palette: 'navy' }) };
      el.configUrl = URL_OK;
      el.configOrigins = ['https://cdn.example.org'];
    });
    expect(element.getAttribute('data-palette')).toBe('navy');
    expect(element.getAttribute('data-theme')).toBe('light');
  });

  it('is aborted, and says nothing, when the inputs change while the file is on its way', async () => {
    const pending: { reject: (error: Error) => void; signal: AbortSignal | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          pending.push({ reject, signal: init.signal ?? undefined });
        }),
    );
    const element = document.createElement(elementTag('viewer')) as DvViewerElement;
    element.options = { dataSource: createFakeViewer().source };
    element.studyInstanceUid = FAKE_IDS.study;
    element.configUrl = URL_OK;
    element.configOrigins = ['https://cdn.example.org'];
    const errors: ViewerErrorDetail[] = [];
    element.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<ViewerErrorDetail>).detail);
    });
    document.body.append(element);
    await vi.waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    // The page takes the file away: the viewer starts again, without it.
    const ready = new Promise<void>((resolve) => {
      element.addEventListener('dv-ready', () => {
        resolve();
      });
    });
    element.configUrl = undefined;
    await ready;
    expect(pending[0]?.signal?.aborted).toBe(true);
    // The old request fails now, too late to matter.
    pending[0]?.reject(new DOMException('Aborted', 'AbortError'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([]);
    expect(element.status).toBe('ready');
  });
});
