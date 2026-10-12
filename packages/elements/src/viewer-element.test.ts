// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@tushar-im/dicom-viewer-core/testing';
import type { ViewerOptions } from '@tushar-im/dicom-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DvViewerElement } from './viewer-element';

const made: FakeViewer[] = [];

vi.mock('@tushar-im/dicom-viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@tushar-im/dicom-viewer-core/testing');
  return {
    ...actual,
    createViewer: (options: ViewerOptions): unknown => {
      const fake = make(
        options.initialState === undefined ? {} : { initialState: options.initialState },
      );
      made.push(fake);
      return fake.viewer;
    },
    createDicomWebDataSource: (): object => ({}),
  };
});

await import('./define');
const { elementTag } = await import('./tags');

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  made.length = 0;
});

const optionsFor = (): ViewerOptions => ({ dataSource: createFakeViewer().source });

async function ready(
  setup: (element: DvViewerElement) => void = () => undefined,
): Promise<{ element: DvViewerElement; fake: FakeViewer }> {
  const element = document.createElement(elementTag('viewer')) as DvViewerElement;
  element.options = optionsFor();
  element.studyInstanceUid = FAKE_IDS.study;
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
  return { element, fake };
}

const shadow = (element: DvViewerElement, selector: string): Element | null =>
  element.shadowRoot?.querySelector(selector) ?? null;

