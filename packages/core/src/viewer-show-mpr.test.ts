// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function withSeries(series = CT): Promise<Harness> {
  const h = harness();
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', series);
  return h;
}

const orientations = (h: Harness): (string | undefined)[] =>
  h.viewer.getState().viewports.map((viewport) => viewport.orientation);
const shownSeries = (h: Harness): (string | undefined)[] =>
  h.viewer.getState().viewports.map((viewport) => viewport.seriesInstanceUID);

describe('viewer.showMpr', () => {
  it('shows the series on screen in three planes and as slices, in a 2x2 layout', async () => {
    const h = await withSeries();
    await h.viewer.showMpr();
    expect(h.viewer.getState().layout).toBe('2x2');
    expect(orientations(h)).toEqual(['axial', 'sagittal', 'coronal', undefined]);
    expect(shownSeries(h)).toEqual([CT, CT, CT, CT]);
  });

  it('draws one volume for the three planes', async () => {
    const h = await withSeries();
    await h.viewer.showMpr();
    for (const id of ['vp-1', 'vp-2', 'vp-3']) {
      // The shell attaches an element for each viewport the layout brings, and each draws then.
      h.viewer.viewports.attach(id, document.createElement('div'));
    }
    await h.viewer.setState({});
    expect(h.port.volumeCalls.map((call) => call.split(' ')[0]).sort()).toEqual([
      'axial',
      'coronal',
      'sagittal',
    ]);
    expect(h.viewer.viewports.get('vp-3')?.mpr).toBeUndefined();
  });

  it('takes the series from the active viewport, or from the one it is told', async () => {
    const h = await withSeries();
    await h.viewer.showMpr({ seriesInstanceUID: CT_TWO_STACKS });
    expect(shownSeries(h)).toEqual([CT_TWO_STACKS, CT_TWO_STACKS, CT_TWO_STACKS, CT_TWO_STACKS]);
    await h.viewer.setViewportSeries('vp-1', CT);
    h.viewer.viewports.setActive('vp-1');
    await h.viewer.showMpr();
    expect(shownSeries(h)).toEqual([CT, CT, CT, CT]);
  });

  it('keeps the stack of the series that is on screen', async () => {
    const h = await withSeries(CT_TWO_STACKS);
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS, { stackIndex: 1 });
    await h.viewer.showMpr();
    expect(h.viewer.getState().viewports.map((viewport) => viewport.stackIndex ?? 0)).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it('makes vp-0 the active viewport, where the axial plane is', async () => {
    const h = await withSeries();
    await h.viewer.setLayout('1x2');
    h.viewer.viewports.setActive('vp-1');
    await h.viewer.setViewportSeries('vp-1', CT);
    await h.viewer.showMpr();
    expect(h.viewer.viewports.active).toBe('vp-0');
  });

  it('rejects with nothing on screen to reformat', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await expect(h.viewer.showMpr()).rejects.toThrow(/Show a series first/);
    expect(h.viewer.getState().layout).toBe('1x1');
  });

  it('rejects before a study is loaded, and a series that is not a UID', async () => {
    const h = harness();
    await expect(h.viewer.showMpr()).rejects.toThrow();
    const loaded = await withSeries();
    await expect(loaded.viewer.showMpr({ seriesInstanceUID: '../x' })).rejects.toThrow();
    expect(loaded.viewer.getState().layout).toBe('1x1');
  });

  it('shows slices for a series that cannot be reformatted, with the reason in each plane', async () => {
    const h = harness();
    const original = h.source.getSeries.bind(h.source);
    h.source.getSeries = async (study, series) => {
      const loaded = await original(study, series);
      return {
        ...loaded,
        stacks: loaded.stacks.map((stack) => ({
          ...stack,
          reconstructable: { ok: false, reason: 'non-uniform-spacing' } as const,
        })),
      };
    };
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.setViewportSeries('vp-0', CT);
    await h.viewer.showMpr();
    // Only vp-0 has an element yet; the others ask the same when one is attached.
    expect(h.viewer.viewports.get('vp-0')?.mpr).toMatchObject({
      mode: 'stack',
      reason: 'non-uniform-spacing',
    });
  });

  it('is a command, and says whether it is on', async () => {
    const h = await withSeries();
    expect(h.viewer.commands.has('mpr.show')).toBe(true);
    expect(h.viewer.commands.enabled('mpr.show')).toBe(true);
    expect(h.viewer.commands.pressed('mpr.show')).toBe(false);
    await h.viewer.commands.run('mpr.show');
    expect(orientations(h).slice(0, 3)).toEqual(['axial', 'sagittal', 'coronal']);
    expect(h.viewer.commands.pressed('mpr.show')).toBe(true);
    await h.viewer.commands.run('layout.set', { layout: '1x1' });
    expect(h.viewer.commands.pressed('mpr.show')).toBe(false);
  });

  it('is not enabled with nothing on screen', () => {
    const h = harness();
    expect(h.viewer.commands.enabled('mpr.show')).toBe(false);
  });
});
