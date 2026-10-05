// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, FAKE_DEFAULT_WINDOW, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, vp0, type Harness } from './testing/harness';
import type { ViewportApi } from './viewer-core';

destroyViewersAfterEach();

async function shown(
  h: Harness,
): Promise<{ api: ViewportApi; stack: NonNullable<Harness['port']['stacks'][number]> }> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT);
  const api = h.viewer.viewports.get('vp-0');
  const stack = h.port.stacks[0];
  if (api === undefined || stack === undefined) throw new Error('nothing is shown');
  return { api, stack };
}

describe('the view of a viewport', () => {
  it('is what the engine shows, and unknown until something is shown', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    expect(h.viewer.viewports.get('vp-0')?.getView()).toBeUndefined();
    const { api } = await shown(h);
    expect(api.getView()).toEqual({
      window: FAKE_DEFAULT_WINDOW,
      defaultWindow: FAKE_DEFAULT_WINDOW,
      invert: false,
      zoom: 1,
    });
  });

  it('is not in the state until it differs from the default', async () => {
    const h = harness();
    await shown(h);
    expect(vp0(h.viewer)).toMatchObject({ id: 'vp-0' });
    expect(vp0(h.viewer)).not.toHaveProperty('window');
    expect(vp0(h.viewer)).not.toHaveProperty('invert');
    expect(vp0(h.viewer)).not.toHaveProperty('zoom');
  });
});

describe('setWindow', () => {
  it('sets the window, records it as an API change, and announces it', async () => {
    const h = harness();
    const { api, stack } = await shown(h);

    await api.setWindow(-600, 1500);

    expect(stack.viewCalls).toEqual(['window -600/1500']);
    expect(vp0(h.viewer)?.window).toEqual({ center: -600, width: 1500 });
    expect(h.events['viewport:voi']).toEqual([
      {
        viewportId: 'vp-0',
        window: { center: -600, width: 1500 },
        defaultWindow: FAKE_DEFAULT_WINDOW,
        invert: false,
        origin: 'api',
      },
    ]);
  });

  it.each([
    ['a zero width', 40, 0],
    ['a negative width', 40, -5],
    ['a width that is not a number', 40, Number.NaN],
    ['a center that is not finite', Number.POSITIVE_INFINITY, 400],
  ])('refuses %s, and changes nothing', async (_name, center, width) => {
    const h = harness();
    const { api, stack } = await shown(h);
    await expect(api.setWindow(center, width)).rejects.toThrow(RangeError);
    expect(stack.viewCalls).toEqual([]);
  });

  it('forgets the window again when it is set back to the default', async () => {
    const h = harness();
    const { api } = await shown(h);
    await api.setWindow(-600, 1500);
    await api.setWindow(FAKE_DEFAULT_WINDOW.center, FAKE_DEFAULT_WINDOW.width);
    expect(vp0(h.viewer)).not.toHaveProperty('window');
  });

  it('fails clearly for a viewport that shows nothing', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    const api = h.viewer.viewports.get('vp-0');
    await expect(api?.setWindow(40, 400)).rejects.toThrow(/shows no series/);
  });
});

describe('invert and zoom', () => {
  it('inverts, toggles back, and announces each change', async () => {
    const h = harness();
    const { api } = await shown(h);

    await api.setInvert(true);
    expect(vp0(h.viewer)?.invert).toBe(true);
    await api.toggleInvert();
    expect(vp0(h.viewer)).not.toHaveProperty('invert');
    await api.toggleInvert();
    expect(api.getView()?.invert).toBe(true);
    expect(h.events['viewport:voi'].map((event) => event.invert)).toEqual([true, false, true]);
  });

  it('zooms, within the range the viewer supports', async () => {
    const h = harness();
    const { api, stack } = await shown(h);

    await api.setZoom(2);
    await api.setZoom(1000);
    await api.zoomBy(0.001);

    expect(stack.viewCalls).toEqual(['zoom 2', 'zoom 32', 'zoom 0.1']);
    expect(vp0(h.viewer)?.zoom).toBe(0.1);
    expect(h.events['viewport:camera'].map((event) => event.zoom)).toEqual([2, 32, 0.1]);
  });

  it('refuses a zoom that is not a positive number', async () => {
    const h = harness();
    const { api } = await shown(h);
    await expect(api.setZoom(0)).rejects.toThrow(RangeError);
    await expect(api.setZoom(Number.NaN)).rejects.toThrow(RangeError);
    await expect(api.zoomBy(-2)).rejects.toThrow(RangeError);
  });

  it('does not announce what did not change', async () => {
    const h = harness();
    const { api } = await shown(h);
    await api.setInvert(false);
    await api.setZoom(1);
    expect(h.events['viewport:voi']).toEqual([]);
    expect(h.events['viewport:camera']).toEqual([]);
  });
});

