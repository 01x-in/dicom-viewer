// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PALETTE } from './segmentations/model';
import {
  CT,
  CT_TWO_STACKS,
  type FakeSegmentationHandle,
  type FakeStackPort,
  SEG,
  SEG_OFF,
  SEG_ON_SECOND_STACK,
  SEG_OVERLAP,
  SEG_SECOND,
  SEG_UNREADABLE,
  STUDY,
} from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function show(h: Harness, series = CT, options?: { stackIndex?: number }): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', series, options);
}

function stackOf(h: Harness, index = 0): FakeStackPort {
  const found = h.port.stacks[index];
  if (found === undefined) throw new Error(`No stack ${index.toString()}`);
  return found;
}

function handleOf(h: Harness, index = 0): FakeSegmentationHandle {
  const found = h.port.segmentationHandles[index];
  if (found === undefined) throw new Error(`No handle ${index.toString()}`);
  return found;
}

/** What a stack was last told to draw for a SEG: alpha and visibility of each segment, by number. */
function drawn(
  stack: FakeStackPort,
  handle: FakeSegmentationHandle,
): Record<number, { alpha: number; visible: boolean; outline: boolean; color: readonly number[] }> {
  const display = stack.segmentations.get(handle);
  if (display === undefined) throw new Error('The stack does not draw this SEG');
  return Object.fromEntries(
    display.segments.map(({ number, alpha, visible, outline, color }) => [
      number,
      { alpha, visible, outline, color },
    ]),
  );
}

describe('segmentations.load', () => {
  it('retrieves the SEG, reads it against the series it names, and describes it', async () => {
    const h = harness();
    await show(h);

    const info = await h.viewer.segmentations.load(SEG);

    expect(h.source.calls).toContain(`getInstanceBytes ${SEG} SEG`);
    expect(h.port.segmentationLoads).toHaveLength(1);
    expect(h.port.segmentationLoads[0]?.imageIds).toHaveLength(10);
    expect(info).toMatchObject({
      seriesInstanceUID: SEG,
      studyInstanceUID: STUDY,
      referencedSeriesInstanceUID: CT,
      referencedStackIndex: 0,
      label: 'SEG',
      visible: true,
      opacity: 0.5,
      highlight: undefined,
      warnings: [],
    });
    expect(info.segments.map((segment) => [segment.number, segment.label])).toEqual([
      [1, 'Body'],
      [2, 'Lesion'],
    ]);
  });

  it('gives each segment a colour of the palette, full opacity, and what the engine found of it', async () => {
    const h = harness();
    await show(h);
    const info = await h.viewer.segmentations.load(SEG);
    const [body, lesion] = info.segments;
    expect(body).toMatchObject({
      color: PALETTE[0],
      opacity: 1,
      visible: true,
      voxelCount: 60,
      imageCount: 3,
    });
    expect(lesion).toMatchObject({ color: PALETTE[1], voxelCount: 120 });
    // The fake images are 1 mm pixels, 2.5 mm apart, from (0, 0, 0): the middle is a place among them.
    expect(body?.centroid?.[0]).toBeCloseTo(200);
    expect(body?.centroid?.[1]).toBeCloseTo(100);
    expect(body?.centroid?.[2]).toBeCloseTo((250 / 60) * 2.5);
  });

  it('announces it, and keeps it in the list and by series', async () => {
    const h = harness();
    await show(h);
    const info = await h.viewer.segmentations.load(SEG);
    expect(h.events['segmentation:loaded']).toEqual([{ segmentation: info }]);
    expect(h.viewer.segmentations.list()).toEqual([info]);
    expect(h.viewer.segmentations.get(SEG)).toBe(info);
    expect(h.viewer.segmentations.get(SEG_SECOND)).toBeUndefined();
  });

  it('gives back a SEG that is loaded without retrieving or reading it again', async () => {
    const h = harness();
    await show(h);
    const first = await h.viewer.segmentations.load(SEG);
    const again = await h.viewer.segmentations.load(SEG);
    expect(again).toBe(first);
    expect(h.port.segmentationLoads).toHaveLength(1);
    expect(h.source.calls.filter((call) => call.startsWith('getInstanceBytes'))).toHaveLength(1);
    expect(h.events['segmentation:loaded']).toHaveLength(1);
  });

  it('loads a SEG once when it is asked for twice at once', async () => {
    const h = harness();
    await show(h);
    const [a, b] = await Promise.all([
      h.viewer.segmentations.load(SEG),
      h.viewer.segmentations.load(SEG),
    ]);
    expect(a).toBe(b);
    expect(h.port.segmentationLoads).toHaveLength(1);
  });

  it('loads several SEGs of one series, and lists them in the order they were loaded', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG_SECOND);
    await h.viewer.segmentations.load(SEG);
    expect(h.viewer.segmentations.list().map((item) => item.seriesInstanceUID)).toEqual([
      SEG_SECOND,
      SEG,
    ]);
  });

  it('needs no image on screen: it is drawn when the series it names comes up', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.segmentations.load(SEG);
    expect(h.port.stacks).toHaveLength(0);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(stackOf(h).segmentations.has(handleOf(h))).toBe(true);
  });

  it('picks the stack of a series that holds the images the SEG names', async () => {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    const info = await h.viewer.segmentations.load(SEG_ON_SECOND_STACK);
    expect(info.referencedSeriesInstanceUID).toBe(CT_TWO_STACKS);
    expect(info.referencedStackIndex).toBe(1);
    expect(h.port.segmentationLoads[0]?.imageIds).toHaveLength(3);
  });

  it.each([
    ['a CT, which is not a SEG', CT, /is a CT, not a SEG/],
    ['a series that is not in the study', '1.2.3.404', /./],
    ['a UID that is not a UID', '../etc', /not a valid DICOM UID/],
  ])('rejects %s', async (_name, series, message) => {
    const h = harness();
    await show(h);
    await expect(h.viewer.segmentations.load(series)).rejects.toThrow(message);
    expect(h.viewer.segmentations.list()).toEqual([]);
    expect(h.port.segmentationHandles).toEqual([]);
  });

  it('rejects before a study is loaded, and says so', async () => {
    const h = harness();
    await expect(h.viewer.segmentations.load(SEG)).rejects.toThrow(/Load a study first/);
  });

  it('rejects a SEG whose bytes cannot be read, with what is wrong, and loads nothing', async () => {
    const h = harness();
    await show(h);
    await expect(h.viewer.segmentations.load(SEG_UNREADABLE)).rejects.toThrow(
      /not a readable DICOM file/,
    );
    expect(h.port.segmentationLoads).toEqual([]);
  });

  it('rejects when the engine cannot parse the SEG, and keeps nothing of it', async () => {
    const h = harness();
    await show(h);
    h.port.failNextSegmentationLoad();
    await expect(h.viewer.segmentations.load(SEG)).rejects.toThrow('The SEG could not be parsed.');
    expect(h.viewer.segmentations.list()).toEqual([]);
    // A failure is not remembered: asking again asks again.
    const info = await h.viewer.segmentations.load(SEG);
    expect(info.seriesInstanceUID).toBe(SEG);
  });

  it('gives back what the engine made when the viewer is destroyed while it was reading', async () => {
    const h = harness();
    await show(h);
    const hold = h.port.holdSegmentationLoads();
    const loading = h.viewer.segmentations.load(SEG);
    loading.catch(() => undefined);
    // The load is in the engine's hands.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.viewer.destroy();
    hold.release();
    await expect(loading).rejects.toThrow(/destroyed/);
    expect(handleOf(h).disposed).toBe(true);
  });
});

