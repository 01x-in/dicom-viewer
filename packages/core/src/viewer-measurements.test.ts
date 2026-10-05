// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Measurement, Point3, RectangleMeasurement } from './measurements/model';
import type { NewMeasurement } from './measurements/registry';
import { STATS_DELAY_MS } from './measurements/registry';
import { CT, CT_TWO_STACKS, FRAME_OF_REFERENCE, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

afterEach(() => {
  vi.useRealTimers();
});

const p = (x: number, y: number, z = 0): Point3 => [x, y, z];

/** The instance of the CT at a slice. */
const sop = (index: number, series = CT, stack = 0): string =>
  `${series}.${stack.toString()}.${index.toString()}`;

const reference = (index: number): Measurement['reference'] => ({
  studyInstanceUID: STUDY,
  seriesInstanceUID: CT,
  sopInstanceUID: sop(index),
  frameOfReferenceUID: FRAME_OF_REFERENCE,
});

const length = (id: string, index = 5): Measurement => ({
  id,
  type: 'length',
  reference: reference(index),
  points: [p(0, 0), p(3, 4)],
});

/** A rectangle over columns 2 to 4 and rows 3 to 5. */
const rectangle = (id: string, index = 5): RectangleMeasurement => ({
  id,
  type: 'rectangle',
  reference: reference(index),
  points: [p(2, 3), p(4, 3), p(2, 5), p(4, 5)],
});

async function show(h: Harness, series = CT): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', series);
}

function stackOf(h: Harness, index = 0): NonNullable<Harness['port']['stacks'][number]> {
  const found = h.port.stacks[index];
  if (found === undefined) throw new Error(`No stack ${index.toString()}`);
  return found;
}

describe('measurements.add', () => {
  it('keeps the measurement, announces it, and draws it when its image is on screen', async () => {
    const h = harness();
    await show(h);

    const added = await h.viewer.measurements.add(length('m-1'));

    expect(added).toEqual(length('m-1'));
    expect(h.viewer.measurements.list()).toEqual([length('m-1')]);
    expect(h.viewer.measurements.get('m-1')).toEqual(length('m-1'));
    expect(h.events['measurement:added']).toEqual([{ measurement: length('m-1'), origin: 'api' }]);
    expect(stackOf(h).measurements.get('m-1')).toEqual({
      id: 'm-1',
      type: 'length',
      imageIndex: 5,
      points: [p(0, 0), p(3, 4)],
    });
  });

  it('makes an id when there is none', async () => {
    const { viewer } = harness();
    const bare: NewMeasurement = {
      type: 'length',
      reference: reference(5),
      points: [p(0, 0), p(3, 4)],
    };
    const added = await viewer.measurements.add(bare);
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(viewer.measurements.get(added.id)).toEqual(added);
  });

  it('keeps it without drawing it while another series is shown, and draws it when that series comes', async () => {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    await h.viewer.measurements.add(length('m-1'));
    expect(stackOf(h).measurements.size).toBe(0);

    await h.viewer.setViewportSeries('vp-0', CT);
    expect(stackOf(h, 1).measurements.has('m-1')).toBe(true);
  });

  it('works before any image is shown', async () => {
    const { viewer } = harness();
    await viewer.measurements.add(length('m-1'));
    expect(viewer.measurements.list()).toHaveLength(1);
  });

  it('rejects a measurement that is not valid, and changes nothing', async () => {
    const h = harness();
    const bad: unknown = { ...length('m-1'), points: [p(0, 0)] };
    // @ts-expect-error -- the type forbids it; the runtime check is for hosts without types
    await expect(h.viewer.measurements.add(bad)).rejects.toThrow(RangeError);
    expect(h.viewer.measurements.list()).toEqual([]);
    expect(h.events['measurement:added']).toEqual([]);
  });

  it('rejects an id that is taken', async () => {
    const h = harness();
    await h.viewer.measurements.add(length('m-1'));
    await expect(h.viewer.measurements.add(length('m-1'))).rejects.toThrow(/already/);
    expect(h.viewer.measurements.list()).toHaveLength(1);
  });

  it('comes after the calls made before it, even when they are not waited for', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    const showing = h.viewer.setViewportSeries('vp-0', CT);
    const adding = h.viewer.measurements.add(length('m-1'));
    await Promise.all([showing, adding]);
    expect(stackOf(h).measurements.has('m-1')).toBe(true);
  });

  it('fails after destroy', async () => {
    const { viewer } = harness();
    viewer.destroy();
    await expect(viewer.measurements.add(length('m-1'))).rejects.toThrow(/destroyed/);
  });
});