describe('resetView', () => {
  it('puts window, inversion, and zoom back, and the state with them', async () => {
    const h = harness();
    const { api, stack } = await shown(h);
    await api.setWindow(-600, 1500);
    await api.setInvert(true);
    await api.setZoom(3);

    await api.resetView();

    expect(stack.viewCalls.at(-1)).toBe('reset');
    expect(api.getView()).toMatchObject({ window: FAKE_DEFAULT_WINDOW, invert: false, zoom: 1 });
    expect(vp0(h.viewer)).toEqual({
      id: 'vp-0',
      seriesInstanceUID: CT,
      stackIndex: 0,
      imageIndex: 5,
    });
  });
});

describe('changes the user makes', () => {
  it('reach the state and the events as user changes', async () => {
    const h = harness();
    const { stack } = await shown(h);

    stack.emitView({ window: { center: 100, width: 300 } });
    stack.emitView({ zoom: 1.5 });

    expect(vp0(h.viewer)).toMatchObject({ window: { center: 100, width: 300 }, zoom: 1.5 });
    expect(h.events['viewport:voi'].at(-1)?.origin).toBe('user');
    expect(h.events['viewport:camera'].at(-1)).toMatchObject({ zoom: 1.5, origin: 'user' });
    const changes = h.events['state:changed'].filter((event) => event.origin === 'user');
    expect(changes).toHaveLength(2);
  });

  it('are not mistaken for the host asking, even right after a host call', async () => {
    const h = harness();
    const { api, stack } = await shown(h);
    await api.setZoom(2);
    stack.emitView({ zoom: 2.5 });
    expect(h.events['viewport:camera'].map((event) => event.origin)).toEqual(['api', 'user']);
  });
});

describe('restoring a view from the state', () => {
  const patch = {
    studyInstanceUID: STUDY,
    viewports: [
      {
        id: 'vp-0',
        seriesInstanceUID: CT,
        imageIndex: 4,
        window: { center: -600, width: 1500 },
        invert: true,
        zoom: 2,
      },
    ],
  };

  it('applies it to a stack it has just drawn, and says who asked', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);

    await h.viewer.setState(patch, { origin: 'url' });

    expect(h.port.stacks[0]?.viewCalls).toEqual(['window -600/1500', 'invert true', 'zoom 2']);
    expect(h.viewer.viewports.get('vp-0')?.getView()).toMatchObject({
      window: { center: -600, width: 1500 },
      invert: true,
      zoom: 2,
    });
    expect(h.events['viewport:voi'].every((event) => event.origin === 'url')).toBe(true);
    expect(vp0(h.viewer)).toMatchObject({
      window: { center: -600, width: 1500 },
      invert: true,
      zoom: 2,
    });
  });

  it('applies it from an initialState once the element is attached', async () => {
    const h = harness({
      initialState: { version: 1, layout: '1x1', ...patch },
    });
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.setState({});
    expect(h.port.stacks[0]?.getView()).toMatchObject({ invert: true, zoom: 2 });
  });

  it('changes a stack that is already shown, and returns it to the default when asked', async () => {
    const h = harness();
    const { api, stack } = await shown(h);
    await h.viewer.setState({ viewports: [{ id: 'vp-0', zoom: 3, invert: true }] });
    expect(stack.getView()).toMatchObject({ zoom: 3, invert: true });

    await h.viewer.setState({ viewports: [{ id: 'vp-0', zoom: undefined, invert: undefined }] });
    expect(api.getView()).toMatchObject({ zoom: 1, invert: false });
    expect(vp0(h.viewer)).not.toHaveProperty('zoom');
  });

  it('rejects a window or zoom that no viewer could show, and changes nothing', async () => {
    const h = harness();
    const { stack } = await shown(h);
    await expect(
      h.viewer.setState({ viewports: [{ id: 'vp-0', window: { center: 0, width: -1 } }] }),
    ).rejects.toThrow(/Invalid state/);
    await expect(h.viewer.setState({ viewports: [{ id: 'vp-0', zoom: 500 }] })).rejects.toThrow(
      /Invalid state/,
    );
    expect(stack.viewCalls).toEqual([]);
  });
});

describe('showing another series', () => {
  it('starts it with its own default view', async () => {
    const h = harness();
    const { api } = await shown(h);
    await api.setWindow(-600, 1500);
    await api.setZoom(2);

    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);

    expect(h.port.stacks[1]?.viewCalls).toEqual([]);
    expect(vp0(h.viewer)).not.toHaveProperty('window');
    expect(vp0(h.viewer)).not.toHaveProperty('zoom');
  });

  it('keeps the view when the same series is asked for again', async () => {
    const h = harness();
    const { api } = await shown(h);
    await api.setZoom(2);
    await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 7 });
    expect(vp0(h.viewer)?.zoom).toBe(2);
  });
});

describe('ordering', () => {
  it('applies a view change asked for right after a series switch to the new stack', async () => {
    const h = harness();
    const { api } = await shown(h);

    const switching = h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    const zooming = api.setZoom(4);
    await Promise.all([switching, zooming]);

    expect(h.port.stacks[0]?.viewCalls).toEqual([]);
    expect(h.port.stacks[1]?.viewCalls).toEqual(['zoom 4']);
  });
});
