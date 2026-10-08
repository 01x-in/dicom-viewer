// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { NotReconstructable } from './data/types';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import type { ViewportApi } from './viewer-core';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

// The fake CT is 256 rows by 512 columns by 10 slices: 5,242,880 bytes as a volume.
const CT_BYTES = 256 * 512 * 10 * 4;

async function ready(h: Harness, layout: '1x1' | '1x2' | '2x2' = '1x1'): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  if (layout !== '1x1') await h.viewer.setLayout(layout);
}

/** Makes the fake source say the CT cannot be reconstructed. */
function notReconstructable(h: Harness, reason: NotReconstructable): void {
  const original = h.source.getSeries.bind(h.source);
  h.source.getSeries = async (study, series) => {
    const loaded = await original(study, series);
    return {
      ...loaded,
      stacks: loaded.stacks.map((stack) => ({ ...stack, reconstructable: { ok: false, reason } })),
    };
  };
}

const plane = (h: Harness, id = 'vp-0'): ViewportApi | undefined => h.viewer.viewports.get(id);

describe('a viewport that asks for a plane', () => {
  it('shows the series as a volume in that plane, and says so', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(h.port.volumeCalls).toHaveLength(1);
    expect(h.port.volumeCalls[0]).toMatch(/^coronal /);
    expect(h.port.stacks[0]?.orientation).toBe('coronal');
    expect(plane(h)?.mpr).toEqual({ requested: 'coronal', mode: 'volume' });
    // A coronal plane has one slice for each row of the image.
    expect(plane(h)?.imageCount).toBe(256);
    expect(h.viewer.getState().viewports[0]).toMatchObject({
      seriesInstanceUID: CT,
      orientation: 'coronal',
    });
  });

  it('has no mpr information when it shows the slices as they were acquired', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(plane(h)?.mpr).toBeUndefined();
    expect(h.port.volumeCalls).toEqual([]);
  });

  it('asks for the slice it was given, counted along the plane', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'sagittal', imageIndex: 100 });
    expect(h.port.stacks[0]?.renderOptions.imageIndex).toBe(100);
    expect(plane(h)?.getImageIndex()).toBe(100);
    expect(plane(h)?.imageCount).toBe(512);
  });

  it('scrolls through the slices of the plane', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal', imageIndex: 10 });
    await plane(h)?.scrollBy(5);
    expect(plane(h)?.getImageIndex()).toBe(15);
    await expect(plane(h)?.setImageIndex(256)).rejects.toThrow(RangeError);
  });

  it('draws again when the plane changes, and back to slices when none is asked for', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'sagittal' });
    expect(h.port.volumeCalls.map((call) => call.split(' ')[0])).toEqual(['coronal', 'sagittal']);
    expect(h.port.stacks[0]?.destroyed).toBe(true);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(plane(h)?.mpr).toBeUndefined();
    expect(h.viewer.getState().viewports[0]?.orientation).toBeUndefined();
    expect(h.port.stacks).toHaveLength(3);
  });

  it('does not draw again for the plane it already shows', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'axial' });
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'axial' });
    expect(h.port.volumeCalls).toHaveLength(1);
  });

  it('refuses a plane that does not exist, and changes nothing', async () => {
    const h = harness();
    await ready(h);
    await expect(
      h.viewer.setViewportSeries('vp-0', CT, { orientation: 'oblique' as 'axial' }),
    ).rejects.toThrow(RangeError);
    expect(h.viewer.getState().viewports[0]?.seriesInstanceUID).toBeUndefined();
  });

  it('keeps the window it was given for a view change like the slices do', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    await plane(h)?.setWindow(100, 300);
    expect(h.viewer.getState().viewports[0]?.window).toEqual({ center: 100, width: 300 });
  });

  it('shows the overlay in a plane, from the first image of the series', async () => {
    const h = harness({ viewer: { overlay: {} } });
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal', imageIndex: 200 });
    const text = h.element.textContent;
    expect(text).toContain('Image 201 / 256');
    expect(text).toContain('coronal');
  });
});