describe('segmentation warnings', () => {
  it('has none for a SEG that fits', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    expect(h.events['segmentation:warning']).toEqual([]);
  });

  it('warns, in the info and by event, of a SEG in another frame of reference', async () => {
    const h = harness();
    await show(h);
    const info = await h.viewer.segmentations.load(SEG_OFF);
    expect(info.warnings.map((warning) => warning.code)).toEqual(['frame-of-reference']);
    expect(h.events['segmentation:warning']).toEqual([
      { seriesInstanceUID: SEG_OFF, warning: info.warnings[0] },
    ]);
    // It is still loaded and drawn: a warning says to doubt it, not to drop it.
    expect(stackOf(h).segmentations.has(handleOf(h))).toBe(true);
  });

  it('warns of segments that share pixels', async () => {
    const h = harness();
    await show(h);
    const info = await h.viewer.segmentations.load(SEG_OVERLAP);
    expect(info.warnings).toEqual([
      { code: 'overlapping-segments', message: 'Segments share pixels: Slab and Disc.' },
    ]);
  });

  it('warns of a segment with no pixels, and leaves it with none', async () => {
    const h = harness();
    await show(h);
    h.port.segmentationIndexOf = (header) => ({
      segments: [
        {
          number: 1,
          layer: 0,
          voxelCount: 4,
          imageIndices: [2],
          imageVoxelCounts: [4],
          sumRow: 0,
          sumColumn: 0,
          sumImageIndex: 8,
        },
      ],
      overlaps: header.segments.length > 5 ? [{ a: 1, b: 2, voxelCount: 1 }] : [],
    });
    const info = await h.viewer.segmentations.load(SEG);
    expect(info.warnings).toEqual([
      { code: 'empty-segment', message: 'The segment Lesion has no pixels.' },
    ]);
    expect(info.segments[1]).toMatchObject({ voxelCount: 0, imageCount: 0, centroid: undefined });
  });
});

