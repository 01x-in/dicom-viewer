// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DataSourceError } from './data/errors';
import { CT, CT_TWO_STACKS, fakeSource, SEG, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, track, vp0 } from './testing/harness';
import { parseViewerState, type ViewerStateV1 } from './state/viewer-state';
import { createViewerCore, type Viewer } from './viewer-core';
import type { Harness } from './testing/harness';

destroyViewersAfterEach();

describe('a new viewer', () => {
  it('starts empty, with one viewport, and becomes ready when the engine is up', async () => {
    const { viewer } = harness();
    expect(viewer.getState()).toEqual({ version: 1, layout: '1x1', viewports: [{ id: 'vp-0' }] });
    await expect(viewer.ready).resolves.toBeUndefined();
  });

  it('rejects an initial state that is not a ViewerStateV1', () => {
    // @ts-expect-error -- the type forbids it; the runtime check is for callers that cast or parse JSON
    expect(() => harness({ initialState: { version: 3 } })).toThrow(/initialState/);
  });

  it('reports a failing engine through ready, and from every call that needs it', async () => {
    const viewer = createViewerCore({ dataSource: fakeSource() }, () =>
      Promise.reject(new Error('no WebGL')),
    );
    track(viewer);
    await expect(viewer.ready).rejects.toThrow('no WebGL');
    viewer.viewports.attach('vp-0', document.createElement('div'));
    await expect(
      viewer.setState({
        studyInstanceUID: STUDY,
        viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
      }),
    ).rejects.toThrow('no WebGL');
  });
});

describe('loadStudy', () => {
  it('lists the series, remembers the study in the state, and announces it', async () => {
    const { viewer, events } = harness();

    const study = await viewer.loadStudy(STUDY);

    expect(study.series.map((series) => series.seriesInstanceUID)).toContain(CT);
    expect(viewer.getState().studyInstanceUID).toBe(STUDY);
    expect(events['study:loaded']).toEqual([{ study }]);
    expect(events['state:changed'].at(-1)?.origin).toBe('api');
  });

  it('rejects a UID that is not a UID, without asking the source', async () => {
    const { viewer, source } = harness();
    await expect(viewer.loadStudy('../etc')).rejects.toBeInstanceOf(DataSourceError);
    expect(source.calls).toEqual([]);
  });

  it('leaves the state alone when the study cannot be loaded', async () => {
    const { viewer } = harness();
    await expect(viewer.loadStudy('1.9.9')).rejects.toMatchObject({ status: 404 });
    expect(viewer.getState().studyInstanceUID).toBeUndefined();
  });

  it('clears what the viewports showed when another study is loaded', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });
    expect(port.stacks).toHaveLength(1);

    await viewer.loadStudy('1.2.4');

    expect(vp0(viewer)).toEqual({ id: 'vp-0' });
    expect(port.stacks[0]?.destroyed).toBe(true);
  });

  it('keeps the viewports when the same study is loaded again', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });
    await viewer.loadStudy(STUDY);
    expect(port.stacks[0]?.destroyed).toBe(false);
    expect(vp0(viewer)?.seriesInstanceUID).toBe(CT);
  });
});

