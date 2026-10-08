// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { HangingProtocol } from './hanging';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

const pair: HangingProtocol = {
  id: 'pair',
  layout: '1x2',
  viewports: [
    { id: 'vp-0', series: {} },
    { id: 'vp-1', series: {} },
  ],
};
const single: HangingProtocol = {
  id: 'single',
  layout: '1x1',
  viewports: [{ id: 'vp-0', series: {} }],
};
const needsMr: HangingProtocol = {
  id: 'needs-mr',
  layout: '1x1',
  viewports: [{ id: 'vp-0', series: { modality: 'MR' } }],
};

function withProtocols(protocols: readonly HangingProtocol[]): Harness {
  return harness({ viewer: { hangingProtocols: protocols } });
}

async function loaded(protocols: readonly HangingProtocol[]): Promise<Harness> {
  const h = withProtocols(protocols);
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  return h;
}

describe('viewer.hangingProtocols', () => {
  it('has none unless the host gives some', () => {
    expect(harness().viewer.hangingProtocols.list()).toEqual([]);
  });

  it('lists the protocols it was given, as plain data', () => {
    expect(withProtocols([pair, single]).viewer.hangingProtocols.list()).toEqual([pair, single]);
  });

  it('refuses protocols that are not valid when the viewer is made', () => {
    // What a host without types, or a JSON file, could hand in.
    const invalid = (value: unknown): HangingProtocol => value as HangingProtocol;
    expect(() => withProtocols([invalid({ ...pair, layout: '3x3' })])).toThrow(
      /Invalid hanging protocols/,
    );
  });

  it('says what fits the study on screen, and changes nothing', async () => {
    const h = await loaded([single, pair]);
    const match = h.viewer.hangingProtocols.match();
    expect(match?.protocol.id).toBe('pair');
    expect(match?.assignments.map((entry) => entry.viewportId)).toEqual(['vp-0', 'vp-1']);
    expect(h.viewer.getState().layout).toBe('1x1');
  });

  it('has no match before a study is loaded', () => {
    expect(withProtocols([single]).viewer.hangingProtocols.match()).toBeUndefined();
  });

  it('applies the best protocol: the layout, then a series in each viewport', async () => {
    const h = await loaded([single, pair]);
    const applied = await h.viewer.hangingProtocols.apply();
    expect(applied?.protocol.id).toBe('pair');
    const state = h.viewer.getState();
    expect(state.layout).toBe('1x2');
    // The study lists a series with no pictures first: it is skipped, not left on screen as a blank.
    expect(state.viewports.map((viewport) => viewport.seriesInstanceUID)).toEqual([
      CT,
      CT_TWO_STACKS,
    ]);
  });

  it('applies the protocol it is told to, even when another fits better', async () => {
    const h = await loaded([pair, single]);
    const applied = await h.viewer.hangingProtocols.apply('single');
    expect(applied?.protocol.id).toBe('single');
    expect(h.viewer.getState().layout).toBe('1x1');
  });

  it('clears a viewport the protocol leaves empty, so nothing stale stays on screen', async () => {
    const h = await loaded([pair, single]);
    await h.viewer.hangingProtocols.apply('pair');
    await h.viewer.hangingProtocols.apply('single');
    await h.viewer.setLayout('1x2');
    expect(h.viewer.getState().viewports[1]?.seriesInstanceUID).toBeUndefined();
  });

  it('does nothing, and says so, when no protocol fits', async () => {
    const h = await loaded([needsMr]);
    expect(await h.viewer.hangingProtocols.apply()).toBeUndefined();
    expect(h.viewer.getState().viewports[0]?.seriesInstanceUID).toBeUndefined();
  });

  it('rejects an id it does not have with a RangeError, and one before a study is loaded', async () => {
    const h = await loaded([single]);
    await expect(h.viewer.hangingProtocols.apply('nope')).rejects.toThrow(RangeError);
    const early = withProtocols([single]);
    await expect(early.viewer.hangingProtocols.apply()).rejects.toThrow(/Load a study first/);
  });

  it('draws the series in the viewports that have an element', async () => {
    const h = await loaded([pair]);
    await h.viewer.hangingProtocols.apply();
    // The viewport the layout brought is drawn as soon as it has an element, as `setLayout` does.
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    await h.viewer.setViewportSeries('vp-1', CT_TWO_STACKS);
    expect(h.viewer.viewports.get('vp-0')?.series?.seriesInstanceUID).toBe(CT);
    expect(h.viewer.viewports.get('vp-1')?.series?.seriesInstanceUID).toBe(CT_TWO_STACKS);
  });

  it('skips a series that cannot be shown and tries the next, as it does for the first picture', async () => {
    const h = await loaded([single]);
    // Put the series that has no pixels first: the protocol must not leave the study on nothing.
    const applied = await h.viewer.hangingProtocols.apply();
    expect(applied?.assignments[0]?.seriesInstanceUID).not.toBeUndefined();
  });

  it('clears the plane of a viewport the protocol leaves empty', async () => {
    const h = await loaded([pair, single]);
    await h.viewer.setLayout('1x2');
    await h.viewer.setViewportSeries('vp-1', CT, { orientation: 'coronal' });
    await h.viewer.hangingProtocols.apply('pair');
    await h.viewer.hangingProtocols.apply('single');
    await h.viewer.setLayout('1x2');
    expect(h.viewer.getState().viewports[1]?.orientation).toBeUndefined();
    await h.viewer.hangingProtocols.apply('pair');
    await h.viewer.setViewportSeries('vp-1', CT_TWO_STACKS);
    expect(h.viewer.getState().viewports[1]?.orientation).toBeUndefined();
  });

  it('leaves the viewer as it was when a viewport fails to draw', async () => {
    const h = withProtocols([pair]);
    h.viewer.viewports.attach('vp-0', h.element);
    await h.viewer.loadStudy(STUDY);
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS, { imageIndex: 2 });
    await h.viewer.setLayout('1x2');
    h.viewer.viewports.attach('vp-1', document.createElement('div'));
    const before = h.viewer.getState();
    const original = h.port.renderStack.bind(h.port);
    let calls = 0;
    h.port.renderStack = (element, stack, options) => {
      calls += 1;
      // The first viewport draws; the second does not; the drawing that puts things back does.
      return calls === 2
        ? Promise.reject(new Error('no picture'))
        : original(element, stack, options);
    };
    await expect(h.viewer.hangingProtocols.apply()).rejects.toThrow('no picture');
    expect(h.viewer.getState()).toEqual(before);
    h.port.renderStack = original;
  });
});