describe('a draw the engine fails', () => {
  it('leaves nothing loaded when the first draw fails, and loads again once it works', async () => {
    const h = harness();
    await show(h);
    const stack = stackOf(h);
    const draw = stack.drawSegmentation.bind(stack);
    stack.drawSegmentation = () => {
      throw new Error('the engine failed');
    };
    await expect(h.viewer.segmentations.load(SEG)).rejects.toThrow('the engine failed');
    expect(h.viewer.segmentations.list()).toEqual([]);
    expect(h.viewer.segmentations.get(SEG)).toBeUndefined();
    expect(handleOf(h).disposed).toBe(true);
    expect(h.events['segmentation:loaded']).toEqual([]);
    stack.drawSegmentation = draw;
    const info = await h.viewer.segmentations.load(SEG);
    expect(info.seriesInstanceUID).toBe(SEG);
    expect(h.viewer.segmentations.list()).toHaveLength(1);
    expect(h.port.segmentationHandles).toHaveLength(2);
    expect(h.port.segmentationHandles[1]?.disposed).toBe(false);
  });

  it('keeps the settings it had when a change is refused, and says nothing of it', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    const before = h.viewer.segmentations.get(SEG);
    const stack = stackOf(h);
    const draw = stack.drawSegmentation.bind(stack);
    let failures = 1;
    stack.drawSegmentation = (handle, display) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('the engine failed');
      }
      return draw(handle, display);
    };
    await expect(h.viewer.segmentations.setVisible(SEG, false)).rejects.toThrow(
      'the engine failed',
    );
    expect(h.viewer.segmentations.get(SEG)).toBe(before);
    expect(h.events['segmentation:updated']).toEqual([]);
    expect(h.events['segmentation:visibility']).toEqual([]);
    // What is on screen went back too.
    expect(drawn(stack, handleOf(h))[1]?.visible).toBe(true);
    await h.viewer.segmentations.setVisible(SEG, false);
    expect(h.viewer.segmentations.get(SEG)?.visible).toBe(false);
  });
});

describe('a SEG the engine will not draw', () => {
  it('says so in the SEG and by event, as part of loading it', async () => {
    const h = harness();
    await show(h);
    h.port.refuseSegmentations = true;
    const info = await h.viewer.segmentations.load(SEG);
    expect(info.warnings.map((warning) => warning.code)).toEqual(['not-drawn']);
    expect(h.events['segmentation:loaded'][0]?.segmentation.warnings).toEqual(info.warnings);
    expect(h.events['segmentation:warning'].map((event) => event.warning.code)).toEqual([
      'not-drawn',
    ]);
  });

  it('says so once, however many times it is changed', async () => {
    const h = harness();
    await show(h);
    h.port.refuseSegmentations = true;
    await h.viewer.segmentations.load(SEG);
    await h.viewer.segmentations.setVisible(SEG, false);
    await h.viewer.segmentations.setVisible(SEG, true);
    expect(h.viewer.segmentations.get(SEG)?.warnings).toHaveLength(1);
    expect(h.events['segmentation:warning']).toHaveLength(1);
  });

  it('says so when the stack comes after the SEG, as an update', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    h.port.refuseSegmentations = true;
    await h.viewer.segmentations.load(SEG);
    expect(h.viewer.segmentations.get(SEG)?.warnings).toEqual([]);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(h.viewer.segmentations.get(SEG)?.warnings.map((warning) => warning.code)).toEqual([
      'not-drawn',
    ]);
    expect(h.events['segmentation:updated']).toHaveLength(1);
    expect(h.events['segmentation:warning']).toHaveLength(1);
  });

  it('says nothing when the engine draws it', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    expect(h.viewer.segmentations.get(SEG)?.warnings).toEqual([]);
  });
});