describe('showing a series', () => {
  it('needs a study first', async () => {
    const { viewer } = harness();
    await expect(viewer.setViewportSeries('vp-0', CT)).rejects.toThrow(/study/i);
  });

  it('only knows the viewports in the state', async () => {
    const { viewer } = harness();
    await viewer.loadStudy(STUDY);
    await expect(viewer.setViewportSeries('vp-3', CT)).rejects.toThrow(/vp-3/);
  });

  it('records the choice and waits for an element when there is none yet', async () => {
    const { viewer, port, element } = harness();
    await viewer.loadStudy(STUDY);

    await viewer.setViewportSeries('vp-0', CT, { imageIndex: 2 });

    expect(vp0(viewer)).toMatchObject({ seriesInstanceUID: CT, imageIndex: 2 });
    expect(port.stacks).toEqual([]);

    viewer.viewports.attach('vp-0', element);
    await vi.waitFor(() => {
      expect(port.stacks).toHaveLength(1);
    });
    expect(port.stacks[0]?.getImageIndex()).toBe(2);
  });

  it('renders into the attached element, starting at the middle slice, and reports where it is', async () => {
    const { viewer, port, element, events } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);

    await viewer.setViewportSeries('vp-0', CT);

    expect(port.stacks[0]?.element).toBe(element);
    expect(vp0(viewer)).toEqual({
      id: 'vp-0',
      seriesInstanceUID: CT,
      stackIndex: 0,
      imageIndex: 5,
    });
    expect(events['viewport:image'].at(-1)).toEqual({
      viewportId: 'vp-0',
      imageIndex: 5,
      imageCount: 10,
      sopInstanceUID: `${CT}.0.5`,
      origin: 'api',
    });
  });

  it('shows the stack that was asked for when a series splits', async () => {
    const { viewer, port, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);

    await viewer.setViewportSeries('vp-0', CT_TWO_STACKS, { stackIndex: 1 });

    expect(port.stacks[0]?.stack.index).toBe(1);
    expect(port.stacks[0]?.imageCount).toBe(3);
    expect(vp0(viewer)?.stackIndex).toBe(1);
  });

  it.each([
    ['a stack that does not exist', CT, { stackIndex: 4 }, /stack/i],
    ['a series with nothing to display', SEG, {}, /no images/i],
    ['a series that does not exist', '1.2.3.77', {}, /no such series/],
  ])('fails for %s, and leaves the viewport empty', async (_name, series, options, message) => {
    const { viewer, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);

    await expect(viewer.setViewportSeries('vp-0', series, options)).rejects.toThrow(message);

    expect(vp0(viewer)).toEqual({ id: 'vp-0' });
  });

  it('clamps an image index that is out of range, and the state says where it landed', async () => {
    const { viewer, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    await viewer.setViewportSeries('vp-0', CT, { imageIndex: 99 });
    expect(vp0(viewer)?.imageIndex).toBe(9);
  });

  it('keeps a slice number the schema would refuse out of the state', async () => {
    const { viewer, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    for (const bad of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(viewer.setViewportSeries('vp-0', CT, { imageIndex: bad })).rejects.toThrow(
        RangeError,
      );
    }
    expect(vp0(viewer)).toEqual({ id: 'vp-0' });
    // Below the first slice is the first, as above the last is the last.
    await viewer.setViewportSeries('vp-0', CT, { imageIndex: -4 });
    expect(vp0(viewer)?.imageIndex).toBe(0);
    expect(parseViewerState(viewer.getState()).ok).toBe(true);
  });

  it('destroys the old stack before it draws the new series into the same element', async () => {
    const { viewer, port, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    await viewer.setViewportSeries('vp-0', CT);
    await viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(port.log).toEqual([
      `render fake:${CT}/0/0`,
      `destroy fake:${CT}/0/0`,
      `render fake:${CT_TWO_STACKS}/0/0`,
    ]);
  });

  it('does not render again for the same series, and only moves the slice', async () => {
    const { viewer, port, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    await viewer.setViewportSeries('vp-0', CT);
    await viewer.setViewportSeries('vp-0', CT, { imageIndex: 7 });
    expect(port.stacks).toHaveLength(1);
    expect(port.stacks[0]?.getImageIndex()).toBe(7);
    expect(vp0(viewer)?.imageIndex).toBe(7);
  });

  it('fetches a series once, however often it is shown', async () => {
    const { viewer, source, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    await viewer.setViewportSeries('vp-0', CT);
    await viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    await viewer.setViewportSeries('vp-0', CT);
    expect(source.calls.filter((call) => call === `getSeries ${STUDY} ${CT}`)).toHaveLength(1);
  });

  it('asks the source again after a failed fetch', async () => {
    const { viewer, source, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    source.failNext(503);
    await expect(viewer.setViewportSeries('vp-0', CT)).rejects.toMatchObject({ status: 503 });
    await viewer.setViewportSeries('vp-0', CT);
    expect(vp0(viewer)?.seriesInstanceUID).toBe(CT);
  });

  it('applies calls in the order they were made, even when an earlier one is slow', async () => {
    const { viewer, port, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    const hold = port.hold();

    const first = viewer.setViewportSeries('vp-0', CT);
    const second = viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    hold.release();
    await Promise.all([first, second]);

    expect(vp0(viewer)?.seriesInstanceUID).toBe(CT_TWO_STACKS);
    expect(
      port.stacks.filter((stack) => !stack.destroyed).map((stack) => stack.stack.imageIds[0]),
    ).toEqual([`fake:${CT_TWO_STACKS}/0/0`]);
  });
});

describe('scrolling', () => {
  async function shown(): Promise<
    Harness & { api: NonNullable<ReturnType<Viewer['viewports']['get']>> }
  > {
    const context = harness();
    context.viewer.viewports.attach('vp-0', context.element);
    await context.viewer.loadStudy(STUDY);
    await context.viewer.setViewportSeries('vp-0', CT);
    const api = context.viewer.viewports.get('vp-0');
    if (api === undefined) throw new Error('no viewport');
    return { ...context, api };
  }

  it('moves to a slice on request and reports it as an API change', async () => {
    const { api, viewer, events } = await shown();
    await api.setImageIndex(2);
    expect(api.getImageIndex()).toBe(2);
    expect(vp0(viewer)?.imageIndex).toBe(2);
    expect(events['viewport:image'].at(-1)).toMatchObject({ imageIndex: 2, origin: 'api' });
    expect(events['state:changed'].at(-1)?.origin).toBe('api');
  });

  it('scrolls by an amount, stopping at the ends', async () => {
    const { api } = await shown();
    await api.scrollBy(2);
    expect(api.getImageIndex()).toBe(7);
    await api.scrollBy(100);
    expect(api.getImageIndex()).toBe(9);
    await api.scrollBy(-100);
    expect(api.getImageIndex()).toBe(0);
  });

  it('refuses a slice that does not exist', async () => {
    const { api } = await shown();
    await expect(api.setImageIndex(10)).rejects.toBeInstanceOf(RangeError);
    await expect(api.setImageIndex(-1)).rejects.toBeInstanceOf(RangeError);
    await expect(api.setImageIndex(1.5)).rejects.toBeInstanceOf(RangeError);
  });

  it('reports a change the user made, such as the mouse wheel, as a user change', async () => {
    const { port, viewer, events } = await shown();
    port.stacks[0]?.emitImage(8);
    expect(vp0(viewer)?.imageIndex).toBe(8);
    expect(events['viewport:image'].at(-1)).toMatchObject({ imageIndex: 8, origin: 'user' });
    expect(events['state:changed'].at(-1)?.origin).toBe('user');
  });

  it('keeps the slice when the series on screen is asked for again without one', async () => {
    const { api, viewer } = await shown();
    await api.setImageIndex(3);
    await viewer.setViewportSeries('vp-0', CT);
    expect(vp0(viewer)?.imageIndex).toBe(3);
    expect(api.getImageIndex()).toBe(3);
  });

  it('takes a pixel sample after the calls queued before it, from the stack then on screen', async () => {
    const { api, viewer, port } = await shown();
    const hold = port.hold();
    const switching = viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    const sampling = api.sampleHu(1, 2, 3);
    hold.release();
    await switching;
    await expect(sampling).resolves.toBe(1023);

    const [before, after] = port.stacks;
    expect(before?.samples).toEqual([]);
    expect(after?.stack.imageIds[0]).toContain(CT_TWO_STACKS);
    expect(after?.samples).toEqual([{ imageIndex: 1, row: 2, column: 3 }]);
  });

  it('says nothing when the slice did not change', async () => {
    const { api, events } = await shown();
    const before = events['viewport:image'].length;
    await api.setImageIndex(api.getImageIndex() ?? 0);
    expect(events['viewport:image']).toHaveLength(before);
  });

  it('describes what the viewport shows', async () => {
    const { api } = await shown();
    expect(api.id).toBe('vp-0');
    expect(api.series).toEqual({ seriesInstanceUID: CT, stackIndex: 0, imageCount: 10 });
  });

  it('lets a subscriber watch one part of the state', async () => {
    const { api, viewer } = await shown();
    const seen: (number | undefined)[] = [];
    viewer.subscribe(
      (state) => state.viewports[0]?.imageIndex,
      (index) => seen.push(index),
    );
    await api.setImageIndex(1);
    await api.setImageIndex(3);
    expect(seen).toEqual([1, 3]);
  });

  it('passes pixel sampling through to the engine', async () => {
    const { api } = await shown();
    await expect(api.sampleHu(2, 3, 4)).resolves.toBe(2034);
  });

  it('loads a SEG against the displayed stack, retrieving it with its own modality', async () => {
    const { api, port, source } = await shown();
    const handle = await api.loadSegmentation(SEG);
    expect(handle.segments).toEqual([{ number: 1, label: 'Body' }]);
    expect(port.segmentationCalls[0]?.imageIds).toHaveLength(10);
    expect(source.calls).toContain(`getInstanceBytes ${SEG} SEG`);
  });
});

describe('a viewport without a series', () => {
  it('says so instead of guessing', async () => {
    const { viewer, element } = harness();
    viewer.viewports.attach('vp-0', element);
    const api = viewer.viewports.get('vp-0');
    expect(api?.series).toBeUndefined();
    expect(api?.imageCount).toBe(0);
    expect(api?.getImageIndex()).toBeUndefined();
    await expect(api?.setImageIndex(0)).rejects.toThrow(/shows no series/);
    await expect(api?.sampleHu(0, 0, 0)).rejects.toThrow(/shows no series/);
  });
});

describe('setState', () => {
  it('restores a study, a series, and a slice together, and resolves once it is displayed', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);

    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT, imageIndex: 3 }],
    });

    expect(port.stacks[0]?.getImageIndex()).toBe(3);
    expect(vp0(viewer)).toEqual({
      id: 'vp-0',
      seriesInstanceUID: CT,
      stackIndex: 0,
      imageIndex: 3,
    });
  });

  it('attributes a slice change it makes to whoever asked, not to the user', async () => {
    const { viewer, element, events } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });

    await viewer.setState({ viewports: [{ id: 'vp-0', imageIndex: 2 }] }, { origin: 'url' });

    expect(events['viewport:image'].at(-1)).toMatchObject({ imageIndex: 2, origin: 'url' });
    expect(events['state:changed'].at(-1)?.origin).toBe('url');
  });

  it('marks a restored link as a url change', async () => {
    const { viewer, events } = harness();
    await viewer.setState({ studyInstanceUID: STUDY }, { origin: 'url' });
    expect(events['state:changed'].at(-1)?.origin).toBe('url');
  });

  it('rejects a patch that is not a valid state, and changes nothing', async () => {
    const { viewer } = harness();
    await expect(viewer.setState({ studyInstanceUID: '../x' })).rejects.toThrow(/state/i);
    await expect(viewer.setState({ viewports: [{ id: 'main' }] })).rejects.toThrow(
      /no viewport main/,
    );
    expect(viewer.getState()).toEqual({ version: 1, layout: '1x1', viewports: [{ id: 'vp-0' }] });
  });

  it('does not touch what the patch leaves out', async () => {
    const { viewer, element } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });
    await viewer.setState({ viewports: [{ id: 'vp-0', imageIndex: 1 }] });
    expect(vp0(viewer)).toMatchObject({ seriesInstanceUID: CT, imageIndex: 1 });
  });
});

