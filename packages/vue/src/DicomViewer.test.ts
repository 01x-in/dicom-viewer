// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type {
  NavigateTarget,
  Viewer,
  ViewerOptions,
  ViewerStateV1,
  ViewportApi,
} from '@scope/viewer-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type App,
  createApp,
  defineComponent,
  h,
  isProxy,
  nextTick,
  reactive,
  type Ref,
  shallowReactive,
} from 'vue';
import { DicomViewer, type DicomViewerProps, useViewer, useViewerState } from './index';

const made: FakeViewer[] = [];
const received: ViewerOptions[] = [];

vi.mock('@scope/viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@scope/viewer-core/testing');
  return {
    ...actual,
    createViewer: (options: ViewerOptions): unknown => {
      received.push(options);
      const fake = make(
        options.initialState === undefined ? {} : { initialState: options.initialState },
      );
      made.push(fake);
      return fake.viewer;
    },
    createDicomWebDataSource: (): object => ({}),
  };
});

const options: ViewerOptions = { dataSource: createFakeViewer().source };
let host: HTMLElement;
let app: App | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  host.remove();
  made.length = 0;
  received.length = 0;
});

const element = (): HTMLElement => {
  const found = host.querySelector<HTMLElement>('dv-viewer');
  if (found === null) throw new Error('No <dv-viewer>');
  return found;
};

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type Slots = Record<string, () => ReturnType<typeof h>>;

/** The props a test can change while the component is mounted. */
type TestProps = { -readonly [K in keyof DicomViewerProps]?: DicomViewerProps[K] | undefined };

async function mount(initial: TestProps = {}, slots: Slots = {}): Promise<TestProps> {
  const props = shallowReactive<TestProps>({
    options,
    studyInstanceUid: FAKE_IDS.study,
    ...initial,
  });
  app = createApp({ render: () => h(DicomViewer, props as DicomViewerProps, slots) });
  app.mount(host);
  await settle();
  return props;
}

const shown = (): string | undefined =>
  made.at(-1)?.viewer.getState().viewports[0]?.seriesInstanceUID;