describe('the pixels of a measurement', () => {
  it('are read when a rectangle is added on a slice that is on screen', async () => {
    const h = harness();
    h.port.sliceOf = () => ({ rows: 256, columns: 512, at: (row) => (row === 3 ? 10 : 20) });
    await show(h);

    const added = await h.viewer.measurements.add(rectangle('r-1'));

    // Columns 2 to 4, rows 3 to 5: one row of 10 and two of 20.
    expect(added).toMatchObject({
      stats: { pixelCount: 9, minHu: 10, maxHu: 20 },
    });
    expect(added.type === 'rectangle' && added.stats?.meanHu).toBeCloseTo(50 / 3, 9);
    expect(stackOf(h).slicesRead).toEqual([5]);
    expect(h.events['measurement:updated']).toHaveLength(1);
  });

  it('are read for a probe', async () => {
    const h = harness();
    await show(h);
    const probe: Measurement = {
      id: 'pr-1',
      type: 'probe',
      reference: reference(5),
      points: [p(7, 2)],
    };
    const added = await h.viewer.measurements.add(probe);
    // The default slice: imageIndex * 1000 + row * 10 + column.
    expect(added).toMatchObject({ hu: 5000 + 2 * 10 + 7 });
  });

  it('are read for any slice of the series on screen, not only the one showing', async () => {
    const h = harness();
    await show(h);
    const added = await h.viewer.measurements.add(rectangle('r-1', 2));
    expect(added).toMatchObject({ stats: { pixelCount: 9 } });
    expect(stackOf(h).slicesRead).toEqual([2]);
    expect(h.viewer.getState().viewports[0]?.imageIndex).toBe(5);
  });

  it('are left for later when the series is not on screen', async () => {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    const added = await h.viewer.measurements.add(rectangle('r-1'));
    expect(added.type === 'rectangle' && added.stats).toBeUndefined();
    expect(stackOf(h).slicesRead).toEqual([]);
  });

  it('are read when the image comes on screen, and not worked out again for a measurement that has them', async () => {
    vi.useFakeTimers();
    const h = harness();
    await show(h, CT_TWO_STACKS);
    await h.viewer.measurements.add(rectangle('r-1'));
    await h.viewer.setViewportSeries('vp-0', CT);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.viewer.measurements.get('r-1')).toMatchObject({ stats: { pixelCount: 9 } });
    expect(h.events['measurement:updated'].at(-1)?.origin).toBe('api');
  });

  it('are reported as an error, and the call still succeeds, when the slice cannot be read', async () => {
    const h = harness();
    await show(h);
    h.port.sliceOf = () => {
      throw new Error('The slice could not be decoded.');
    };
    const added = await h.viewer.measurements.add(rectangle('r-1'));
    expect(added.id).toBe('r-1');
    expect(h.events.error.map((event) => event.context)).toEqual(['measurement']);
  });
});

