// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type { Viewer, ViewerOptions, ViewerStateV1 } from '@scope/viewer-core';
import { type JSX, type RefObject, StrictMode, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DicomViewer, type DicomViewerProps, useViewer, useViewerState } from './index';

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
  // The element, the dynamic import, and the fake viewer each take a few turns.
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

  it('removes a panel when it is no longer in the props', async () => {
    await render({
      hideSeriesPanel: true,
      panels: { notes: { title: 'Notes', render: () => <Probe /> } },
    });
    await render({ hideSeriesPanel: true, panels: {} });
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
