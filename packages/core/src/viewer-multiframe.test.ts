// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Measurement, Point3 } from './measurements/model';
import {
  CT,
  FRAME_OF_REFERENCE,
  MULTIFRAME,
  MULTIFRAME_FRAMES,
  MULTIFRAME_SOP,
  STUDY,
} from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

const p = (x: number, y: number, z = 0): Point3 => [x, y, z];

async function show(h: Harness, series = MULTIFRAME): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', series, { imageIndex: 0 });
}

const onFrame = (id: string, frameNumber: number | undefined): Measurement => ({
  id,
  type: 'length',
  reference: {
    studyInstanceUID: STUDY,
    seriesInstanceUID: MULTIFRAME,
    sopInstanceUID: MULTIFRAME_SOP,
    frameOfReferenceUID: FRAME_OF_REFERENCE,
    ...(frameNumber === undefined ? {} : { frameNumber }),
  },
  points: [p(0, 0), p(3, 4)],
});

describe('a series of one multi-frame instance', () => {
  it('shows one image for each frame', async () => {
    const h = harness();
    await show(h);
    expect(h.viewer.viewports.get('vp-0')?.imageCount).toBe(MULTIFRAME_FRAMES);
  });

  describe('navigateTo', () => {
    it('shows the frame asked for, and says which it showed', async () => {
      const h = harness();
      await show(h);
      const result = await h.viewer.navigateTo({
        seriesInstanceUID: MULTIFRAME,
        sopInstanceUID: MULTIFRAME_SOP,
        frameNumber: 4,
      });
      expect(result).toMatchObject({
        imageIndex: 3,
        frameNumber: 4,
        sopInstanceUID: MULTIFRAME_SOP,
      });
      expect(h.viewer.getState().viewports[0]?.imageIndex).toBe(3);
    });

    it('shows frame 1 when no frame is asked for', async () => {
      const h = harness();
      await show(h);
      await h.viewer.navigateTo({
        seriesInstanceUID: MULTIFRAME,
        sopInstanceUID: MULTIFRAME_SOP,
        frameNumber: 3,
      });
      const result = await h.viewer.navigateTo({
        seriesInstanceUID: MULTIFRAME,
        sopInstanceUID: MULTIFRAME_SOP,
      });
      expect(result).toMatchObject({ imageIndex: 0, frameNumber: 1 });
    });

    it('rejects a frame above the count, and names the count', async () => {
      const h = harness();
      await show(h);
      await expect(
        h.viewer.navigateTo({
          seriesInstanceUID: MULTIFRAME,
          sopInstanceUID: MULTIFRAME_SOP,
          frameNumber: MULTIFRAME_FRAMES + 1,
        }),
      ).rejects.toThrow(/5 frames/);
    });

    it('rejects a frame above 1 for an instance of one frame, and says it has one', async () => {
      const h = harness();
      await show(h, CT);
      await expect(
        h.viewer.navigateTo({
          seriesInstanceUID: CT,
          sopInstanceUID: `${CT}.0.2`,
          frameNumber: 2,
        }),
      ).rejects.toThrow(/1 frame\b/);
    });

    it('still rejects a frame number that is not a whole number from 1', async () => {
      const h = harness();
      await show(h);
      for (const frameNumber of [0, 1.5, -2]) {
        await expect(
          h.viewer.navigateTo({
            seriesInstanceUID: MULTIFRAME,
            sopInstanceUID: MULTIFRAME_SOP,
            frameNumber,
          }),
        ).rejects.toThrow(RangeError);
      }
    });
  });

  it('says the frame in the event when the image changes', async () => {
    const h = harness();
    await show(h);
    await h.viewer.viewports.get('vp-0')?.setImageIndex(2);
    expect(h.events['viewport:image'].at(-1)).toMatchObject({
      imageIndex: 2,
      sopInstanceUID: MULTIFRAME_SOP,
      frameNumber: 3,
    });
  });

  describe('measurements', () => {
    it('are on the frame they were drawn on, and only that frame draws them', async () => {
      const h = harness();
      await show(h);
      await h.viewer.measurements.add(onFrame('m-1', 4));
      await h.viewer.measurements.add(onFrame('m-2', undefined));
      const [stack] = h.port.stacks;
      expect(stack?.measurements.get('m-1')?.imageIndex).toBe(3);
      // No frame number means frame 1.
      expect(stack?.measurements.get('m-2')?.imageIndex).toBe(0);
    });

    it('get the frame number of the image the person drew them on, when it is above 1', async () => {
      const h = harness();
      await show(h);
      const [stack] = h.port.stacks;
      stack?.emitMeasurement({
        kind: 'completed',
        measurement: { id: 'd-1', type: 'length', imageIndex: 3, points: [p(0, 0), p(3, 4)] },
      });
      stack?.emitMeasurement({
        kind: 'completed',
        measurement: { id: 'd-2', type: 'length', imageIndex: 0, points: [p(0, 0), p(3, 4)] },
      });
      expect(h.viewer.measurements.get('d-1')?.reference.frameNumber).toBe(4);
      // Frame 1 has one form: no frame number. A single-frame export does not change by a byte.
      expect(h.viewer.measurements.get('d-2')?.reference).not.toHaveProperty('frameNumber');
    });

    it('on two frames of one instance stay apart, and are filtered by frame', async () => {
      const h = harness();
      await show(h);
      await h.viewer.measurements.add(onFrame('a', 2));
      await h.viewer.measurements.add(onFrame('b', 5));
      expect(
        h.viewer.measurements
          .list({ sopInstanceUID: MULTIFRAME_SOP, frameNumber: 5 })
          .map((m) => m.id),
      ).toEqual(['b']);
      expect(
        h.viewer.measurements.list({ sopInstanceUID: MULTIFRAME_SOP }).map((m) => m.id),
      ).toEqual(['a', 'b']);
    });

    it('are jumped to on their frame', async () => {
      const h = harness();
      await show(h);
      await h.viewer.measurements.add(onFrame('far', 5));
      await h.viewer.measurements.jumpTo('far');
      expect(h.viewer.getState().viewports[0]?.imageIndex).toBe(4);
    });

    it('give the slice of each measurement in its stack, by frame', async () => {
      const h = harness();
      await show(h);
      await h.viewer.measurements.add(onFrame('a', 2));
      await h.viewer.measurements.add(onFrame('b', 5));
      const slices = await h.viewer.measurements.slices();
      expect(slices.get('a')).toBe(2);
      expect(slices.get('b')).toBe(5);
    });

    it('survive an export and an import with their frame, and a measurement with no frame comes back without one', async () => {
      const h = harness();
      await show(h);
      await h.viewer.measurements.add(onFrame('a', 3));
      await h.viewer.measurements.add(onFrame('b', undefined));
      const exported = h.viewer.measurements.exportJson();
      const copy = harness();
      await copy.viewer.loadStudy(STUDY);
      await copy.viewer.measurements.importJson(JSON.parse(JSON.stringify(exported)));
      expect(copy.viewer.measurements.get('a')?.reference.frameNumber).toBe(3);
      expect(copy.viewer.measurements.get('b')?.reference).not.toHaveProperty('frameNumber');
    });
  });
});
