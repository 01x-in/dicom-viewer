// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function twoUp(): Promise<{ h: Harness; second: HTMLElement }> {
  const h = harness();
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setLayout('1x2');
  const second = document.createElement('div');
  h.viewer.viewports.attach('vp-1', second);
  return { h, second };
}

describe('the active viewport', () => {
  it('is vp-0 until another is chosen', () => {
    const { viewer } = harness();
    expect(viewer.viewports.active).toBe('vp-0');
  });

  it('can be changed, with an event that names both', async () => {
    const { h } = await twoUp();
    h.viewer.viewports.setActive('vp-1');
    expect(h.viewer.viewports.active).toBe('vp-1');
    expect(h.events['viewport:active']).toEqual([{ viewportId: 'vp-1', previous: 'vp-0' }]);
  });

  it('does not announce a choice that changes nothing', async () => {
    const { h } = await twoUp();
    h.viewer.viewports.setActive('vp-0');
    expect(h.events['viewport:active']).toEqual([]);
  });

  it('refuses a viewport the layout does not have', async () => {
    const { h } = await twoUp();
    expect(() => {
      h.viewer.viewports.setActive('vp-3');
    }).toThrow('There is no viewport vp-3');
    expect(h.viewer.viewports.active).toBe('vp-0');
  });

  it('follows a press on a viewport element, so the toolbar acts where the person is working', async () => {
    const { h, second } = await twoUp();
    second.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.viewer.viewports.active).toBe('vp-1');
  });

  it('follows the focus of a viewport element, so Tab and a screen reader move it too', async () => {
    const { h, second } = await twoUp();
    second.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(h.viewer.viewports.active).toBe('vp-1');
  });

  it('goes back to vp-0 when the layout drops the active viewport', async () => {
    const { h } = await twoUp();
    h.viewer.viewports.setActive('vp-1');
    await h.viewer.setLayout('1x1');
    expect(h.viewer.viewports.active).toBe('vp-0');
    expect(h.events['viewport:active'].at(-1)).toEqual({ viewportId: 'vp-0', previous: 'vp-1' });
  });

  it('is where a command runs when it is not told another', async () => {
    const { h } = await twoUp();
    await h.viewer.setViewportSeries('vp-1', CT);
    h.viewer.viewports.setActive('vp-1');
    await h.viewer.commands.run('view.invert');
    expect(h.viewer.getState().viewports.map((viewport) => viewport.invert)).toEqual([
      undefined,
      true,
    ]);
  });

  it('still lets a command name its viewport', async () => {
    const { h } = await twoUp();
    await h.viewer.setViewportSeries('vp-0', CT);
    h.viewer.viewports.setActive('vp-1');
    await h.viewer.commands.run('view.invert', undefined, { viewportId: 'vp-0' });
    expect(h.viewer.getState().viewports[0]?.invert).toBe(true);
  });
});