describe('what the person draws', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('becomes a measurement, on the image it was drawn on, with its pixels read', async () => {
    const h = harness();
    h.port.sliceOf = () => ({ rows: 256, columns: 512, at: () => 40 });
    await show(h);

    stackOf(h).emitMeasurement({
      kind: 'completed',
      measurement: {
        id: 'drawn-1',
        type: 'rectangle',
        imageIndex: 4,
        points: [p(2, 3), p(4, 3), p(2, 5), p(4, 5)],
      },
    });

    expect(h.viewer.measurements.get('drawn-1')).toEqual({
      id: 'drawn-1',
      type: 'rectangle',
      reference: reference(4),
      points: [p(2, 3), p(4, 3), p(2, 5), p(4, 5)],
    });
    expect(h.events['measurement:added']).toHaveLength(1);
    expect(h.events['measurement:added'][0]?.origin).toBe('user');

    await vi.advanceTimersByTimeAsync(0);
    expect(h.viewer.measurements.get('drawn-1')).toMatchObject({
      stats: { pixelCount: 9, meanHu: 40, stdDevHu: 0 },
    });
    expect(h.events['measurement:updated'].at(-1)?.origin).toBe('user');
  });

  it('is not a measurement until it is completed', async () => {
    const h = harness();
    await show(h);
    stackOf(h).emitMeasurement({
      kind: 'modified',
      measurement: { id: 'drawn-1', type: 'length', imageIndex: 4, points: [p(0, 0), p(1, 1)] },
    });
    expect(h.viewer.measurements.list()).toEqual([]);
  });

  it('is not added twice', async () => {
    const h = harness();
    await show(h);
    const completed = {
      kind: 'completed' as const,
      measurement: {
        id: 'drawn-1',
        type: 'length' as const,
        imageIndex: 4,
        points: [p(0, 0), p(1, 1)],
      },
    };
    stackOf(h).emitMeasurement(completed);
    stackOf(h).emitMeasurement(completed);
    expect(h.events['measurement:added']).toHaveLength(1);
  });

  it('follows the handles as they are dragged, and reads the pixels once they stop', async () => {
    const h = harness();
    h.port.sliceOf = () => ({ rows: 256, columns: 512, at: () => 5 });
    await show(h);
    await h.viewer.measurements.add(rectangle('r-1'));
    const before = h.events['measurement:updated'].length;

    for (const right of [5, 6, 7]) {
      stackOf(h).emitMeasurement({
        kind: 'modified',
        measurement: {
          id: 'r-1',
          type: 'rectangle',
          imageIndex: 5,
          points: [p(2, 3), p(right, 3), p(2, 5), p(right, 5)],
        },
      });
    }

    // Every step is announced, and none of them has pixels yet.
    expect(h.events['measurement:updated']).toHaveLength(before + 3);
    expect(h.viewer.measurements.get('r-1')).toMatchObject({
      points: [p(2, 3), p(7, 3), p(2, 5), p(7, 5)],
    });
    expect(h.viewer.measurements.get('r-1')).not.toHaveProperty('stats.pixelCount');
    const reads = stackOf(h).slicesRead.length;

    await vi.advanceTimersByTimeAsync(STATS_DELAY_MS - 1);
    expect(stackOf(h).slicesRead).toHaveLength(reads);
    await vi.advanceTimersByTimeAsync(1);
    // Columns 2 to 7 and rows 3 to 5.
    expect(h.viewer.measurements.get('r-1')).toMatchObject({ stats: { pixelCount: 18 } });
    expect(stackOf(h).slicesRead).toHaveLength(reads + 1);
  });

  it('ignores a move that changes nothing', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    const before = h.events['measurement:updated'].length;
    stackOf(h).emitMeasurement({
      kind: 'modified',
      measurement: { id: 'm-1', type: 'length', imageIndex: 5, points: [p(0, 0), p(3, 4)] },
    });
    expect(h.events['measurement:updated']).toHaveLength(before);
  });

  it('is removed when the person removes it', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    stackOf(h).emitMeasurement({ kind: 'removed', id: 'm-1' });
    expect(h.viewer.measurements.list()).toEqual([]);
    expect(h.events['measurement:removed']).toEqual([
      { measurement: length('m-1'), origin: 'user' },
    ]);
  });

  it('is picked when the person picks it, and not picked when they pick nothing', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    stackOf(h).emitMeasurement({ kind: 'selected', id: 'm-1' });
    expect(h.viewer.measurements.getSelected()).toBe('m-1');
    stackOf(h).emitMeasurement({ kind: 'selected', id: undefined });
    expect(h.viewer.measurements.getSelected()).toBeUndefined();
    expect(h.events['measurement:selected']).toEqual([
      { id: 'm-1', previous: undefined },
      { id: undefined, previous: 'm-1' },
    ]);
  });

  it('does not pick a shape that is not a measurement', async () => {
    const h = harness();
    await show(h);
    stackOf(h).emitMeasurement({ kind: 'selected', id: 'nobody' });
    expect(h.viewer.measurements.getSelected()).toBeUndefined();
  });

  it('stops reading pixels once the viewer is destroyed', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(rectangle('r-1'));
    stackOf(h).emitMeasurement({
      kind: 'modified',
      measurement: {
        id: 'r-1',
        type: 'rectangle',
        imageIndex: 5,
        points: [p(2, 3), p(9, 3), p(2, 5), p(9, 5)],
      },
    });
    const reads = stackOf(h).slicesRead.length;
    h.viewer.destroy();
    await vi.advanceTimersByTimeAsync(STATS_DELAY_MS * 2);
    expect(stackOf(h).slicesRead).toHaveLength(reads);
    expect(h.events.error).toEqual([]);
  });
});