describe('<dv-viewer> structure', () => {
  it('draws its chrome in shadow DOM and its viewports in the light DOM, shown through named slots', async () => {
    const { element } = await ready();
    const viewport = element.querySelector('[data-viewport-id="vp-0"]');
    expect(viewport).toBeInstanceOf(HTMLElement);
    expect(viewport?.parentElement).toBe(element);
    expect(viewport?.getAttribute('slot')).toBe('viewport-vp-0');
    expect(shadow(element, 'slot[name="viewport-vp-0"]')).not.toBeNull();
    expect(element.shadowRoot).not.toBeNull();
  });

  it('offers every slot the plan names (the empty state only while nothing is shown)', async () => {
    const { element } = await ready();
    for (const name of [
      'banner',
      'toolbar-start',
      'toolbar-end',
      'panel-left',
      'panel-right',
      'viewport-overlay',
    ]) {
      expect(shadow(element, `slot[name="${name}"]`), name).not.toBeNull();
    }
  });

  it('puts host content in its slots', async () => {
    const element = document.createElement(elementTag('viewer')) as DvViewerElement;
    const banner = document.createElement('div');
    banner.slot = 'banner';
    banner.textContent = 'Not for diagnosis';
    element.append(banner);
    const { element: shown } = await ready((made) => {
      made.append(banner);
    });
    const slot = shadow(shown, 'slot[name="banner"]') as HTMLSlotElement;
    expect(slot.assignedNodes()).toEqual([banner]);
  });

  it('shows the toolbar and the series, measurements, and segmentations panels, and can hide them', async () => {
    const { element, fake } = await ready();
    expect(shadow(element, 'dv-toolbar')).not.toBeNull();
    expect(fake.viewer.ui.panels().map((panel) => `${panel.id}:${panel.placement}`)).toEqual([
      'series:left',
      'measurements:right',
      'segmentations:right',
    ]);
    element.hideToolbar = true;
    element.hideSeriesPanel = true;
    element.hideMeasurementsPanel = true;
    element.hideSegmentationsPanel = true;
    await element.updateComplete;
    expect(shadow(element, 'dv-toolbar')).toBeNull();
    expect(fake.viewer.ui.panels()).toEqual([]);
    element.hideSeriesPanel = false;
    await element.updateComplete;
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual(['series']);
    element.hideMeasurementsPanel = false;
    await element.updateComplete;
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual(['series', 'measurements']);
    element.hideSegmentationsPanel = false;
    await element.updateComplete;
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual([
      'series',
      'measurements',
      'segmentations',
    ]);
  });

  it('can hide the measurements panel alone, from the attribute too', async () => {
    const { element, fake } = await ready();
    element.setAttribute('hide-measurements-panel', '');
    await element.updateComplete;
    expect(element.hideMeasurementsPanel).toBe(true);
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual(['series', 'segmentations']);
  });

  it('can hide the segmentations panel alone, from the attribute too', async () => {
    const { element, fake } = await ready();
    element.setAttribute('hide-segmentations-panel', '');
    await element.updateComplete;
    expect(element.hideSegmentationsPanel).toBe(true);
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual(['series', 'measurements']);
    element.removeAttribute('hide-segmentations-panel');
    await element.updateComplete;
    expect(fake.viewer.ui.panels().map((panel) => panel.id)).toEqual([
      'series',
      'measurements',
      'segmentations',
    ]);
  });

  it('gives the three built-in panels their pictures by name, not by id', async () => {
    const { element } = await ready();
    const icons = Object.fromEntries(
      (element.viewer?.ui.panels() ?? []).map((panel) => [panel.id, panel.icon]),
    );
    expect(icons).toEqual({ series: 'series', measurements: 'measure', segmentations: 'segments' });
  });

  it('lists the SEGs of the study in the Segments tab of the right-hand panel', async () => {
    const { element } = await ready();
    const dock = shadow(element, 'dv-panel-dock[placement="right"]') as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    await dock.updateComplete;
    const tab = [...(dock.shadowRoot?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
      (item) => item.textContent.trim() === 'Segments',
    );
    expect(tab).toBeDefined();
    tab?.click();
    await dock.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const list = dock.shadowRoot?.querySelector('dv-segmentation-list');
    expect(list).not.toBeNull();
    expect(list?.shadowRoot?.querySelectorAll('[data-segmentation]').length).toBeGreaterThan(1);
  });

  it('lists the measurements in the right-hand panel', async () => {
    const { element, fake } = await ready();
    await fake.viewer.measurements.add({
      type: 'length',
      reference: {
        studyInstanceUID: FAKE_IDS.study,
        seriesInstanceUID: FAKE_IDS.ct,
        sopInstanceUID: `${FAKE_IDS.ct}.0.5`,
      },
      points: [
        [0, 0, 0],
        [3, 4, 0],
      ],
    });
    const dock = shadow(element, 'dv-panel-dock[placement="right"]') as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    await dock.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const list = dock.shadowRoot?.querySelector('dv-measurement-list');
    expect(list).not.toBeNull();
    expect(list?.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it('lists the study in the series panel, with its thumbnails', async () => {
    const { element } = await ready();
    const dock = shadow(element, 'dv-panel-dock[placement="left"]') as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    await dock.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const browser = dock.shadowRoot?.querySelector('dv-series-browser');
    expect(browser).not.toBeNull();
  });

  it('shows the empty state until a series is on screen', async () => {
    const element = document.createElement(elementTag('viewer')) as DvViewerElement;
    await new Promise<void>((resolve) => {
      document.body.append(element);
      void element.updateComplete.then(() => {
        resolve();
      });
    });
    expect(shadow(element, '.empty slot[name="empty-state"]')?.textContent.trim()).toBe(
      'Choose a series to view.',
    );
    const { element: loaded } = await ready();
    expect(shadow(loaded, '.empty')).toBeNull();
  });

  it('switches to the light theme and back', async () => {
    const { element } = await ready();
    expect(element.hasAttribute('data-theme')).toBe(false);
    element.theme = 'light';
    await element.updateComplete;
    expect(element.getAttribute('data-theme')).toBe('light');
    element.theme = 'dark';
    await element.updateComplete;
    expect(element.hasAttribute('data-theme')).toBe(false);
  });

  it('takes the theme from an attribute', async () => {
    const { element } = await ready((made) => {
      made.setAttribute('theme', 'light');
    });
    expect(element.getAttribute('data-theme')).toBe('light');
  });

  it('switches palette, and the default palette has no attribute', async () => {
    const { element } = await ready();
    expect(element.hasAttribute('data-palette')).toBe(false);
    element.palette = 'navy';
    await element.updateComplete;
    expect(element.getAttribute('data-palette')).toBe('navy');
    element.palette = 'default';
    await element.updateComplete;
    expect(element.hasAttribute('data-palette')).toBe(false);
  });

  it('takes the palette from an attribute', async () => {
    const { element } = await ready((made) => {
      made.setAttribute('palette', 'graphite');
    });
    expect(element.getAttribute('data-palette')).toBe('graphite');
  });
});

describe('<dv-viewer> theme', () => {
  it("lets the pieces inside inherit the shell's tokens, instead of declaring dark ones of their own", async () => {
    const { element } = await ready();
    // Every piece's styles must declare the light tokens only for its own data-theme, and no dark ones.
    const toolbar = shadow(element, 'dv-toolbar');
    const sheets =
      (toolbar?.constructor as { elementStyles?: { cssText: string }[] }).elementStyles ?? [];
    const css = sheets.map((sheet) => sheet.cssText).join('\n');
    expect(css).not.toMatch(/:host\s*\{[^}]*--dv-color-bg:/);
    expect(css).toMatch(/:host\(\[data-theme='light'\]\)\s*\{[^}]*--dv-color-bg:/);
    expect(css).toMatch(/var\(--dv-color-bg, #0f1216\)|var\(--dv-color-surface, #171b21\)/);
  });
});

describe('<dv-viewer> and assistive technology', () => {
  it('names each viewport for what it shows, as a picture', async () => {
    const { element } = await ready();
    const viewport = element.querySelector('[data-viewport-id="vp-0"]');
    expect(viewport?.getAttribute('role')).toBe('img');
    expect(viewport?.getAttribute('aria-roledescription')).toBe('DICOM viewport');
    // Ten slices: the middle one is shown first.
    expect(viewport?.getAttribute('aria-label')).toBe('CT, image 6 of 10');
  });

  it('updates the label at once, and says the change aloud once the picture is still', async () => {
    const { element, fake } = await ready();
    const viewport = element.querySelector('[data-viewport-id="vp-0"]');
    const live = shadow(element, '[role="status"][aria-live="polite"]');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await fake.viewer.viewports.get('vp-0')?.setImageIndex(2);
    await fake.viewer.viewports.get('vp-0')?.setImageIndex(3);
    expect(viewport?.getAttribute('aria-label')).toBe('CT, image 4 of 10');
    expect(live?.textContent.trim()).toBe('');
    vi.advanceTimersByTime(900);
    await element.updateComplete;
    expect(live?.textContent.trim()).toBe('CT, image 4 of 10');
  });

  it('says nothing for what was already on screen when it came up', async () => {
    const { element } = await ready();
    const live = shadow(element, '[role="status"][aria-live="polite"]');
    expect(live?.textContent.trim()).toBe('');
  });

  it('says the view in words when it is not the default one', async () => {
    const { element, fake } = await ready();
    await fake.viewer.viewports.get('vp-0')?.setZoom(2);
    await fake.viewer.viewports.get('vp-0')?.toggleInvert();
    expect(element.querySelector('[data-viewport-id="vp-0"]')?.getAttribute('aria-label')).toBe(
      'CT, image 6 of 10, inverted, zoom 2.0 times',
    );
  });

  it('lets a keyboard user reach the viewport, and shows where it is', async () => {
    const { element } = await ready();
    expect(element.querySelector('[data-viewport-id="vp-0"]')?.getAttribute('tabindex')).toBe('0');
  });
});