describe('a failed restore', () => {
  it('empties the viewport with the origin of the call that failed', async () => {
    const { viewer, element, events } = harness();
    viewer.viewports.attach('vp-0', element);
    await expect(
      viewer.setState(
        { studyInstanceUID: STUDY, viewports: [{ id: 'vp-0', seriesInstanceUID: '1.2.3.77' }] },
        { origin: 'url' },
      ),
    ).rejects.toThrow(/no such series/);
    expect(events['state:changed'].map((event) => event.origin)).toEqual(['url', 'url']);
    expect(vp0(viewer)).toEqual({ id: 'vp-0' });
  });
});

describe('initialState', () => {
  const initialState: ViewerStateV1 = {
    version: 1,
    studyInstanceUID: STUDY,
    layout: '1x1',
    viewports: [{ id: 'vp-0', seriesInstanceUID: CT, imageIndex: 4 }],
  };

  it('shows the restored series as soon as an element is attached', async () => {
    const { viewer, element, port } = harness({ initialState });
    expect(vp0(viewer)).toMatchObject({ seriesInstanceUID: CT, imageIndex: 4 });
    viewer.viewports.attach('vp-0', element);
    await vi.waitFor(() => {
      expect(port.stacks).toHaveLength(1);
    });
    expect(port.stacks[0]?.getImageIndex()).toBe(4);
  });

  it('reports a series that cannot be shown through the error event, not as a rejection nobody sees', async () => {
    const { viewer, element, events } = harness({
      initialState: { ...initialState, viewports: [{ id: 'vp-0', seriesInstanceUID: '1.2.3.77' }] },
    });
    viewer.viewports.attach('vp-0', element);
    await vi.waitFor(() => {
      expect(events.error).toHaveLength(1);
    });
    expect(events.error[0]).toMatchObject({ context: 'attach' });
    expect(events.error[0]?.error.message).toMatch(/no such series/);
    expect(vp0(viewer)).toEqual({ id: 'vp-0' });
  });
});