describe('measurements.update', () => {
  it('renames a measurement, and a blank name takes the label away', async () => {
    const h = harness();
    await h.viewer.measurements.add(length('m-1'));

    const named = await h.viewer.measurements.update('m-1', { label: '  Aorta ' });
    expect(named.label).toBe('Aorta');
    const event = h.events['measurement:updated'].at(-1);
    expect(event).toMatchObject({ origin: 'api', measurement: { label: 'Aorta' } });
    expect(event?.previous.label).toBeUndefined();

    const unnamed = await h.viewer.measurements.update('m-1', { label: '' });
    expect(unnamed.label).toBeUndefined();
    const nulled = await h.viewer.measurements.update('m-1', { label: 'x' });
    expect(nulled.label).toBe('x');
    expect((await h.viewer.measurements.update('m-1', { label: null })).label).toBeUndefined();
  });

  it('announces nothing when nothing changes', async () => {
    const h = harness();
    await h.viewer.measurements.add({ ...length('m-1'), label: 'Aorta' });
    await h.viewer.measurements.update('m-1', { label: 'Aorta' });
    expect(h.events['measurement:updated']).toEqual([]);
  });

  it('moves the handles, tells the engine, and reads the pixels again', async () => {
    const h = harness();
    h.port.sliceOf = () => ({ rows: 256, columns: 512, at: () => 1 });
    await show(h);
    await h.viewer.measurements.add(rectangle('r-1'));

    const moved = await h.viewer.measurements.update('r-1', {
      points: [p(0, 0), p(9, 0), p(0, 1), p(9, 1)],
    });

    // Columns 0 to 9, rows 0 and 1.
    expect(moved).toMatchObject({ stats: { pixelCount: 20 } });
    expect(stackOf(h).measurementCalls).toContain('update r-1');
    expect(stackOf(h).measurements.get('r-1')?.points).toEqual([
      p(0, 0),
      p(9, 0),
      p(0, 1),
      p(9, 1),
    ]);
  });

  it('refuses points that do not fit, and an id that is not there', async () => {
    const h = harness();
    await h.viewer.measurements.add(length('m-1'));
    await expect(h.viewer.measurements.update('m-1', { points: [p(0, 0)] })).rejects.toThrow(
      RangeError,
    );
    await expect(h.viewer.measurements.update('m-1', { label: 'x'.repeat(201) })).rejects.toThrow(
      RangeError,
    );
    await expect(h.viewer.measurements.update('nobody', { label: 'x' })).rejects.toThrow(
      /no measurement/,
    );
    expect(h.viewer.measurements.get('m-1')).toEqual(length('m-1'));
  });
});

describe('measurements.remove and clear', () => {
  it('removes a measurement from the list and from the image', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    await h.viewer.measurements.select('m-1');

    expect(await h.viewer.measurements.remove('m-1')).toBe(true);

    expect(h.viewer.measurements.list()).toEqual([]);
    expect(stackOf(h).measurements.size).toBe(0);
    expect(h.viewer.measurements.getSelected()).toBeUndefined();
    expect(h.events['measurement:removed']).toEqual([
      { measurement: length('m-1'), origin: 'api' },
    ]);
  });

  it('says there was none to remove, without an error', async () => {
    const { viewer } = harness();
    expect(await viewer.measurements.remove('nobody')).toBe(false);
  });

  it('clears all, or those on one series', async () => {
    const h = harness();
    await h.viewer.measurements.add(length('a'));
    await h.viewer.measurements.add(length('b'));
    await h.viewer.measurements.add({
      ...length('c'),
      reference: { ...reference(1), seriesInstanceUID: CT_TWO_STACKS },
    });

    expect(await h.viewer.measurements.clear({ seriesInstanceUID: CT_TWO_STACKS })).toBe(1);
    expect(h.viewer.measurements.list().map((measurement) => measurement.id)).toEqual(['a', 'b']);
    expect(await h.viewer.measurements.clear()).toBe(2);
    expect(h.viewer.measurements.list()).toEqual([]);
  });
});

