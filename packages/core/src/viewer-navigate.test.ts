// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, SEG, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, vp0, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function ready(h: Harness): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
}

describe('navigateTo', () => {
  it('shows the slice an instance is, in a series that was not on screen, and says where it landed', async () => {
    const h = harness();
    await ready(h);

    const result = await h.viewer.navigateTo({
      seriesInstanceUID: CT,
      sopInstanceUID: `${CT}.0.7`,
    });

    expect(result).toEqual({
      viewportId: 'vp-0',
      seriesInstanceUID: CT,
      stackIndex: 0,
      imageIndex: 7,
      sopInstanceUID: `${CT}.0.7`,
    });
    expect(vp0(h.viewer)).toMatchObject({ seriesInstanceUID: CT, stackIndex: 0, imageIndex: 7 });
    expect(h.port.stacks[0]?.getImageIndex()).toBe(7);
  });

  it('asks the engine for the target slice first, not the middle one', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.9` });
    expect(h.port.stacks[0]?.renderOptions.imageIndex).toBe(9);
  });

  it('finds the stack of a series that splits, and uses it', async () => {
    const h = harness();
    await ready(h);
    const result = await h.viewer.navigateTo({
      seriesInstanceUID: CT_TWO_STACKS,
      sopInstanceUID: `${CT_TWO_STACKS}.1.2`,
    });
    expect(result).toMatchObject({ stackIndex: 1, imageIndex: 2 });
    expect(h.port.stacks[0]?.stack.index).toBe(1);
  });

  it('only moves the slice when the series is already on screen', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT);
    await h.viewer.viewports.get('vp-0')?.setZoom(2);

    await h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.1` });

    expect(h.port.stacks).toHaveLength(1);
    expect(vp0(h.viewer)).toMatchObject({ imageIndex: 1, zoom: 2 });
    expect(h.events['viewport:image'].at(-1)).toMatchObject({ imageIndex: 1, origin: 'api' });
  });

  it('can aim at another viewport', async () => {
    const h = harness();
    await ready(h);
    await expect(
      h.viewer.navigateTo({
        seriesInstanceUID: CT,
        sopInstanceUID: `${CT}.0.1`,
        viewportId: 'vp-2',
      }),
    ).rejects.toThrow(/no viewport vp-2/);
  });

  it('records the target when no element is attached yet, and shows it once there is one', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    const result = await h.viewer.navigateTo({
      seriesInstanceUID: CT,
      sopInstanceUID: `${CT}.0.3`,
    });
    expect(result.imageIndex).toBe(3);
    expect(h.port.stacks).toHaveLength(0);
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.setState({});
    expect(h.port.stacks[0]?.getImageIndex()).toBe(3);
  });

  it('accepts frame 1, because every image has one', async () => {
    const h = harness();
    await ready(h);
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.2`, frameNumber: 1 }),
    ).resolves.toMatchObject({ imageIndex: 2 });
  });

  it.each([
    ['a frame beyond the first, since multi-frame images are not supported yet', 2, /multi-frame/i],
    ['a frame number of zero', 0, /frame/i],
    ['a frame number that is not a whole number', 1.5, /frame/i],
  ])('refuses %s', async (_name, frameNumber, message) => {
    const h = harness();
    await ready(h);
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.2`, frameNumber }),
    ).rejects.toThrow(message);
    expect(h.port.stacks).toHaveLength(0);
  });

  it('fails clearly for an instance the series does not have, and leaves the viewport as it was', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 2 });
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: '1.2.3.1.9.9' }),
    ).rejects.toThrow(/no instance 1\.2\.3\.1\.9\.9/);
    expect(vp0(h.viewer)).toMatchObject({ seriesInstanceUID: CT, imageIndex: 2 });
    expect(h.port.stacks[0]?.destroyed).toBe(false);
  });

  it('fails for a series with no images, and one that does not exist', async () => {
    const h = harness();
    await ready(h);
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: SEG, sopInstanceUID: `${SEG}.0.0` }),
    ).rejects.toThrow(/no images/i);
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: '1.2.3.77', sopInstanceUID: '1.2.3.77.1' }),
    ).rejects.toThrow(/no such series/);
  });

  it('needs a study, and UIDs that are UIDs, before it asks the source anything', async () => {
    const h = harness();
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.1` }),
    ).rejects.toThrow(/Load a study first/);
    await ready(h);
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: 'not/a/uid', sopInstanceUID: `${CT}.0.1` }),
    ).rejects.toThrow(/SeriesInstanceUID/);
    await expect(
      h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: '../x' }),
    ).rejects.toThrow(/SOPInstanceUID/);
    expect(h.source.calls.filter((call) => call.startsWith('getSeries'))).toEqual([]);
  });

  it('is applied in the order it was made', async () => {
    const h = harness();
    await ready(h);
    const first = h.viewer.navigateTo({ seriesInstanceUID: CT, sopInstanceUID: `${CT}.0.2` });
    const second = h.viewer.navigateTo({
      seriesInstanceUID: CT_TWO_STACKS,
      sopInstanceUID: `${CT_TWO_STACKS}.0.4`,
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a.imageIndex).toBe(2);
    expect(b.imageIndex).toBe(4);
    expect(vp0(h.viewer)).toMatchObject({ seriesInstanceUID: CT_TWO_STACKS, imageIndex: 4 });
  });
});

describe('prefetching', () => {
  it('asks the engine to load outward from the slice on screen, 64 slices either way by default', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(h.port.stacks[0]?.renderOptions.prefetchRadius).toBe(64);
  });

  it('can be set, or turned off', async () => {
    const wide = harness({ viewer: { prefetch: { radius: 200 } } });
    await ready(wide);
    await wide.viewer.setViewportSeries('vp-0', CT);
    expect(wide.port.stacks[0]?.renderOptions.prefetchRadius).toBe(200);

    const off = harness({ viewer: { prefetch: false } });
    await ready(off);
    await off.viewer.setViewportSeries('vp-0', CT);
    expect(off.port.stacks[0]?.renderOptions.prefetchRadius).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])('refuses a radius of %s', (radius) => {
    expect(() => harness({ viewer: { prefetch: { radius } } })).toThrow(RangeError);
  });
});