describe('attaching and detaching', () => {
  it('detach clears the element and keeps what the viewport should show', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });

    viewer.viewports.detach('vp-0');
    await vi.waitFor(() => {
      expect(port.stacks[0]?.destroyed).toBe(true);
    });
    expect(viewer.viewports.get('vp-0')).toBeUndefined();
    expect(vp0(viewer)?.seriesInstanceUID).toBe(CT);

    viewer.viewports.attach('vp-0', document.createElement('div'));
    await vi.waitFor(() => {
      expect(port.stacks).toHaveLength(2);
    });
  });

  it('moves the display when another element is attached to the same viewport', async () => {
    const { viewer, element, port } = harness();
    const other = document.createElement('div');
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });
    viewer.viewports.attach('vp-0', other);
    await vi.waitFor(() => {
      expect(port.stacks).toHaveLength(2);
    });
    expect(port.stacks[0]?.destroyed).toBe(true);
    expect(port.stacks[1]?.element).toBe(other);
  });

  it('drops a render that finished after the element was detached', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    const hold = port.hold();
    const pending = viewer.setViewportSeries('vp-0', CT);
    await vi.waitFor(() => {
      expect(port.log).toHaveLength(1);
    });
    viewer.viewports.detach('vp-0');
    hold.release();
    await pending.catch(() => undefined);
    await vi.waitFor(() => {
      expect(port.stacks[0]?.destroyed).toBe(true);
    });
  });

  it('refuses an id the state does not have', () => {
    const { viewer, element } = harness();
    expect(() => {
      viewer.viewports.attach('vp-2', element);
    }).toThrow(/vp-2/);
  });

  it('lists the attached viewports', () => {
    const { viewer, element } = harness();
    viewer.viewports.attach('vp-0', element);
    expect(viewer.viewports.list().map((viewport) => viewport.id)).toEqual(['vp-0']);
  });
});