describe('a series that cannot be reformatted', () => {
  it.each(['tilted', 'non-uniform-spacing', 'too-few-slices', 'missing-geometry'] as const)(
    'shows the slices and says why (%s)',
    async (reason) => {
      const h = harness();
      notReconstructable(h, reason);
      await ready(h);
      await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
      expect(h.port.volumeCalls).toEqual([]);
      expect(h.port.stacks[0]?.orientation).toBeUndefined();
      expect(plane(h)?.mpr).toEqual({ requested: 'coronal', mode: 'stack', reason });
      expect(plane(h)?.imageCount).toBe(10);
      // The state is what was asked for, so a link made here asks again where it can be done.
      expect(h.viewer.getState().viewports[0]?.orientation).toBe('coronal');
    },
  );

  it('tells the shell with an event, for a volume and for a fallback', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(h.events['viewport:mpr']).toEqual([
      { viewportId: 'vp-0', requested: 'coronal', mode: 'volume' },
    ]);
    h.events['viewport:mpr'].length = 0;
    notReconstructable(h, 'tilted');
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS, { orientation: 'sagittal' });
    expect(h.events['viewport:mpr']).toEqual([
      { viewportId: 'vp-0', requested: 'sagittal', mode: 'stack', reason: 'tilted' },
    ]);
  });

  it('says nothing when the viewport goes back to slices', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    h.events['viewport:mpr'].length = 0;
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(h.events['viewport:mpr']).toEqual([]);
  });

  it('falls back to slices when the engine cannot draw a volume', async () => {
    const h = harness();
    h.port.volumeUnsupported = true;
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(plane(h)?.mpr).toEqual({
      requested: 'coronal',
      mode: 'stack',
      reason: 'engine-unsupported',
    });
    expect(h.port.stacks[0]?.orientation).toBeUndefined();
  });

  it('leaves the viewport empty, and reports it, when the volume fails for another reason', async () => {
    const h = harness();
    const original = h.port.renderVolume.bind(h.port);
    h.port.renderVolume = () => Promise.reject(new Error('the volume would not load'));
    await ready(h);
    await expect(
      h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' }),
    ).rejects.toThrow('the volume would not load');
    expect(h.viewer.getState().viewports[0]?.seriesInstanceUID).toBeUndefined();
    h.port.renderVolume = original;
  });
});

describe('the memory budget', () => {
  it('refuses a volume that is over it, and shows the slices', async () => {
    const h = harness({ viewer: { memory: { maxCacheBytes: CT_BYTES - 1 } } });
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(plane(h)?.mpr).toEqual({
      requested: 'coronal',
      mode: 'stack',
      reason: 'over-memory-budget',
    });
  });

  it('accepts a volume that is exactly the budget', async () => {
    const h = harness({ viewer: { memory: { maxCacheBytes: CT_BYTES } } });
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(plane(h)?.mpr?.mode).toBe('volume');
  });

  it('counts a volume once however many planes show it', async () => {
    const h = harness({ viewer: { memory: { maxCacheBytes: CT_BYTES } } });
    await ready(h, '2x2');
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    h.viewer.viewports.attach('vp-2', document.createElement('div'));
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'axial' });
    await h.viewer.setViewportSeries('vp-1', CT, { orientation: 'sagittal' });
    await h.viewer.setViewportSeries('vp-2', CT, { orientation: 'coronal' });
    expect(['vp-0', 'vp-1', 'vp-2'].map((id) => plane(h, id)?.mpr?.mode)).toEqual([
      'volume',
      'volume',
      'volume',
    ]);
  });

  it('counts a second volume against the first, and frees the first when its viewports go', async () => {
    const h = harness({ viewer: { memory: { maxCacheBytes: CT_BYTES + 100 } } });
    await ready(h, '1x2');
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    await h.viewer.setViewportSeries('vp-1', CT_TWO_STACKS, { orientation: 'coronal' });
    // The two stacks of CT_TWO_STACKS are 6 and 3 slices: this one is 6 * 256 * 512 * 4 = 3 MiB.
    expect(plane(h, 'vp-1')?.mpr).toMatchObject({ mode: 'stack', reason: 'over-memory-budget' });
    await h.viewer.setViewportSeries('vp-0', CT);
    await h.viewer.setViewportSeries('vp-1', CT_TWO_STACKS, { orientation: 'coronal' });
    expect(plane(h, 'vp-1')?.mpr?.mode).toBe('volume');
  });

  it('is 1 GiB unless the host says otherwise', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(plane(h)?.mpr?.mode).toBe('volume');
  });

  it('refuses a budget that is not a positive number', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => harness({ viewer: { memory: { maxCacheBytes: bad } } })).toThrow(RangeError);
    }
  });
});

describe('the plane in the state', () => {
  it('is restored from a state, including the fallback', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setState({
      viewports: [{ id: 'vp-0', seriesInstanceUID: CT, orientation: 'sagittal' }],
    });
    expect(plane(h)?.mpr).toEqual({ requested: 'sagittal', mode: 'volume' });
  });

  it('is dropped by navigateTo, which names an instance and so a slice', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    await h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.4` });
    expect(plane(h)?.mpr).toBeUndefined();
    expect(h.viewer.getState().viewports[0]).toMatchObject({ imageIndex: 4 });
  });

  it('is cleared with the series when the study changes', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    await h.viewer.loadStudy('1.2.4');
    expect(h.viewer.getState().viewports[0]).toEqual({ id: 'vp-0' });
  });
});
