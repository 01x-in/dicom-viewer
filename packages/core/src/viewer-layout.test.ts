// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function ready(h: Harness): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
}

const ids = (h: Harness): string[] => h.viewer.getState().viewports.map((viewport) => viewport.id);

describe('setLayout', () => {
  it.each([
    ['1x2', ['vp-0', 'vp-1']],
    ['2x2', ['vp-0', 'vp-1', 'vp-2', 'vp-3']],
    ['1+3', ['vp-0', 'vp-1', 'vp-2', 'vp-3']],
  ] as const)('%s adds the empty viewports it shows', async (layout, expected) => {
    const h = harness();
    await ready(h);
    await h.viewer.setLayout(layout);
    expect(h.viewer.getState().layout).toBe(layout);
    expect(ids(h)).toEqual(expected);
  });

  it('keeps what vp-0 shows when the layout grows', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT, { imageIndex: 3 });
    await h.viewer.setLayout('2x2');
    expect(h.viewer.getState().viewports[0]).toMatchObject({
      seriesInstanceUID: CT,
      imageIndex: 3,
    });
    expect(h.port.stacks).toHaveLength(1);
    expect(h.port.stacks[0]?.destroyed).toBe(false);
  });

  it('draws a series in a viewport that came with the layout, once it has an element', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setLayout('1x2');
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    await h.viewer.setViewportSeries('vp-1', CT);
    expect(h.viewer.viewports.get('vp-1')?.series?.seriesInstanceUID).toBe(CT);
  });

  it('stops drawing a viewport the new layout does not have, and drops it from the state', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setLayout('1x2');
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    await h.viewer.setViewportSeries('vp-1', CT);
    expect(h.port.stacks).toHaveLength(1);

    await h.viewer.setLayout('1x1');

    expect(ids(h)).toEqual(['vp-0']);
    expect(h.port.stacks[0]?.destroyed).toBe(true);
    expect(h.viewer.viewports.get('vp-1')?.series).toBeUndefined();
  });

  it('is a no-op for the layout already in force', async () => {
    const h = harness();
    await ready(h);
    const before = h.events['state:changed'].length;
    await h.viewer.setLayout('1x1');
    expect(h.events['state:changed']).toHaveLength(before);
  });

  it('tells subscribers, with the origin api', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setLayout('2x2');
    expect(h.events['state:changed'].at(-1)).toMatchObject({
      origin: 'api',
      state: { layout: '2x2' },
      previous: { layout: '1x1' },
    });
  });

  it('rejects a layout that does not exist, and changes nothing', async () => {
    const h = harness();
    await ready(h);
    await expect(h.viewer.setLayout('3x3' as '1x1')).rejects.toThrow(RangeError);
    expect(h.viewer.getState().layout).toBe('1x1');
  });

  it('waits its turn behind a call already in the queue', async () => {
    const h = harness();
    await ready(h);
    const first = h.viewer.setViewportSeries('vp-0', CT);
    const second = h.viewer.setLayout('1x2');
    await Promise.all([first, second]);
    expect(h.viewer.getState().viewports[0]?.seriesInstanceUID).toBe(CT);
    expect(ids(h)).toEqual(['vp-0', 'vp-1']);
  });

  it('works with setState too, so a restored link can carry the layout', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.setState({ layout: '1+3', viewports: [{ id: 'vp-2', seriesInstanceUID: CT }] });
    expect(h.viewer.getState().layout).toBe('1+3');
    expect(h.viewer.getState().viewports[2]).toMatchObject({ seriesInstanceUID: CT });
  });

  it('starts in the layout of initialState', () => {
    const h = harness({
      initialState: {
        version: 1,
        layout: '2x2',
        viewports: [{ id: 'vp-0' }, { id: 'vp-1' }, { id: 'vp-2' }, { id: 'vp-3' }],
      },
    });
    expect(h.viewer.getState().layout).toBe('2x2');
  });

  it('rejects once the viewer is destroyed', async () => {
    const h = harness();
    await ready(h);
    h.viewer.destroy();
    await expect(h.viewer.setLayout('1x2')).rejects.toThrow('destroyed');
  });
});