describe('drawing a SEG', () => {
  it('draws it over the stack on screen, at the opacity of the SEG times that of each segment', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    expect(drawn(stackOf(h), handleOf(h))).toEqual({
      1: { alpha: 0.5, visible: true, outline: false, color: PALETTE[0] },
      2: { alpha: 0.5, visible: true, outline: false, color: PALETTE[1] },
    });
  });

  it('does not draw a SEG over a series it does not name', async () => {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    await h.viewer.segmentations.load(SEG);
    expect(stackOf(h).segmentations.size).toBe(0);
    expect(h.port.segmentationLoads[0]?.imageIds[0]).toContain(CT);
  });

  it('draws a SEG of the second stack over that stack and not the first', async () => {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    await h.viewer.segmentations.load(SEG_ON_SECOND_STACK);
    expect(stackOf(h).segmentations.size).toBe(0);
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS, { stackIndex: 1 });
    expect(stackOf(h, 1).segmentations.size).toBe(1);
  });

  it('stops drawing when the series goes, and draws again when it returns', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(stackOf(h, 0).segmentations.size).toBe(0);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(stackOf(h, 2).segmentations.size).toBe(1);
    expect(handleOf(h).disposed).toBe(false);
  });

  it('draws it in every viewport that shows the series, including one that comes later', async () => {
    const element = document.createElement('div');
    const h = harness({
      initialState: {
        version: 1,
        layout: '1x1',
        viewports: [
          { id: 'vp-0', seriesInstanceUID: CT },
          { id: 'vp-1', seriesInstanceUID: CT },
        ],
      },
    });
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.setViewportSeries('vp-0', CT);
    await h.viewer.segmentations.load(SEG);
    expect(h.port.stacks).toHaveLength(1);

    h.viewer.viewports.attach('vp-1', element);
    await h.viewer.setViewportSeries('vp-1', CT);
    expect(h.port.stacks).toHaveLength(2);
    expect(stackOf(h, 0).segmentations.size).toBe(1);
    expect(stackOf(h, 1).segmentations.size).toBe(1);

    // A change reaches both, in the same call.
    await h.viewer.segmentations.setSegmentVisible(SEG, 2, false);
    expect(drawn(stackOf(h, 0), handleOf(h))[2]?.visible).toBe(false);
    expect(drawn(stackOf(h, 1), handleOf(h))[2]?.visible).toBe(false);
    expect(drawn(stackOf(h, 1), handleOf(h))[1]?.visible).toBe(true);
  });
});

