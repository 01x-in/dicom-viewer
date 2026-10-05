// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, vp0 } from './testing/harness';
import { DEFAULT_WINDOW_PRESETS } from './window-presets';

destroyViewersAfterEach();

async function show(h: ReturnType<typeof harness>): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT);
}

describe('window presets', () => {
  it('are the usual CT windows unless the options replace them', () => {
    expect(harness().viewer.tools.windowPresets()).toEqual(DEFAULT_WINDOW_PRESETS);
    const custom = [{ id: 'mine', label: 'Mine', center: 10, width: 20 }];
    expect(
      harness({ viewer: { windowLevelPresets: custom } }).viewer.tools.windowPresets(),
    ).toEqual(custom);
  });

  it('are checked when the viewer is made', () => {
    expect(() =>
      harness({
        viewer: {
          windowLevelPresets: [{ id: 'flat', label: 'Flat', center: 0, width: 0 }],
        },
      }),
    ).toThrow(RangeError);
  });

  it('set the window of a viewport', async () => {
    const h = harness();
    await show(h);
    const api = h.viewer.viewports.get('vp-0');

    await api?.applyWindowPreset('lung');

    expect(h.port.stacks[0]?.viewCalls).toEqual(['window -600/1500']);
    expect(vp0(h.viewer)?.window).toEqual({ center: -600, width: 1500 });
  });

  it('can be the viewer’s own, and the default ones are then gone', async () => {
    const h = harness({
      viewer: { windowLevelPresets: [{ id: 'mine', label: 'Mine', center: 10, width: 20 }] },
    });
    await show(h);
    const api = h.viewer.viewports.get('vp-0');
    await api?.applyWindowPreset('mine');
    expect(vp0(h.viewer)?.window).toEqual({ center: 10, width: 20 });
    await expect(api?.applyWindowPreset('lung')).rejects.toThrow(RangeError);
  });

  it('are refused by id when the viewer does not have them', async () => {
    const h = harness();
    await show(h);
    await expect(h.viewer.viewports.get('vp-0')?.applyWindowPreset('muscle')).rejects.toThrow(
      /no window preset "muscle"/,
    );
  });
});
