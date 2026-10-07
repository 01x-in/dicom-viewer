// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type { Viewer, ViewerOptions, ViewerStateV1 } from '@scope/viewer-core';
import { type JSX, type RefObject, StrictMode, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DicomViewer,
  type DicomViewerProps,
  useMeasurements,
  useSegmentations,
  useViewer,
  useViewerState,
} from './index';

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

// React's act needs to know it is in a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: ViewerOptions = { dataSource: createFakeViewer().source };
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  made.length = 0;
});

const element = (): HTMLElement => {
  const found = host.querySelector<HTMLElement>('dv-viewer');
  if (found === null) throw new Error('No <dv-viewer>');
  return found;
};

async function settle(): Promise<void> {
  // The first render in a file loads the element and its dependencies, which is slow on a cold
  // machine: wait for the element to say it is done, then give the rest a few turns.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = host.querySelector('dv-viewer')?.getAttribute('status');
    if (status === 'ready' || status === 'error') break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function render(props: Partial<DicomViewerProps> = {}, strict = false): Promise<void> {
  const tree = <DicomViewer options={options} studyInstanceUID={FAKE_IDS.study} {...props} />;
  act(() => {
    root.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  });
  await settle();
}

const shown = (): string | undefined =>
  made.at(-1)?.viewer.getState().viewports[0]?.seriesInstanceUID;

describe('<DicomViewer>', () => {
  it('renders the shell, sized to its parent, and shows the first series with pictures', async () => {
    await render();
    expect(element().style.height).toBe('100%');
    expect(shown()).toBe(FAKE_IDS.ct);
    expect(element().getAttribute('status')).toBe('ready');
  });

  it('shows the series it is asked for', async () => {
    await render({ seriesInstanceUID: FAKE_IDS.ctTwoStacks });
    expect(shown()).toBe(FAKE_IDS.ctTwoStacks);
  });

  it('calls onReady with the viewer and the first viewport, once', async () => {
    const onReady = vi.fn();
    await render({ onReady });
    expect(onReady).toHaveBeenCalledOnce();
    const [viewer, viewport] = onReady.mock.calls[0] as [Viewer, { id: string }];
    expect(viewer).toBe(made[0]?.viewer);
    expect(viewport.id).toBe('vp-0');
  });

  it('makes one viewer under StrictMode, which runs effects twice', async () => {
    await render({}, true);
    expect(made).toHaveLength(1);
    expect(element().getAttribute('status')).toBe('ready');
  });

  it('does not restart for a new callback or a new inline object that means the same', async () => {
    await render({ onReady: () => undefined, style: { border: '0' } });
    await render({ onReady: () => undefined, style: { border: '0' }, banner: <i>hi</i> });
    expect(made).toHaveLength(1);
  });

  it('starts over when the study changes', async () => {
    await render();
    await render({ studyInstanceUID: '1.2.4' });
    expect(made).toHaveLength(2);
  });

  it('reports a study that cannot be loaded through onError', async () => {
    const onError = vi.fn();
    await render({ studyInstanceUID: '9.9', onError });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0] as [Error])[0]).toBeInstanceOf(Error);
  });

  it('puts the slots in the shell, by name', async () => {
    await render({
      banner: <b>Banner</b>,
      toolbarStart: <i>Start</i>,
      toolbarEnd: <i>End</i>,
      viewportOverlay: <u>Over</u>,
    });
    for (const [name, text] of [
      ['banner', 'Banner'],
      ['toolbar-start', 'Start'],
      ['toolbar-end', 'End'],
      ['viewport-overlay', 'Over'],
    ] as const) {
      expect(element().querySelector(`[slot="${name}"]`)?.textContent).toBe(text);
    }
  });

  it('goes back to the built-in toolbar when custom items are removed', async () => {
    const items = [{ type: 'separator' as const }];
    await render({ toolbar: items });
    const toolbar = (): Element | null | undefined =>
      element().shadowRoot?.querySelector('dv-toolbar');
    expect(toolbar()?.shadowRoot?.querySelectorAll('[data-roving]')).toHaveLength(0);
    await render({ toolbar: undefined });
    expect(toolbar()?.shadowRoot?.querySelectorAll('[data-roving]').length).toBeGreaterThan(5);
  });

  it('puts plain panel content beside the tabbed panels', async () => {
    await render({ panelLeft: <b>Left</b>, panelRight: <b>Right</b> });
    expect(element().querySelector('[slot="panel-left"]')?.textContent).toBe('Left');
    expect(element().querySelector('[slot="panel-right"]')?.textContent).toBe('Right');
  });

  it('follows the palette', async () => {
    await render({ palette: 'graphite' });
    expect(element().getAttribute('data-palette')).toBe('graphite');
    await render({});
    expect(element().hasAttribute('data-palette')).toBe(false);
  });

  it('follows the theme, and can hide the toolbar', async () => {
    await render({ theme: 'light', toolbar: false });
    expect(element().getAttribute('data-theme')).toBe('light');
    expect(element().shadowRoot?.querySelector('dv-toolbar')).toBeNull();
    await render({ theme: 'dark' });
    expect(element().hasAttribute('data-theme')).toBe(false);
    expect(element().shadowRoot?.querySelector('dv-toolbar')).not.toBeNull();
  });

  it('gives the viewer to viewerRef while it runs, and takes it back', async () => {
    const viewerRef: RefObject<Viewer | null> = createRef<Viewer | null>();
    await render({ viewerRef });
    expect(viewerRef.current).toBe(made[0]?.viewer);
    await render({ viewerRef, studyInstanceUID: '1.2.4' });
    expect(viewerRef.current).toBe(made[1]?.viewer);
    act(() => {
      root.unmount();
    });
    expect(viewerRef.current).toBeNull();
    root = createRoot(host);
  });

  it('has the viewer in the ref by the time onReady runs, and not after teardown starts', async () => {
    const viewerRef: RefObject<Viewer | null> = createRef<Viewer | null>();
    const seen: (Viewer | null)[] = [];
    await render({
      viewerRef,
      onReady: () => {
        seen.push(viewerRef.current);
      },
    });
    expect(seen).toEqual([made[0]?.viewer]);
    const teardown = vi.fn(() => {
      seen.push(viewerRef.current);
    });
    element().addEventListener('dv-teardown', teardown, { once: true });
    await render({ viewerRef, studyInstanceUID: '1.2.4' });
    // The listener ran: the ref was already empty when the old viewer was announced as going.
    expect(teardown).toHaveBeenCalledOnce();
    expect(seen).toEqual([made[0]?.viewer, null]);
    expect(viewerRef.current).toBe(made[1]?.viewer);
  });

  it('moves the viewer to a new ref, and lets go of the old one', async () => {
    const first: RefObject<Viewer | null> = createRef<Viewer | null>();
    const second: RefObject<Viewer | null> = createRef<Viewer | null>();
    await render({ viewerRef: first });
    expect(first.current).toBe(made[0]?.viewer);
    await render({ viewerRef: second });
    expect(made).toHaveLength(1);
    expect(first.current).toBeNull();
    expect(second.current).toBe(made[0]?.viewer);
  });

  it('calls a callback ref too', async () => {
    const seen: (Viewer | null)[] = [];
    await render({
      viewerRef: (viewer) => {
        seen.push(viewer);
      },
    });
    expect(seen).toEqual([made[0]?.viewer]);
  });

  it('reports every change of the state, with its origin', async () => {
    const onStateChange = vi.fn();
    await render({ onStateChange });
    onStateChange.mockClear();
    await act(async () => {
      await made[0]?.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks);
    });
    expect(onStateChange).toHaveBeenCalled();
    const [state, origin] = onStateChange.mock.calls.at(-1) as [ViewerStateV1, string];
    expect(state.viewports[0]?.seriesInstanceUID).toBe(FAKE_IDS.ctTwoStacks);
    expect(origin).toBe('api');
  });

  it('shows an instance when asked to navigate, and again when the target changes', async () => {
    await render({
      navigate: { seriesInstanceUID: FAKE_IDS.ct, sopInstanceUID: `${FAKE_IDS.ct}.0.7` },
    });
    expect(made[0]?.viewer.getState().viewports[0]?.imageIndex).toBe(7);
    await render({
      navigate: { seriesInstanceUID: FAKE_IDS.ct, sopInstanceUID: `${FAKE_IDS.ct}.0.2` },
    });
    expect(made[0]?.viewer.getState().viewports[0]?.imageIndex).toBe(2);
  });

  it('reports a navigate target that does not exist through onError', async () => {
    const onError = vi.fn();
    await render({
      onError,
      navigate: { seriesInstanceUID: FAKE_IDS.ct, sopInstanceUID: '1.9.9' },
    });
    expect(onError).toHaveBeenCalled();
  });

  it('restores an initial state', async () => {
    await render({
      initialState: {
        version: 1,
        layout: '1x1',
        studyInstanceUID: FAKE_IDS.study,
        viewports: [{ id: 'vp-0', seriesInstanceUID: FAKE_IDS.ctTwoStacks, imageIndex: 1 }],
      },
    });
    expect(shown()).toBe(FAKE_IDS.ctTwoStacks);
    expect(made[0]?.viewer.getState().viewports[0]?.imageIndex).toBe(1);
  });
});