describe('changing how a SEG looks', () => {
  async function loaded(): Promise<Harness> {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    return h;
  }

  it('hides and shows a whole SEG, and says so once for each change', async () => {
    const h = await loaded();
    await h.viewer.segmentations.setVisible(SEG, false);
    expect(h.viewer.segmentations.get(SEG)?.visible).toBe(false);
    expect(Object.values(drawn(stackOf(h), handleOf(h))).map((item) => item.visible)).toEqual([
      false,
      false,
    ]);
    expect(h.events['segmentation:visibility']).toEqual([
      {
        seriesInstanceUID: SEG,
        visible: false,
        segments: [
          { number: 1, visible: true },
          { number: 2, visible: true },
        ],
      },
    ]);
    await h.viewer.segmentations.setVisible(SEG, false);
    expect(h.events['segmentation:visibility']).toHaveLength(1);
    await h.viewer.segmentations.setVisible(SEG, true);
    expect(h.events['segmentation:visibility']).toHaveLength(2);
    expect(drawn(stackOf(h), handleOf(h))[1]?.visible).toBe(true);
  });

  it('hides one segment and leaves the other', async () => {
    const h = await loaded();
    await h.viewer.segmentations.setSegmentVisible(SEG, 2, false);
    expect(drawn(stackOf(h), handleOf(h))).toMatchObject({
      1: { visible: true },
      2: { visible: false },
    });
    expect(h.events['segmentation:visibility']).toEqual([
      {
        seriesInstanceUID: SEG,
        visible: true,
        segments: [
          { number: 1, visible: true },
          { number: 2, visible: false },
        ],
      },
    ]);
  });

  it('does not draw a segment that is shown when the SEG is hidden', async () => {
    const h = await loaded();
    await h.viewer.segmentations.setSegmentVisible(SEG, 1, true);
    await h.viewer.segmentations.setVisible(SEG, false);
    expect(drawn(stackOf(h), handleOf(h))[1]?.visible).toBe(false);
    expect(h.viewer.segmentations.get(SEG)?.segments[0]?.visible).toBe(true);
  });

  it('changes a segment colour, from red, green, and blue or from hex', async () => {
    const h = await loaded();
    await h.viewer.segmentations.setSegmentColor(SEG, 1, [10, 20, 30]);
    expect(drawn(stackOf(h), handleOf(h))[1]?.color).toEqual([10, 20, 30]);
    await h.viewer.segmentations.setSegmentColor(SEG, 2, '#ff8000');
    expect(drawn(stackOf(h), handleOf(h))[2]?.color).toEqual([255, 128, 0]);
    expect(h.viewer.segmentations.get(SEG)?.segments.map((segment) => segment.color)).toEqual([
      [10, 20, 30],
      [255, 128, 0],
    ]);
    expect(h.events['segmentation:updated']).toHaveLength(2);
  });

  it('changes the opacity of a segment, and of the whole SEG, which multiply', async () => {
    const h = await loaded();
    await h.viewer.segmentations.setSegmentOpacity(SEG, 1, 0.4);
    await h.viewer.segmentations.setOpacity(SEG, 0.5);
    expect(drawn(stackOf(h), handleOf(h))[1]?.alpha).toBeCloseTo(0.2);
    expect(drawn(stackOf(h), handleOf(h))[2]?.alpha).toBeCloseTo(0.5);
    await h.viewer.segmentations.setOpacity(SEG, 1);
    expect(drawn(stackOf(h), handleOf(h))[1]?.alpha).toBeCloseTo(0.4);
  });

  it('says what a change was: the new settings, and the ones before', async () => {
    const h = await loaded();
    const before = h.viewer.segmentations.get(SEG);
    await h.viewer.segmentations.setSegmentColor(SEG, 1, [1, 2, 3]);
    const [event] = h.events['segmentation:updated'];
    expect(event?.previous).toBe(before);
    expect(event?.segmentation).toBe(h.viewer.segmentations.get(SEG));
    expect(before?.segments[0]?.color).toEqual(PALETTE[0]);
  });

  it('says nothing when nothing changed, and does not draw again', async () => {
    const h = await loaded();
    const calls = stackOf(h).segmentationCalls.length;
    await h.viewer.segmentations.setVisible(SEG, true);
    await h.viewer.segmentations.setSegmentVisible(SEG, 1, true);
    await h.viewer.segmentations.setSegmentColor(SEG, 1, PALETTE[0] ?? [0, 0, 0]);
    await h.viewer.segmentations.setSegmentOpacity(SEG, 1, 1);
    await h.viewer.segmentations.setOpacity(SEG, 0.5);
    await h.viewer.segmentations.highlight(SEG, undefined);
    expect(h.events['segmentation:updated']).toEqual([]);
    expect(stackOf(h).segmentationCalls).toHaveLength(calls);
  });

  it('applies calls in the order they were made, even when the SEG is still loading', async () => {
    const h = harness();
    await show(h);
    const loading = h.viewer.segmentations.load(SEG);
    const hiding = h.viewer.segmentations.setVisible(SEG, false);
    await Promise.all([loading, hiding]);
    expect(h.viewer.segmentations.get(SEG)?.visible).toBe(false);
  });

  it.each([
    [
      'a colour of 300',
      (v: Harness['viewer']) => v.segmentations.setSegmentColor(SEG, 1, [0, 0, 300]),
      RangeError,
    ],
    [
      'a colour that is a name',
      (v: Harness['viewer']) => v.segmentations.setSegmentColor(SEG, 1, 'red'),
      RangeError,
    ],
    [
      'an opacity above 1',
      (v: Harness['viewer']) => v.segmentations.setSegmentOpacity(SEG, 1, 1.5),
      RangeError,
    ],
    [
      'an opacity below 0',
      (v: Harness['viewer']) => v.segmentations.setOpacity(SEG, -0.1),
      RangeError,
    ],
    [
      'a SEG that is not loaded',
      (v: Harness['viewer']) => v.segmentations.setVisible(SEG_SECOND, false),
      RangeError,
    ],
    [
      'a segment the SEG does not have',
      (v: Harness['viewer']) => v.segmentations.setSegmentVisible(SEG, 9, false),
      RangeError,
    ],
    [
      'a segment number that is not a number',
      (v: Harness['viewer']) => v.segmentations.setSegmentVisible(SEG, 1.5, false),
      RangeError,
    ],
  ])('rejects %s, and changes nothing', async (_name, call, error) => {
    const h = await loaded();
    const before = h.viewer.segmentations.get(SEG);
    await expect(call(h.viewer)).rejects.toThrow(error);
    expect(h.viewer.segmentations.get(SEG)).toBe(before);
    expect(h.events['segmentation:updated']).toEqual([]);
  });

  it('names the segments there are when it rejects one that is not', async () => {
    const h = await loaded();
    await expect(h.viewer.segmentations.setSegmentVisible(SEG, 9, false)).rejects.toThrow(
      /no segment 9: it has 1, 2/,
    );
  });
});