describe('measurements.list', () => {
  it('keeps the order they were made in, and filters by study, series, and instance', async () => {
    const h = harness();
    await h.viewer.measurements.add(length('a', 1));
    await h.viewer.measurements.add(length('b', 2));
    await h.viewer.measurements.add({
      ...length('c'),
      reference: { ...reference(1), studyInstanceUID: '9.9' },
    });
    const ids = (filter?: Parameters<typeof h.viewer.measurements.list>[0]): string[] =>
      h.viewer.measurements.list(filter).map((measurement) => measurement.id);

    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(ids({ studyInstanceUID: STUDY })).toEqual(['a', 'b']);
    expect(ids({ seriesInstanceUID: CT, sopInstanceUID: sop(2) })).toEqual(['b']);
    expect(ids({ studyInstanceUID: '0.0' })).toEqual([]);
  });
});

describe('selecting and jumping', () => {
  it('picks one measurement on the image and in the list, and none with undefined', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));

    await h.viewer.measurements.select('m-1');
    expect(h.viewer.measurements.getSelected()).toBe('m-1');
    expect(stackOf(h).measurementCalls).toContain('select m-1');

    await h.viewer.measurements.select(undefined);
    expect(h.viewer.measurements.getSelected()).toBeUndefined();
    expect(stackOf(h).measurementCalls.at(-1)).toBe('select none');
  });

  it('refuses to pick one that is not there', async () => {
    const { viewer } = harness();
    await expect(viewer.measurements.select('nobody')).rejects.toThrow(RangeError);
  });

  it('shows the image a measurement is on, and picks it', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1', 2));
    expect(h.viewer.getState().viewports[0]?.imageIndex).toBe(5);

    await h.viewer.measurements.jumpTo('m-1');

    expect(h.viewer.getState().viewports[0]?.imageIndex).toBe(2);
    expect(h.viewer.measurements.getSelected()).toBe('m-1');
  });

  it('shows the series first when another one is on screen', async () => {
    const h = harness();
    await show(h, CT_TWO_STACKS);
    await h.viewer.measurements.add(length('m-1', 3));
    await h.viewer.measurements.jumpTo('m-1');
    expect(h.viewer.getState().viewports[0]).toMatchObject({
      seriesInstanceUID: CT,
      imageIndex: 3,
    });
    // Drawn on arrival, and picked.
    expect(stackOf(h, 1).measurements.has('m-1')).toBe(true);
    expect(stackOf(h, 1).measurementCalls).toContain('select m-1');
  });

  it('refuses an id that is not there', async () => {
    const { viewer } = harness();
    await expect(viewer.measurements.jumpTo('nobody')).rejects.toThrow(RangeError);
  });
});

describe('when the image goes away and comes back', () => {
  it('keeps the measurements, takes them off the engine, and draws them again', async () => {
    const h = harness();
    await show(h);
    stackOf(h).emitMeasurement({
      kind: 'completed',
      measurement: { id: 'drawn-1', type: 'length', imageIndex: 5, points: [p(0, 0), p(1, 1)] },
    });

    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(stackOf(h, 0).destroyed).toBe(true);
    expect(stackOf(h, 0).measurements.size).toBe(0);
    expect(h.viewer.measurements.list()).toHaveLength(1);

    await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 5 });
    expect(stackOf(h, 2).measurements.has('drawn-1')).toBe(true);
  });

  it("does not take the engine's removal of its shapes for the person's", async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(h.viewer.measurements.list()).toHaveLength(1);
    expect(h.events['measurement:removed']).toEqual([]);
  });

  it('draws what is kept when a viewport is attached after the measurements were added', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    await h.viewer.measurements.add(length('m-1'));
    await show(h);
    expect(stackOf(h).measurements.has('m-1')).toBe(true);
  });

  it('keeps what is picked picked on the next image', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    await h.viewer.measurements.select('m-1');
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    await h.viewer.setViewportSeries('vp-0', CT);
    expect(stackOf(h, 2).measurementCalls).toContain('select m-1');
  });
});

