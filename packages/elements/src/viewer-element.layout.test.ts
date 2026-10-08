// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type { HangingProtocol, ViewerOptions, ViewerStateV1 } from '@scope/viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERIES_DRAG_TYPE, seriesDragData } from './series-drag';
import type { DvViewerElement, ViewerErrorDetail } from './viewer-element';

const made: FakeViewer[] = [];
/** Makes every series the fake source serves one that cannot be reformatted. */
let tilted = false;

vi.mock('@scope/viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@scope/viewer-core/testing');
  return {
    ...actual,
    createViewer: (options: {
      initialState?: ViewerStateV1;
      hangingProtocols?: readonly HangingProtocol[];
    }): unknown => {
      const fake = make({
        ...(options.initialState === undefined ? {} : { initialState: options.initialState }),
        ...(options.hangingProtocols === undefined
          ? {}
          : { hangingProtocols: options.hangingProtocols }),
      });
      if (tilted) {
        const original = fake.source.getSeries.bind(fake.source);
        fake.source.getSeries = async (study, series) => {
          const loaded = await original(study, series);
          return {
            ...loaded,
            stacks: loaded.stacks.map((stack) => ({
              ...stack,
              reconstructable: { ok: false, reason: 'tilted' } as const,
            })),
          };
        };
      }
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
  tilted = false;
});

const options = (hangingProtocols?: readonly HangingProtocol[]): ViewerOptions => ({
  dataSource: createFakeViewer().source,
  ...(hangingProtocols === undefined ? {} : { hangingProtocols }),
});

const settle = async (element: DvViewerElement): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) {
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

async function mount(
  hangingProtocols?: readonly HangingProtocol[],
  initialState?: ViewerStateV1,
): Promise<{ element: DvViewerElement; fake: FakeViewer }> {
  const element = document.createElement('dv-viewer') as DvViewerElement;
  document.body.append(element);
  element.options = {
    ...options(hangingProtocols),
    ...(initialState === undefined ? {} : { initialState }),
  };
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

function drag(type: string, payload: string | undefined): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: payload === undefined ? ['Files'] : [SERIES_DRAG_TYPE],
      dropEffect: 'none',
      getData: (kind: string): string => (kind === SERIES_DRAG_TYPE ? (payload ?? '') : ''),
    },
  });
  return event;
}

const stateOf = (fake: FakeViewer, id: string): string | undefined =>
  fake.viewer.getState().viewports.find((viewport) => viewport.id === id)?.seriesInstanceUID;

describe('<dv-viewer> drop of a series', () => {
  async function twoUp(): Promise<{ element: DvViewerElement; fake: FakeViewer }> {
    const { element, fake } = await mount();
    await fake.viewer.setLayout('1x2');
    await settle(element);
    return { element, fake };
  }

  it('shows the series in the viewport it is dropped on, and makes that viewport active', async () => {
    const { element, fake } = await twoUp();
    const second = cells(element)[1];
    second?.dispatchEvent(drag('drop', seriesDragData(FAKE_IDS.study, FAKE_IDS.ctTwoStacks)));
    await settle(element);
    expect(stateOf(fake, 'vp-1')).toBe(FAKE_IDS.ctTwoStacks);
    expect(stateOf(fake, 'vp-0')).not.toBe(FAKE_IDS.ctTwoStacks);
    expect(fake.viewer.viewports.active).toBe('vp-1');
  });

  it('accepts the drag over a viewport, shows where it would land, and stops when it leaves', async () => {
    const { element } = await twoUp();
    const second = cells(element)[1];
    const over = drag('dragover', seriesDragData(FAKE_IDS.study, FAKE_IDS.ct));
    second?.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(second?.hasAttribute('data-drop-target')).toBe(true);
    second?.dispatchEvent(drag('dragleave', undefined));
    expect(second?.hasAttribute('data-drop-target')).toBe(false);
  });

  it('does not accept files or text, so the browser keeps its own behaviour', async () => {
    const { element } = await twoUp();
    const over = drag('dragover', undefined);
    cells(element)[1]?.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(cells(element)[1]?.hasAttribute('data-drop-target')).toBe(false);
  });

  it('ignores a drop from another study, and one that is not a series', async () => {
    const { element, fake } = await twoUp();
    cells(element)[1]?.dispatchEvent(drag('drop', seriesDragData('1.9.9', FAKE_IDS.ct)));
    cells(element)[1]?.dispatchEvent(drag('drop', 'not a payload'));
    await settle(element);
    expect(stateOf(fake, 'vp-1')).toBeUndefined();
  });

  it('reports a series that cannot be shown as a dv-error, and leaves the viewport as it was', async () => {
    const { element, fake } = await twoUp();
    const errors: ViewerErrorDetail[] = [];
    element.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<ViewerErrorDetail>).detail);
    });
    cells(element)[1]?.dispatchEvent(drag('drop', seriesDragData(FAKE_IDS.study, FAKE_IDS.seg)));
    await settle(element);
    expect(errors.map((detail) => detail.context)).toEqual(['drop']);
    expect(stateOf(fake, 'vp-1')).toBeUndefined();
  });

  it('replaces what a viewport shows', async () => {
    const { element, fake } = await twoUp();
    const first = cells(element)[0];
    first?.dispatchEvent(drag('drop', seriesDragData(FAKE_IDS.study, FAKE_IDS.ctTwoStacks)));
    await settle(element);
    expect(stateOf(fake, 'vp-0')).toBe(FAKE_IDS.ctTwoStacks);
  });
});