describe('<DicomViewer>', () => {
  it('renders the shell, sized to its parent, and shows the first series with pictures', async () => {
    await mount();
    expect(element().style.height).toBe('100%');
    expect(shown()).toBe(FAKE_IDS.ct);
    expect(element().getAttribute('status')).toBe('ready');
  });

  it('shows the series it is asked for', async () => {
    await mount({ seriesInstanceUid: FAKE_IDS.ctTwoStacks });
    expect(shown()).toBe(FAKE_IDS.ctTwoStacks);
  });

  it('emits ready with the viewer and the first viewport, once, and neither is a Proxy', async () => {
    const onReady = vi.fn();
    await mount({ onReady });
    expect(onReady).toHaveBeenCalledOnce();
    const [viewer, viewport] = onReady.mock.calls[0] as [Viewer, ViewportApi];
    expect(viewer).toBe(made[0]?.viewer);
    expect(viewport.id).toBe('vp-0');
    expect(isProxy(viewer)).toBe(false);
    expect(isProxy(viewport)).toBe(false);
  });

  it('gives the element the options as they are, not a reactive Proxy of them', async () => {
    const deep = reactive({ ...options });
    await mount({ options: deep });
    expect(received).toHaveLength(1);
    expect(isProxy(received[0])).toBe(false);
  });

  it('does not restart when props are set again to what they were', async () => {
    const props = await mount();
    props.hideSeriesPanel = false;
    props.theme = 'dark';
    await settle();
    expect(made).toHaveLength(1);
  });

  it('starts over when the study changes', async () => {
    const props = await mount();
    props.studyInstanceUid = '1.2.4';
    await settle();
    expect(made).toHaveLength(2);
  });

  it('emits error for a study that cannot be loaded', async () => {
    const onError = vi.fn();
    await mount({ studyInstanceUid: '9.9', onError });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0] as [Error])[0]).toBeInstanceOf(Error);
  });

  it('puts the slots in the shell, by name', async () => {
    await mount(
      {},
      {
        banner: () => h('b', 'Banner'),
        'toolbar-start': () => h('i', 'Start'),
        'toolbar-end': () => h('i', 'End'),
        'viewport-overlay': () => h('u', 'Over'),
      },
    );
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
    const props = await mount({ theme: 'light', toolbar: false });
    expect(element().getAttribute('data-theme')).toBe('light');
    expect(element().shadowRoot?.querySelector('dv-toolbar')).toBeNull();
    props.theme = 'dark';
    props.toolbar = undefined;
    await settle();
    expect(element().hasAttribute('data-theme')).toBe(false);
    expect(element().shadowRoot?.querySelector('dv-toolbar')).not.toBeNull();
  });

  it('emits every change of the state, with its origin', async () => {
    const onStateChange = vi.fn();
    await mount({ onStateChange });
    onStateChange.mockClear();
    await made[0]?.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks);
    expect(onStateChange).toHaveBeenCalled();
    const [state, origin] = onStateChange.mock.calls.at(-1) as [ViewerStateV1, string];
    expect(state.viewports[0]?.seriesInstanceUID).toBe(FAKE_IDS.ctTwoStacks);
    expect(origin).toBe('api');
  });

  it('shows an instance when asked to navigate, and again when the target changes', async () => {
    const target = (index: number): NavigateTarget => ({
      seriesInstanceUID: FAKE_IDS.ct,
      sopInstanceUID: `${FAKE_IDS.ct}.0.${index.toString()}`,
    });
    const props = await mount({ navigate: target(7) });
    expect(made[0]?.viewer.getState().viewports[0]?.imageIndex).toBe(7);
    props.navigate = target(2);
    await settle();
    expect(made[0]?.viewer.getState().viewports[0]?.imageIndex).toBe(2);
  });

  it('emits error for a navigate target that does not exist', async () => {
    const onError = vi.fn();
    await mount({
      onError,
      navigate: { seriesInstanceUID: FAKE_IDS.ct, sopInstanceUID: '1.9.9' },
    });
    expect(onError).toHaveBeenCalled();
  });

  it('restores an initial state', async () => {
    await mount({
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

describe('panels and composables', () => {
  let seenViewer: Readonly<Ref<Viewer | undefined>> | undefined;
  let seenSeries: Readonly<Ref<string | undefined>> | undefined;

  const Probe = defineComponent({
    setup() {
      seenViewer = useViewer();
      seenSeries = useViewerState((state) => state.viewports[0]?.seriesInstanceUID);
      return () =>
        h(
          'p',
          { 'data-probe': '' },
          seenViewer?.value === undefined ? 'no viewer' : `series ${seenSeries?.value ?? 'none'}`,
        );
    },
  });

  it('draws the content of a panel slot into the dock', async () => {
    await mount(
      { hideSeriesPanel: true, panels: [{ id: 'notes', title: 'Notes' }] },
      { 'panel-notes': () => h(Probe) },
    );
    const dock = element().shadowRoot?.querySelector('dv-panel-dock[placement="right"]');
    expect(dock?.shadowRoot?.querySelector('[data-probe]')?.textContent).toBe(
      `series ${FAKE_IDS.ct}`,
    );
    expect(made[0]?.viewer.ui.panels().map((panel) => panel.id)).toEqual(['notes']);
  });

  it('keeps a panel up to date as the state changes', async () => {
    await mount(
      { hideSeriesPanel: true, panels: [{ id: 'notes', title: 'Notes' }] },
      { 'panel-notes': () => h(Probe) },
    );
    await made[0]?.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks);
    await settle();
    const dock = element().shadowRoot?.querySelector('dv-panel-dock[placement="right"]');
    expect(dock?.shadowRoot?.querySelector('[data-probe]')?.textContent).toBe(
      `series ${FAKE_IDS.ctTwoStacks}`,
    );
  });

  it('gives the composable a raw viewer, and nothing before the viewer is ready', async () => {
    await mount(
      { hideSeriesPanel: true, panels: [{ id: 'notes', title: 'Notes' }] },
      { 'panel-notes': () => h(Probe) },
    );
    expect(seenViewer?.value).toBe(made[0]?.viewer);
    expect(isProxy(seenViewer?.value)).toBe(false);
  });

  it('removes a panel when it is no longer in the props', async () => {
    const props = await mount(
      { hideSeriesPanel: true, panels: [{ id: 'notes', title: 'Notes' }] },
      { 'panel-notes': () => h(Probe) },
    );
    props.panels = [];
    await settle();
    expect(made[0]?.viewer.ui.panels()).toEqual([]);
  });
});