describe('destroy', () => {
  it('destroys every stack and the engine, and is safe to call twice', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.setState({
      studyInstanceUID: STUDY,
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT }],
    });

    viewer.destroy();
    viewer.destroy();

    expect(port.stacks[0]?.destroyed).toBe(true);
    await vi.waitFor(() => {
      expect(port.destroyed).toBe(true);
    });
  });

  it('fails later calls with a clear error', async () => {
    const { viewer } = harness();
    viewer.destroy();
    await expect(viewer.loadStudy(STUDY)).rejects.toThrow(/destroyed/);
    await expect(viewer.setViewportSeries('vp-0', CT)).rejects.toThrow(/destroyed/);
    expect(() => {
      viewer.viewports.attach('vp-0', document.createElement('div'));
    }).toThrow(/destroyed/);
  });

  it('stops announcing changes after destroy', async () => {
    const { viewer, events } = harness();
    viewer.destroy();
    await viewer.setState({ studyInstanceUID: STUDY }).catch(() => undefined);
    expect(events['state:changed']).toEqual([]);
  });

  it('does not leave a stack behind when a render finishes after destroy', async () => {
    const { viewer, element, port } = harness();
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(STUDY);
    const hold = port.hold();
    const pending = viewer.setViewportSeries('vp-0', CT).catch(() => undefined);
    await vi.waitFor(() => {
      expect(port.log).toHaveLength(1);
    });
    viewer.destroy();
    hold.release();
    await pending;
    await vi.waitFor(() => {
      expect(port.stacks.every((stack) => stack.destroyed)).toBe(true);
    });
  });
});