describe('exportJson and importJson', () => {
  const rectangleWithStats = (): RectangleMeasurement => ({
    ...rectangle('r-1'),
    stats: { pixelCount: 9, meanHu: 40, stdDevHu: 1, minHu: 38, maxHu: 44 },
  });

  it('writes the format, every measurement, and the numbers worked out for each', async () => {
    const h = harness();
    await h.viewer.measurements.add({ ...length('m-1'), label: 'Aorta' });
    await h.viewer.measurements.add(rectangleWithStats());

    const exported = h.viewer.measurements.exportJson();

    expect(exported.format).toBe('measurements/v1');
    expect(exported.measurements).toHaveLength(2);
    expect(exported.measurements[0]).toMatchObject({
      id: 'm-1',
      label: 'Aorta',
      values: { lengthMm: 5 },
    });
    expect(exported.measurements[1]).toMatchObject({
      id: 'r-1',
      values: { areaMm2: 4, meanHu: 40, pixelCount: 9 },
    });
  });

  it('survives JSON text and comes back the same, in a viewer that has nothing', async () => {
    const first = harness();
    await first.viewer.measurements.add({ ...length('m-1'), label: 'Aorta' });
    await first.viewer.measurements.add(rectangleWithStats());
    const text = JSON.stringify(first.viewer.measurements.exportJson());

    const second = harness();
    const result = await second.viewer.measurements.importJson(text);

    expect(result).toEqual({ added: 2, replaced: 0 });
    expect(second.viewer.measurements.exportJson()).toEqual(first.viewer.measurements.exportJson());
    expect(second.events['measurement:added'].map((event) => event.origin)).toEqual([
      'import',
      'import',
    ]);
  });

  it('accepts the document as an object too', async () => {
    const first = harness();
    await first.viewer.measurements.add(length('m-1'));
    const second = harness();
    await second.viewer.measurements.importJson(first.viewer.measurements.exportJson());
    expect(second.viewer.measurements.list()).toEqual([length('m-1')]);
  });

  it('draws what it imports when the image is on screen', async () => {
    const first = harness();
    await first.viewer.measurements.add(length('m-1'));
    const second = harness();
    await show(second);
    await second.viewer.measurements.importJson(first.viewer.measurements.exportJson());
    expect(stackOf(second).measurements.has('m-1')).toBe(true);
  });

  it('merges by default, replacing a measurement that has the same id', async () => {
    const h = harness();
    await h.viewer.measurements.add({ ...length('m-1'), label: 'old' });
    await h.viewer.measurements.add(length('keep'));
    const document = {
      format: 'measurements/v1',
      measurements: [{ ...length('m-1'), label: 'new' }, length('fresh')],
    };

    const result = await h.viewer.measurements.importJson(document);

    expect(result).toEqual({ added: 1, replaced: 1 });
    expect(h.viewer.measurements.list().map((measurement) => measurement.id)).toEqual([
      'm-1',
      'keep',
      'fresh',
    ]);
    expect(h.viewer.measurements.get('m-1')?.label).toBe('new');
    expect(h.events['measurement:updated'].at(-1)?.origin).toBe('import');
  });

  it('starts empty in replace mode', async () => {
    const h = harness();
    await h.viewer.measurements.add(length('keep'));
    await h.viewer.measurements.importJson(
      { format: 'measurements/v1', measurements: [length('fresh')] },
      { mode: 'replace' },
    );
    expect(h.viewer.measurements.list().map((measurement) => measurement.id)).toEqual(['fresh']);
    expect(h.events['measurement:removed'].map((event) => event.origin)).toEqual(['import']);
  });

  it('adds nothing from a document with something wrong in it', async () => {
    const h = harness();
    const document = {
      format: 'measurements/v1',
      measurements: [length('ok'), { ...length('bad'), points: [p(0, 0)] }],
    };
    await expect(h.viewer.measurements.importJson(document)).rejects.toThrow(RangeError);
    await expect(h.viewer.measurements.importJson('{nope')).rejects.toThrow(/JSON/);
    expect(h.viewer.measurements.list()).toEqual([]);
  });

  it('reads the pixels of an imported shape that came without them, once its image is on screen', async () => {
    vi.useFakeTimers();
    const h = harness();
    await show(h);
    await h.viewer.measurements.importJson({
      format: 'measurements/v1',
      measurements: [rectangle('r-1')],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.viewer.measurements.get('r-1')).toMatchObject({ stats: { pixelCount: 9 } });
    expect(h.events['measurement:updated'].at(-1)?.origin).toBe('import');
  });
});

describe('the Delete key', () => {
  const press = (element: HTMLElement, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  };

  it('removes the measurement that is picked', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    await h.viewer.measurements.select('m-1');

    const event = press(h.element, 'Delete');
    await vi.waitFor(() => {
      expect(h.viewer.measurements.list()).toEqual([]);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the key alone when nothing is picked', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.add(length('m-1'));
    expect(press(h.element, 'Backspace').defaultPrevented).toBe(false);
    expect(h.viewer.measurements.list()).toHaveLength(1);
  });
});