describe('highlighting segments', () => {
  async function loaded(): Promise<Harness> {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    return h;
  }

  it('dims the others by default, and leaves the highlighted segments as they are', async () => {
    const h = await loaded();
    await h.viewer.segmentations.highlight(SEG, [2]);
    const shown = drawn(stackOf(h), handleOf(h));
    expect(shown[1]?.alpha).toBeCloseTo(0.5 * 0.2);
    expect(shown[2]?.alpha).toBeCloseTo(0.5);
    expect(h.viewer.segmentations.get(SEG)?.highlight).toEqual({
      mode: 'dim-others',
      segments: [2],
    });
  });

  it('outlines the highlighted segments in outline mode, and leaves every fill alone', async () => {
    const h = await loaded();
    await h.viewer.segmentations.highlight(SEG, [1], { mode: 'outline' });
    const shown = drawn(stackOf(h), handleOf(h));
    expect(shown[1]).toMatchObject({ outline: true, alpha: 0.5 });
    expect(shown[2]).toMatchObject({ outline: false, alpha: 0.5 });
  });

  it('takes a highlight away with none, or with an empty list', async () => {
    const h = await loaded();
    await h.viewer.segmentations.highlight(SEG, [2]);
    await h.viewer.segmentations.highlight(SEG, []);
    expect(h.viewer.segmentations.get(SEG)?.highlight).toBeUndefined();
    expect(drawn(stackOf(h), handleOf(h))[1]?.alpha).toBeCloseTo(0.5);
    await h.viewer.segmentations.highlight(SEG, [1]);
    await h.viewer.segmentations.highlight(SEG, undefined);
    expect(h.viewer.segmentations.get(SEG)?.highlight).toBeUndefined();
  });

  it('keeps the numbers once each, in order', async () => {
    const h = await loaded();
    await h.viewer.segmentations.highlight(SEG, [2, 1, 2]);
    expect(h.viewer.segmentations.get(SEG)?.highlight?.segments).toEqual([1, 2]);
  });

  it('is announced as an update, and not as a change of visibility', async () => {
    const h = await loaded();
    await h.viewer.segmentations.highlight(SEG, [2]);
    expect(h.events['segmentation:updated']).toHaveLength(1);
    expect(h.events['segmentation:visibility']).toEqual([]);
  });

  it('never shows a segment that is hidden', async () => {
    const h = await loaded();
    await h.viewer.segmentations.setSegmentVisible(SEG, 1, false);
    await h.viewer.segmentations.highlight(SEG, [1], { mode: 'outline' });
    expect(drawn(stackOf(h), handleOf(h))[1]).toMatchObject({ visible: false });
  });

  it.each([
    ['a mode that does not exist', 'glow'],
    ['a segment number below 1', 0],
    ['a segment the SEG does not have', 9],
  ])('rejects %s', async (_name, bad) => {
    const h = await loaded();
    const call =
      bad === 'glow'
        ? h.viewer.segmentations.highlight(SEG, [1], { mode: 'glow' as 'outline' })
        : h.viewer.segmentations.highlight(SEG, [bad as number]);
    await expect(call).rejects.toThrow(RangeError);
    expect(h.viewer.segmentations.get(SEG)?.highlight).toBeUndefined();
  });
});

describe('unloading', () => {
  it('stops drawing, gives the engine its memory back, and says so', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    const unloaded = await h.viewer.segmentations.unload(SEG);
    expect(unloaded).toBe(true);
    expect(stackOf(h).segmentations.size).toBe(0);
    expect(stackOf(h).segmentationCalls).toEqual(['draw seg-1', 'hide seg-1']);
    expect(handleOf(h).disposed).toBe(true);
    expect(h.viewer.segmentations.list()).toEqual([]);
    expect(h.events['segmentation:unloaded']).toEqual([{ seriesInstanceUID: SEG }]);
  });

  it('says there was nothing to unload', async () => {
    const h = harness();
    await show(h);
    expect(await h.viewer.segmentations.unload(SEG)).toBe(false);
    expect(h.events['segmentation:unloaded']).toEqual([]);
  });

  it('can load the SEG again', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.segmentations.unload(SEG);
    await h.viewer.segmentations.load(SEG);
    expect(h.port.segmentationHandles).toHaveLength(2);
    expect(stackOf(h).segmentations.size).toBe(1);
  });

  it('is done for every SEG when another study is loaded, which they do not belong to', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.segmentations.load(SEG_SECOND);
    await h.viewer.loadStudy('1.2.4');
    expect(h.viewer.segmentations.list()).toEqual([]);
    expect(h.port.segmentationHandles.every((handle) => handle.disposed)).toBe(true);
    expect(h.events['segmentation:unloaded'].map((event) => event.seriesInstanceUID)).toEqual([
      SEG,
      SEG_SECOND,
    ]);
  });

  it('is done for every SEG when setState changes the study', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.setState({ studyInstanceUID: '1.2.4' });
    expect(h.viewer.segmentations.list()).toEqual([]);
    expect(handleOf(h).disposed).toBe(true);
  });

  it('keeps the SEGs when the same study is loaded again', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.loadStudy(STUDY);
    expect(h.viewer.segmentations.list()).toHaveLength(1);
    expect(handleOf(h).disposed).toBe(false);
  });

  it('gives the engine its memory back when the viewer is destroyed', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.segmentations.load(SEG_SECOND);
    h.viewer.destroy();
    expect(h.port.segmentationHandles.every((handle) => handle.disposed)).toBe(true);
  });
});