describe('<dv-viewer> hanging protocols', () => {
  const pair: HangingProtocol = {
    id: 'pair',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', series: {} },
      { id: 'vp-1', series: {} },
    ],
  };

  it('hangs the study with the protocol that fits, and draws each viewport', async () => {
    const { element, fake } = await mount([pair]);
    expect(fake.viewer.getState().layout).toBe('1x2');
    expect(viewportIds(element)).toEqual(['vp-0', 'vp-1']);
    expect(stateOf(fake, 'vp-0')).toBe(FAKE_IDS.ct);
    expect(stateOf(fake, 'vp-1')).toBe(FAKE_IDS.ctTwoStacks);
    expect(fake.viewer.viewports.get('vp-1')?.series?.seriesInstanceUID).toBe(FAKE_IDS.ctTwoStacks);
  });

  it('does nothing of the kind when the host gave no protocols: one viewport, the first picture series', async () => {
    const { element, fake } = await mount();
    expect(fake.viewer.getState().layout).toBe('1x1');
    expect(viewportIds(element)).toEqual(['vp-0']);
    expect(stateOf(fake, 'vp-0')).toBe(FAKE_IDS.ct);
  });

  it('leaves a restored state alone, since the person chose it', async () => {
    const restored: ViewerStateV1 = {
      version: 1,
      layout: '1x1',
      studyInstanceUID: FAKE_IDS.study,
      viewports: [{ id: 'vp-0', seriesInstanceUID: FAKE_IDS.ctTwoStacks }],
    };
    const { fake } = await mount([pair], restored);
    expect(fake.viewer.getState().layout).toBe('1x1');
    expect(stateOf(fake, 'vp-0')).toBe(FAKE_IDS.ctTwoStacks);
  });

  it('falls back to the first picture series when no protocol fits', async () => {
    const needsMr: HangingProtocol = {
      id: 'needs-mr',
      layout: '1x2',
      viewports: [{ id: 'vp-0', series: { modality: 'MR' } }],
    };
    const { fake } = await mount([needsMr]);
    expect(fake.viewer.getState().layout).toBe('1x1');
    expect(stateOf(fake, 'vp-0')).toBe(FAKE_IDS.ct);
  });

  it('shows the series it is asked for, whatever the protocols say', async () => {
    const element = document.createElement('dv-viewer') as DvViewerElement;
    document.body.append(element);
    element.options = options([pair]);
    element.studyInstanceUid = FAKE_IDS.study;
    element.seriesInstanceUid = FAKE_IDS.ctTwoStacks;
    await settle(element);
    const fake = made[0];
    expect(fake?.viewer.getState().layout).toBe('1x1');
    expect(fake === undefined ? undefined : stateOf(fake, 'vp-0')).toBe(FAKE_IDS.ctTwoStacks);
  });
});

describe('<dv-viewer> planes', () => {
  const notice = (element: DvViewerElement, at: number): string | null | undefined =>
    cells(element)[at]?.querySelector('.notice')?.textContent.trim();

  async function withTiltedSeries(): Promise<{ element: DvViewerElement; fake: FakeViewer }> {
    tilted = true;
    return mount();
  }

  it('says in the viewport why it shows slices where a plane was asked for, and stops saying it', async () => {
    const { element, fake } = await withTiltedSeries();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks, { orientation: 'coronal' });
    await settle(element);
    expect(notice(element, 0)).toContain('lean against the direction they are stacked in');
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks);
    await settle(element);
    expect(notice(element, 0)).toBeUndefined();
  });

  it('drops the notice when the viewport goes back to the same slice of ordinary slices', async () => {
    const { element, fake } = await withTiltedSeries();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks, {
      orientation: 'coronal',
      imageIndex: 2,
    });
    await settle(element);
    expect(notice(element, 0)).toBeDefined();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks, { imageIndex: 2 });
    await settle(element);
    expect(notice(element, 0)).toBeUndefined();
  });

  it('has no notice for a plane that is drawn, or for slices nobody asked to reformat', async () => {
    const { element, fake } = await mount();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct, { orientation: 'coronal' });
    await settle(element);
    expect(notice(element, 0)).toBeUndefined();
  });

  it('names the plane for a screen reader', async () => {
    const { element, fake } = await mount();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct, { orientation: 'sagittal' });
    await settle(element);
    expect(element.querySelector('.dv-viewport')?.getAttribute('aria-label')).toContain(
      'sagittal plane',
    );
  });

  it('does not name a plane it could not draw', async () => {
    const { element, fake } = await withTiltedSeries();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks, { orientation: 'sagittal' });
    await settle(element);
    expect(element.querySelector('.dv-viewport')?.getAttribute('aria-label')).not.toContain(
      'plane',
    );
  });
});
