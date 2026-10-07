// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function planes(): Promise<Harness> {
  const h = harness();
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setLayout('2x2');
  for (const id of ['vp-1', 'vp-2', 'vp-3']) {
    h.viewer.viewports.attach(id, document.createElement('div'));
  }
  await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'axial' });
  await h.viewer.setViewportSeries('vp-1', CT, { orientation: 'sagittal' });
  await h.viewer.setViewportSeries('vp-2', CT, { orientation: 'coronal' });
  return h;
}

const windows = (h: Harness): (object | undefined)[] =>
  h.viewer.getState().viewports.map((viewport) => viewport.window);
const inverts = (h: Harness): (boolean | undefined)[] =>
  h.viewer.getState().viewports.map((viewport) => viewport.invert);

describe('the window of the planes of one volume', () => {
  it('follows a change made in any plane', async () => {
    const h = await planes();
    await h.viewer.viewports.get('vp-2')?.setWindow(300, 1500);
    const want = { center: 300, width: 1500 };
    expect(windows(h).slice(0, 3)).toEqual([want, want, want]);
    expect(h.viewer.viewports.get('vp-0')?.getView()?.window).toEqual(want);
  });

  it('follows the inversion too', async () => {
    const h = await planes();
    await h.viewer.viewports.get('vp-0')?.setInvert(true);
    expect(inverts(h).slice(0, 3)).toEqual([true, true, true]);
    await h.viewer.viewports.get('vp-1')?.setInvert(false);
    expect(h.viewer.viewports.get('vp-2')?.getView()?.invert).toBe(false);
  });

  it('follows a window the person drags with the mouse, as a user change', async () => {
    const h = await planes();
    const before = h.events['viewport:voi'].length;
    h.port.stacks[1]?.emitView({ window: { center: 20, width: 80 } });
    expect(windows(h).slice(0, 3)).toEqual([
      { center: 20, width: 80 },
      { center: 20, width: 80 },
      { center: 20, width: 80 },
    ]);
    const added = h.events['viewport:voi'].slice(before);
    expect(added.map((event) => event.viewportId).sort()).toEqual(['vp-0', 'vp-1', 'vp-2']);
    expect(added.every((event) => event.origin === 'user')).toBe(true);
  });

  it('does not run on forever: each plane reports once', async () => {
    const h = await planes();
    const before = h.events['viewport:voi'].length;
    await h.viewer.viewports.get('vp-0')?.setWindow(10, 20);
    expect(h.events['viewport:voi'].length - before).toBe(3);
  });

  it('leaves the zoom of each plane alone', async () => {
    const h = await planes();
    await h.viewer.viewports.get('vp-0')?.setZoom(3);
    expect(h.viewer.getState().viewports.map((viewport) => viewport.zoom)).toEqual([
      3,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('leaves alone a plane of another series, and a viewport that shows the slices', async () => {
    const h = await planes();
    await h.viewer.setViewportSeries('vp-3', CT);
    await h.viewer.viewports.get('vp-0')?.setWindow(1, 2);
    expect(windows(h)[3]).toBeUndefined();
    await h.viewer.setViewportSeries('vp-1', CT_TWO_STACKS, { orientation: 'coronal' });
    await h.viewer.viewports.get('vp-0')?.setWindow(5, 6);
    expect(windows(h)[1]).toBeUndefined();
  });

  it('is not applied to planes that fell back to slices, which are not one volume', async () => {
    const h = await planes();
    const original = h.source.getSeries.bind(h.source);
    h.source.getSeries = async (study, series) => {
      const loaded = await original(study, series);
      return {
        ...loaded,
        stacks: loaded.stacks.map((stack) => ({
          ...stack,
          reconstructable: { ok: false, reason: 'tilted' } as const,
        })),
      };
    };
    await h.viewer.setViewportSeries('vp-3', CT_TWO_STACKS, { orientation: 'axial' });
    await h.viewer.viewports.get('vp-0')?.setWindow(7, 8);
    expect(windows(h)[3]).toBeUndefined();
  });
});