describe('jumpToSegment', () => {
  async function loaded(): Promise<Harness> {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    await h.viewer.segmentations.load(SEG);
    return h;
  }

  it('shows the image with most of the segment by default, and picks the series the SEG is on', async () => {
    const h = await loaded();
    // The viewport shows another series, and the jump brings the CT back.
    const result = await h.viewer.segmentations.jumpToSegment(SEG, 1);
    expect(result).toEqual({
      viewportId: 'vp-0',
      seriesInstanceUID: CT,
      sopInstanceUID: `${CT}.0.4`,
      imageIndex: 4,
      strategy: 'largestSlice',
    });
    expect(h.viewer.getState().viewports[0]).toMatchObject({
      seriesInstanceUID: CT,
      imageIndex: 4,
    });
    expect(h.viewer.viewports.get('vp-0')?.getImageIndex()).toBe(4);
  });

  it('shows the image of the segment nearest the one on screen, for nearestTo', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 9 });
    const result = await h.viewer.segmentations.jumpToSegment(SEG, 2, { strategy: 'nearestTo' });
    expect(result.imageIndex).toBe(5);
    await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 0 });
    expect(
      (await h.viewer.segmentations.jumpToSegment(SEG, 2, { strategy: 'nearestTo' })).imageIndex,
    ).toBe(3);
  });

  it('shows the image nearest the middle of the segment, for centroid', async () => {
    const h = harness();
    await show(h);
    await h.viewer.segmentations.load(SEG);
    const result = await h.viewer.segmentations.jumpToSegment(SEG, 1, { strategy: 'centroid' });
    // 10, 30, and 20 pixels on images 3, 4, 5: the middle is at 4.17.
    expect(result).toMatchObject({ imageIndex: 4, strategy: 'centroid' });
  });

  it('goes to the viewport it is told to', async () => {
    const h = harness({
      initialState: {
        version: 1,
        layout: '1x1',
        viewports: [{ id: 'vp-0' }, { id: 'vp-1' }],
      },
    });
    h.viewer.viewports.attach('vp-0', h.element);
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    await h.viewer.loadStudy(STUDY);
    await h.viewer.segmentations.load(SEG);
    const result = await h.viewer.segmentations.jumpToSegment(SEG, 1, { viewportId: 'vp-1' });
    expect(result.viewportId).toBe('vp-1');
    expect(h.viewer.getState().viewports.find((v) => v.id === 'vp-1')).toMatchObject({
      seriesInstanceUID: CT,
      imageIndex: 4,
    });
    expect(
      h.viewer.getState().viewports.find((v) => v.id === 'vp-0')?.seriesInstanceUID,
    ).toBeUndefined();
  });

  it('runs in the order of the calls made before it', async () => {
    const h = harness();
    await show(h);
    const loading = h.viewer.segmentations.load(SEG);
    const jumping = h.viewer.segmentations.jumpToSegment(SEG, 1);
    await expect(Promise.all([loading, jumping])).resolves.toBeDefined();
    expect(h.viewer.getState().viewports[0]?.imageIndex).toBe(4);
  });

  it('rejects a segment that has no pixels, and leaves the viewport where it was', async () => {
    const h = harness();
    await show(h);
    h.port.segmentationIndexOf = () => ({ segments: [], overlaps: [] });
    await h.viewer.segmentations.load(SEG);
    const before = h.viewer.getState();
    await expect(h.viewer.segmentations.jumpToSegment(SEG, 2)).rejects.toThrow(/no pixels/);
    expect(h.viewer.getState()).toEqual(before);
  });

  it.each([
    ['a SEG that is not loaded', () => [SEG_SECOND, 1] as const, undefined],
    ['a segment it does not have', () => [SEG, 9] as const, undefined],
    [
      'a strategy that does not exist',
      () => [SEG, 1] as const,
      { strategy: 'middle' as 'centroid' },
    ],
  ])('rejects %s', async (_name, args, options) => {
    const h = await loaded();
    const [series, segment] = args();
    await expect(h.viewer.segmentations.jumpToSegment(series, segment, options)).rejects.toThrow(
      RangeError,
    );
  });
});

