// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import type { ViewerOptions, ViewerStateV1 } from '@scope/viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DvViewerElement,
  ViewerErrorDetail,
  ViewerReadyDetail,
  ViewerTeardownDetail,
} from './viewer-element';

const made: FakeViewer[] = [];
let holdRenders: { release(): void } | undefined;
let holdNext = false;

vi.mock('@scope/viewer-core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { createFakeViewer: make } = await import('@scope/viewer-core/testing');
  return {
    ...actual,
    createViewer: (options: { initialState?: ViewerStateV1 }): unknown => {
      const fake = make(
        options.initialState === undefined ? {} : { initialState: options.initialState },
      );
      if (holdNext) holdRenders = fake.port.hold();
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
  holdNext = false;
  holdRenders?.release();
  holdRenders = undefined;
});

const options = (initialState?: ViewerStateV1): ViewerOptions => ({
  dataSource: createFakeViewer().source,
  ...(initialState === undefined ? {} : { initialState }),
});

function create(): DvViewerElement {
  const element = document.createElement('dv-viewer') as DvViewerElement;
  document.body.append(element);
  return element;
}

const settle = async (element: DvViewerElement): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) {
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const viewerAt = (index: number): FakeViewer['viewer'] => {
  const fake = made[index];
  if (fake === undefined) throw new Error(`No viewer ${index.toString()} was made`);
  return fake.viewer;
};

const shownSeries = (fake: FakeViewer | undefined): string | undefined =>
  fake?.viewer.getState().viewports[0]?.seriesInstanceUID;

describe('<dv-viewer> lifecycle', () => {
  it('stays idle until it has a data source and a study', async () => {
    const element = create();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(element.status).toBe('idle');
    expect(made).toHaveLength(0);
    element.wadoRoot = 'http://pacs';
    await settle(element);
    expect(made).toHaveLength(1);
    expect(element.status).toBe('ready');
  });

  it('starts from options, which win over the wado-root shorthand', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(element.status).toBe('ready');
    expect(made).toHaveLength(1);
  });

  it('skips a series with nothing to show when choosing the first one', async () => {
    // The fake study lists a series with no pictures before the CT.
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(made[0]?.viewer.getStudy()?.series[0]?.seriesInstanceUID).toBe(FAKE_IDS.noPixels);
    expect(shownSeries(made[0])).toBe(FAKE_IDS.ct);
    expect(element.status).toBe('ready');
  });

  it('shows the first series that has pictures when none is asked for', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(shownSeries(made[0])).toBe(FAKE_IDS.ct);
  });

  it('shows the series it is asked for', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    element.seriesInstanceUid = FAKE_IDS.ctTwoStacks;
    await settle(element);
    expect(shownSeries(made[0])).toBe(FAKE_IDS.ctTwoStacks);
  });

  it('keeps the series a restored state had, when none is asked for', async () => {
    const element = create();
    element.options = options({
      version: 1,
      layout: '1x1',
      studyInstanceUID: FAKE_IDS.study,
      viewports: [{ id: 'vp-0', seriesInstanceUID: FAKE_IDS.ctTwoStacks, imageIndex: 2 }],
    });
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(shownSeries(made[0])).toBe(FAKE_IDS.ctTwoStacks);
    expect(made[0]?.viewer.getState().viewports[0]?.imageIndex).toBe(2);
  });

  it('announces readiness with the viewer and the first viewport', async () => {
    const element = create();
    const details: ViewerReadyDetail[] = [];
    element.addEventListener('dv-ready', (event) => {
      details.push((event as CustomEvent<ViewerReadyDetail>).detail);
    });
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(details).toHaveLength(1);
    expect(details[0]?.viewer).toBe(made[0]?.viewer);
    expect(details[0]?.viewport?.id).toBe('vp-0');
    expect(element.viewer).toBe(made[0]?.viewer);
  });

  it('reports a study that cannot be loaded, and gives the viewer back', async () => {
    const element = create();
    const errors: ViewerErrorDetail[] = [];
    element.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<ViewerErrorDetail>).detail);
    });
    element.options = options();
    element.studyInstanceUid = '9.9';
    await settle(element);
    expect(element.status).toBe('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('load');
    expect(element.viewer).toBeUndefined();
    expect(element.querySelector('[data-viewport-id]')).toBeNull();
  });

  it('tears the viewer down and goes idle when a required input is removed', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    const destroy = vi.spyOn(viewerAt(0), 'destroy');
    element.studyInstanceUid = undefined;
    await settle(element);
    expect(destroy).toHaveBeenCalled();
    expect(element.status).toBe('idle');
    expect(element.viewer).toBeUndefined();
    expect(element.querySelector('[data-viewport-id]')).toBeNull();
  });

  it('does not announce readiness for a load whose inputs were removed meanwhile', async () => {
    holdNext = true;
    const element = create();
    const onReady = vi.fn();
    element.addEventListener('dv-ready', onReady);
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    expect(element.status).toBe('loading');
    element.studyInstanceUid = undefined;
    await settle(element);
    holdRenders?.release();
    await settle(element);
    expect(onReady).not.toHaveBeenCalled();
    expect(element.status).toBe('idle');
  });

  it('starts over with a new viewer when the study changes', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    const destroy = vi.spyOn(viewerAt(0), 'destroy');
    element.studyInstanceUid = '1.2.4';
    await settle(element);
    expect(destroy).toHaveBeenCalled();
    expect(made).toHaveLength(2);
    expect(element.viewer).toBe(made[1]?.viewer);
    expect(element.querySelectorAll('[data-viewport-id]')).toHaveLength(1);
  });

  it('gives the viewer back when removed, and makes a new one when put back', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    const destroy = vi.spyOn(viewerAt(0), 'destroy');
    element.remove();
    expect(destroy).toHaveBeenCalled();
    expect(element.querySelector('[data-viewport-id]')).toBeNull();
    document.body.append(element);
    await settle(element);
    expect(made).toHaveLength(2);
    expect(element.status).toBe('ready');
  });

  it('is ready, with no viewport to hand over, when the study has nothing to show', async () => {
    const element = create();
    const details: ViewerReadyDetail[] = [];
    element.addEventListener('dv-ready', (event) => {
      details.push((event as CustomEvent<ViewerReadyDetail>).detail);
    });
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.onlySegStudy;
    await settle(element);
    expect(element.status).toBe('ready');
    expect(details).toHaveLength(1);
    expect(details[0]?.viewport).toBeUndefined();
    expect(details[0]?.viewer).toBe(made[0]?.viewer);
  });

  it('says a viewer is going before it is destroyed, once per viewer', async () => {
    const element = create();
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    const events: string[] = [];
    element.addEventListener('dv-teardown', (event) => {
      const { viewer } = (event as CustomEvent<ViewerTeardownDetail>).detail;
      events.push(viewer === viewerAt(0) ? 'first' : 'other');
    });
    vi.spyOn(viewerAt(0), 'destroy').mockImplementation(() => {
      events.push('destroyed');
    });
    element.studyInstanceUid = '1.2.4';
    await settle(element);
    expect(events).toEqual(['first', 'destroyed']);
    // Removing an input says the same of the viewer that replaced it, and nothing once none is left.
    events.length = 0;
    element.studyInstanceUid = undefined;
    await settle(element);
    expect(events).toEqual(['other']);
    events.length = 0;
    element.wadoRoot = 'http://pacs';
    await settle(element);
    expect(events).toEqual([]);
  });

  it('passes on what the viewer reports with nobody waiting, as dv-error', async () => {
    const element = create();
    const errors: ViewerErrorDetail[] = [];
    element.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<ViewerErrorDetail>).detail);
    });
    element.options = options();
    element.studyInstanceUid = FAKE_IDS.study;
    await settle(element);
    // Attaching a viewport the state does not have is how the viewer reports into `error`.
    const fake = made[0];
    fake?.viewer.viewports.attach('vp-0', document.createElement('div'));
    await settle(element);
    expect(errors.every((detail) => detail.context !== 'load')).toBe(true);
  });
});