describe('panels and hooks', () => {
  function Probe(): JSX.Element {
    const viewer = useViewer();
    const series = useViewerState((state) => state.viewports[0]?.seriesInstanceUID);
    return <p data-probe>{viewer === undefined ? 'no viewer' : `series ${series ?? 'none'}`}</p>;
  }

  it('draws a React panel into the dock, with the host context', async () => {
    await render({
      hideSeriesPanel: true,
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
      panels: { notes: { title: 'Notes', render: () => <Probe /> } },
    });
    const dock = element().shadowRoot?.querySelector('dv-panel-dock[placement="right"]');
    const probe = dock?.shadowRoot?.querySelector('[data-probe]');
    expect(probe?.textContent).toBe(`series ${FAKE_IDS.ct}`);
    expect(made[0]?.viewer.ui.panels().map((panel) => panel.id)).toEqual(['notes']);
  });

  it('keeps the panel up to date as the state changes', async () => {
    await render({
      hideSeriesPanel: true,
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
      panels: { notes: { title: 'Notes', render: () => <Probe /> } },
    });
    await act(async () => {
      await made[0]?.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks);
    });
    const dock = element().shadowRoot?.querySelector('dv-panel-dock[placement="right"]');
    expect(dock?.shadowRoot?.querySelector('[data-probe]')?.textContent).toBe(
      `series ${FAKE_IDS.ctTwoStacks}`,
    );
  });

  it('has the measurements and segments lists built in on the right, and hides each on request', async () => {
    await render({ hideSeriesPanel: true });
    expect(made[0]?.viewer.ui.panels().map((panel) => `${panel.id}:${panel.placement}`)).toEqual([
      'measurements:right',
      'segmentations:right',
    ]);
    await render({ hideSeriesPanel: true, hideMeasurementsPanel: true });
    expect(made[0]?.viewer.ui.panels().map((panel) => panel.id)).toEqual(['segmentations']);
    await render({ hideSeriesPanel: true, hideSegmentationsPanel: true });
    expect(made[0]?.viewer.ui.panels().map((panel) => panel.id)).toEqual(['measurements']);
    await render({
      hideSeriesPanel: true,
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
    });
    expect(made[0]?.viewer.ui.panels()).toEqual([]);
    await render({ hideSeriesPanel: true });
    // The order is the order they were switched on in, so only which ones there are is checked.
    expect(
      made[0]?.viewer.ui
        .panels()
        .map((panel) => panel.id)
        .sort(),
    ).toEqual(['measurements', 'segmentations']);
  });

  it('gives useSegmentations the loaded SEGs, and follows them', async () => {
    function Count(): JSX.Element {
      const segmentations = useSegmentations();
      return (
        <p data-count>
          {segmentations === undefined
            ? 'no viewer'
            : `${segmentations.length.toString()} SEGs, ${segmentations
                .map((item) => (item.visible ? 'shown' : 'hidden'))
                .join()}`}
        </p>
      );
    }
    await render({
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
      panels: { notes: { title: 'Notes', render: () => <Count /> } },
      hideSeriesPanel: true,
    });
    const text = (): string | null | undefined =>
      element()
        .shadowRoot?.querySelector('dv-panel-dock[placement="right"]')
        ?.shadowRoot?.querySelector('[data-count]')?.textContent;
    expect(text()).toBe('0 SEGs, ');
    await act(async () => {
      await made[0]?.viewer.segmentations.load(FAKE_IDS.seg);
    });
    expect(text()).toBe('1 SEGs, shown');
    await act(async () => {
      await made[0]?.viewer.segmentations.setVisible(FAKE_IDS.seg, false);
    });
    expect(text()).toBe('1 SEGs, hidden');
    // The SEGs belong to the study on screen: another study unloads them.
    await act(async () => {
      await made[0]?.viewer.loadStudy('1.2.4');
    });
    expect(text()).toBe('0 SEGs, ');
  });

  it('gives useMeasurements the measurements, and follows them', async () => {
    function Count(): JSX.Element {
      const measurements = useMeasurements();
      return (
        <p data-count>
          {measurements === undefined
            ? 'no viewer'
            : `${measurements.length.toString()} measurements`}
        </p>
      );
    }
    await render({
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
      panels: { notes: { title: 'Notes', render: () => <Count /> } },
      hideSeriesPanel: true,
    });
    const text = (): string | null | undefined =>
      element()
        .shadowRoot?.querySelector('dv-panel-dock[placement="right"]')
        ?.shadowRoot?.querySelector('[data-count]')?.textContent;
    expect(text()).toBe('0 measurements');
    await act(async () => {
      await made[0]?.viewer.measurements.add({
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
    });
    expect(text()).toBe('1 measurements');
    // Another study's measurements are kept by the viewer but are not this study's.
    await act(async () => {
      await made[0]?.viewer.measurements.add({
        type: 'length',
        reference: {
          studyInstanceUID: '9.9',
          seriesInstanceUID: FAKE_IDS.ct,
          sopInstanceUID: `${FAKE_IDS.ct}.0.5`,
        },
        points: [
          [0, 0, 0],
          [3, 4, 0],
        ],
      });
    });
    expect(
      made[0]?.viewer.measurements.list().some((item) => item.reference.studyInstanceUID === '9.9'),
    ).toBe(true);
    expect(text()).toBe('1 measurements');
    // And another study on screen starts the count again.
    await act(async () => {
      await made[0]?.viewer.loadStudy('1.2.4');
    });
    expect(text()).toBe('0 measurements');
    await act(async () => {
      await made[0]?.viewer.measurements.clear();
    });
    expect(text()).toBe('0 measurements');
  });

  it('removes a panel when it is no longer in the props', async () => {
    await render({
      hideSeriesPanel: true,
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
      panels: { notes: { title: 'Notes', render: () => <Probe /> } },
    });
    await render({
      hideSeriesPanel: true,
      hideMeasurementsPanel: true,
      hideSegmentationsPanel: true,
      panels: {},
    });
    expect(made[0]?.viewer.ui.panels()).toEqual([]);
  });

  it('gives hooks nothing before the viewer is ready', () => {
    // Rendered outside a viewer: no context, nothing to read.
    const holder = document.createElement('div');
    const alone = createRoot(holder);
    act(() => {
      alone.render(<Probe />);
    });
    expect(holder.textContent).toBe('no viewer');
    act(() => {
      alone.unmount();
    });
  });
});