describe('navigateTo with segmentations', () => {
  const target = (extra: object = {}): Parameters<Harness['viewer']['navigateTo']>[0] => ({
    seriesInstanceUID: CT,
    sopInstanceUID: `${CT}.0.7`,
    ...extra,
  });

  it('loads a SEG that is not loaded, and draws it over the slice', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    const result = await h.viewer.navigateTo(
      target({ segmentations: [{ seriesInstanceUID: SEG, visible: true }] }),
    );
    expect(result.failedSegmentations).toEqual([]);
    expect(result.imageIndex).toBe(7);
    expect(h.viewer.segmentations.list().map((item) => item.seriesInstanceUID)).toEqual([SEG]);
    expect(stackOf(h).segmentations.size).toBe(1);
  });

  it('shows the slice before the SEG is loaded: the image does not wait for it', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    const hold = h.port.holdSegmentationLoads();
    const navigating = h.viewer.navigateTo(
      target({ segmentations: [{ seriesInstanceUID: SEG, visible: true }] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.viewer.getState().viewports[0]).toMatchObject({
      seriesInstanceUID: CT,
      imageIndex: 7,
    });
    expect(h.viewer.segmentations.list()).toEqual([]);
    hold.release();
    await navigating;
    expect(h.viewer.segmentations.list()).toHaveLength(1);
  });

  it('hides a SEG, and highlights segments, as asked', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.navigateTo(
      target({
        segmentations: [
          { seriesInstanceUID: SEG, visible: false },
          { seriesInstanceUID: SEG_SECOND, visible: true, highlightSegments: [2, 3] },
        ],
      }),
    );
    expect(h.viewer.segmentations.get(SEG)?.visible).toBe(false);
    expect(h.viewer.segmentations.get(SEG_SECOND)).toMatchObject({
      visible: true,
      highlight: { mode: 'dim-others', segments: [2, 3] },
    });
  });

  it('clears a highlight with an empty list, and leaves it when none is given', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.navigateTo(
      target({
        segmentations: [{ seriesInstanceUID: SEG, visible: true, highlightSegments: [1] }],
      }),
    );
    await h.viewer.navigateTo(
      target({ segmentations: [{ seriesInstanceUID: SEG, visible: true }] }),
    );
    expect(h.viewer.segmentations.get(SEG)?.highlight?.segments).toEqual([1]);
    await h.viewer.navigateTo(
      target({ segmentations: [{ seriesInstanceUID: SEG, visible: true, highlightSegments: [] }] }),
    );
    expect(h.viewer.segmentations.get(SEG)?.highlight).toBeUndefined();
  });

  it('keeps the highlight mode a SEG has', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.segmentations.highlight(SEG, [1], { mode: 'outline' });
    await h.viewer.navigateTo(
      target({
        segmentations: [{ seriesInstanceUID: SEG, visible: true, highlightSegments: [2] }],
      }),
    );
    expect(h.viewer.segmentations.get(SEG)?.highlight).toEqual({ mode: 'outline', segments: [2] });
  });

  it('leaves a SEG that is not listed as it is', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.segmentations.load(SEG);
    await h.viewer.navigateTo(
      target({ segmentations: [{ seriesInstanceUID: SEG_SECOND, visible: false }] }),
    );
    expect(h.viewer.segmentations.get(SEG)?.visible).toBe(true);
  });

  it('reports a SEG it cannot load, and still shows the slice and does the others', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    const result = await h.viewer.navigateTo(
      target({
        segmentations: [
          { seriesInstanceUID: SEG_UNREADABLE, visible: true },
          { seriesInstanceUID: SEG, visible: true },
        ],
      }),
    );
    expect(result.imageIndex).toBe(7);
    expect(result.failedSegmentations).toHaveLength(1);
    expect(result.failedSegmentations?.[0]?.seriesInstanceUID).toBe(SEG_UNREADABLE);
    expect(result.failedSegmentations?.[0]?.error.message).toMatch(/not a readable DICOM file/);
    expect(h.events.error.map((event) => event.context)).toEqual(['segmentation']);
    expect(h.viewer.segmentations.list().map((item) => item.seriesInstanceUID)).toEqual([SEG]);
  });

  it('rejects a target that is not valid before changing anything', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    const before = h.viewer.getState();
    await expect(
      h.viewer.navigateTo(
        target({ segmentations: [{ seriesInstanceUID: '../x', visible: true }] }),
      ),
    ).rejects.toThrow(/not a valid DICOM UID/);
    await expect(
      h.viewer.navigateTo(
        target({
          segmentations: [{ seriesInstanceUID: SEG, visible: true, highlightSegments: [0] }],
        }),
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      h.viewer.navigateTo(
        target({
          // The helper takes any object, as a host without types could pass anything.
          segmentations: [{ seriesInstanceUID: SEG, visible: 'yes' }],
        }),
      ),
    ).rejects.toThrow(RangeError);
    expect(h.viewer.getState()).toEqual(before);
    expect(h.viewer.segmentations.list()).toEqual([]);
  });

  it('has no list of failures when it was given no SEGs', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    const result = await h.viewer.navigateTo(target());
    expect('failedSegmentations' in result).toBe(false);
  });
});
