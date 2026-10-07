// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, SEG, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

/** Three planes of the CT with elements, as the shell has them. */
async function planes(): Promise<Harness> {
  const h = harness();
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setLayout('2x2');
  for (const id of ['vp-1', 'vp-2']) h.viewer.viewports.attach(id, document.createElement('div'));
  await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'axial' });
  await h.viewer.setViewportSeries('vp-1', CT, { orientation: 'sagittal' });
  await h.viewer.setViewportSeries('vp-2', CT, { orientation: 'coronal' });
  return h;
}

const drawnIn = (h: Harness, at: number): boolean => {
  const stack = h.port.stacks[at];
  const handle = h.port.segmentationHandles[0];
  return stack !== undefined && handle !== undefined && stack.segmentations.has(handle);
};

describe('a SEG over the planes of a volume', () => {
  it('is drawn in every plane of the series it segments', async () => {
    const h = await planes();
    await h.viewer.segmentations.load(SEG);
    expect(h.port.stacks.map((stack) => stack.orientation)).toEqual([
      'axial',
      'sagittal',
      'coronal',
    ]);
    expect([0, 1, 2].map((at) => drawnIn(h, at))).toEqual([true, true, true]);
  });

  it('is drawn in a plane that comes after it was loaded', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.setViewportSeries('vp-0', CT);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    expect(h.port.stacks.at(-1)?.orientation).toBe('coronal');
    expect(drawnIn(h, h.port.stacks.length - 1)).toBe(true);
  });

  it('follows the visibility, the colour and the opacity in every plane', async () => {
    const h = await planes();
    await h.viewer.segmentations.load(SEG);
    await h.viewer.segmentations.setSegmentVisible(SEG, 2, false);
    await h.viewer.segmentations.setOpacity(SEG, 0.8);
    for (const at of [0, 1, 2]) {
      const handle = h.port.segmentationHandles[0];
      const display =
        handle === undefined ? undefined : h.port.stacks[at]?.segmentations.get(handle);
      expect(display?.segments.find((segment) => segment.number === 2)?.visible).toBe(false);
      expect(display?.segments.find((segment) => segment.number === 1)?.alpha).toBeCloseTo(0.8);
    }
  });

  it('is taken off a plane when the plane goes, and off every plane when it is unloaded', async () => {
    const h = await planes();
    await h.viewer.segmentations.load(SEG);
    await h.viewer.setViewportSeries('vp-2', CT);
    expect(h.port.stacks[2]?.destroyed).toBe(true);
    await h.viewer.segmentations.unload(SEG);
    expect([0, 1].map((at) => drawnIn(h, at))).toEqual([false, false]);
  });

  it('does not stop a plane that fell back to slices from drawing it as slices', async () => {
    const h = harness();
    h.port.volumeUnsupported = true;
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.setViewportSeries('vp-0', CT, { orientation: 'coronal' });
    await h.viewer.segmentations.load(SEG);
    expect(h.port.stacks[0]?.orientation).toBeUndefined();
    expect(drawnIn(h, 0)).toBe(true);
  });
});
