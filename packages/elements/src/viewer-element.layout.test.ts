// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type { ViewerOptions, ViewerStateV1 } from '@scope/viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DvViewerElement } from './viewer-element';

const made: FakeViewer[] = [];

vi.mock('@scope/viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@scope/viewer-core/testing');
  return {
    ...actual,
    createViewer: (options: { initialState?: ViewerStateV1 }): unknown => {
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

afterEach(() => {
  document.body.replaceChildren();
  made.length = 0;
});

const options = (): ViewerOptions => ({ dataSource: createFakeViewer().source });

const settle = async (element: DvViewerElement): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) {
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

async function mount(): Promise<{ element: DvViewerElement; fake: FakeViewer }> {
  const element = document.createElement('dv-viewer') as DvViewerElement;
  document.body.append(element);
  element.options = options();
  element.studyInstanceUid = FAKE_IDS.study;
  await settle(element);
  const fake = made[0];
  if (fake === undefined) throw new Error('No viewer was made');
  return { element, fake };
}

const viewportIds = (element: DvViewerElement): (string | undefined)[] =>
  [...element.querySelectorAll<HTMLElement>('.dv-viewport')].map(
    (item) => item.dataset['viewportId'],
  );

const cells = (element: DvViewerElement): HTMLElement[] => [
  ...(element.shadowRoot?.querySelectorAll<HTMLElement>('.cell') ?? []),
];

describe('<dv-viewer> layouts', () => {
  it('starts with one viewport', async () => {
    const { element } = await mount();
    expect(viewportIds(element)).toEqual(['vp-0']);
    expect(cells(element)).toHaveLength(1);
  });

  it.each([
    ['1x2', ['vp-0', 'vp-1']],
    ['2x2', ['vp-0', 'vp-1', 'vp-2', 'vp-3']],
    ['1+3', ['vp-0', 'vp-1', 'vp-2', 'vp-3']],
  ] as const)(
    'makes and attaches a viewport element for each viewport of %s',
    async (layout, ids) => {
      const { element, fake } = await mount();
      await fake.viewer.setLayout(layout);
      await settle(element);
      expect(viewportIds(element)).toEqual(ids);
      expect(fake.viewer.viewports.list().map((viewport) => viewport.id)).toEqual(ids);
      expect(cells(element)).toHaveLength(ids.length);
    },
  );

  it('puts the large viewport of 1+3 across three rows, and the others in a column', async () => {
    const { element, fake } = await mount();
    await fake.viewer.setLayout('1+3');
    await settle(element);
    const styles = cells(element).map((cell) => cell.getAttribute('style'));
    expect(styles[0]).toContain('grid-row: 1 / span 3');
    expect(styles[1]).toContain('grid-column: 2 / span 1');
    expect(styles[3]).toContain('grid-row: 3 / span 1');
    const stage = element.shadowRoot?.querySelector('.stage');
    expect(stage?.getAttribute('style')).toContain('repeat(3, minmax(0, 1fr))');
  });

  it('removes and detaches the viewports a smaller layout does not have', async () => {
    const { element, fake } = await mount();
    await fake.viewer.setLayout('2x2');
    await settle(element);
    await fake.viewer.setLayout('1x2');
    await settle(element);
    expect(viewportIds(element)).toEqual(['vp-0', 'vp-1']);
    expect(fake.viewer.viewports.list().map((viewport) => viewport.id)).toEqual(['vp-0', 'vp-1']);
  });

  it('keeps the element of a viewport the new layout also has', async () => {
    const { element, fake } = await mount();
    const first = element.querySelector('.dv-viewport');
    await fake.viewer.setLayout('1x2');
    await settle(element);
    expect(element.querySelector('.dv-viewport')).toBe(first);
  });

  it('marks the active viewport, but only when there are several', async () => {
    const { element, fake } = await mount();
    expect(element.querySelector('[data-active]')).toBeNull();
    await fake.viewer.setLayout('1x2');
    await settle(element);
    expect(element.querySelector('[data-active]')?.getAttribute('data-viewport-id')).toBe('vp-0');
    fake.viewer.viewports.setActive('vp-1');
    expect(element.querySelector('[data-active]')?.getAttribute('data-viewport-id')).toBe('vp-1');
    await fake.viewer.setLayout('1x1');
    await settle(element);
    expect(element.querySelector('[data-active]')).toBeNull();
  });

  it('names each viewport for its place, so a screen reader can tell them apart', async () => {
    const { element, fake } = await mount();
    await fake.viewer.setLayout('1x2');
    await settle(element);
    const labels = [...element.querySelectorAll('.dv-viewport')].map((item) =>
      item.getAttribute('aria-label'),
    );
    expect(labels[0]).toMatch(/^Viewport 1 of 2, /);
    expect(labels[1]).toBe('Viewport 2 of 2, No image shown');
  });
});
