// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createFakeViewer, FAKE_IDS } from './testing';

describe('createFakeViewer', () => {
  it('is a working viewer: it loads a study and shows a series on the fake engine', async () => {
    const { viewer, port } = createFakeViewer();
    const element = document.createElement('div');
    viewer.viewports.attach('vp-0', element);
    await viewer.loadStudy(FAKE_IDS.study);
    await viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
    expect(viewer.viewports.get('vp-0')?.imageCount).toBe(10);
    expect(port.stacks).toHaveLength(1);
    viewer.destroy();
  });

  it('takes the same options as the core, such as a panel-free initial state', () => {
    const { viewer } = createFakeViewer({ overlay: false, keybindings: false });
    expect(viewer.getState().layout).toBe('1x1');
    viewer.destroy();
  });
});
