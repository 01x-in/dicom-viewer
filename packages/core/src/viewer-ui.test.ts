// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness } from './testing/harness';

destroyViewersAfterEach();

const panel = (
  id: string,
): { id: string; title: string; placement: 'left'; mount: () => void } => ({
  id,
  title: id,
  placement: 'left',
  mount: () => undefined,
});

describe('viewer.ui', () => {
  it('announces panels as they come and go', () => {
    const { viewer, events } = harness();
    const remove = viewer.ui.registerPanel(panel('notes'));
    remove();
    expect(events['ui:panels'].map((event) => event.panels.map((item) => item.id))).toEqual([
      ['notes'],
      [],
    ]);
  });

  it('refuses a panel once the viewer is destroyed, and forgets the ones it had', () => {
    const { viewer } = harness();
    viewer.ui.registerPanel(panel('notes'));
    viewer.destroy();
    expect(viewer.ui.panels()).toEqual([]);
    expect(() => viewer.ui.registerPanel(panel('late'))).toThrow(/destroyed/);
  });
});

describe('viewer.ui on destroy', () => {
  it('says the panels are gone, so whoever shows them lets go', () => {
    const { viewer, events } = harness();
    viewer.ui.registerPanel(panel('notes'));
    viewer.destroy();
    expect(events['ui:panels'].at(-1)?.panels).toEqual([]);
  });
});

describe('viewer.getStudy', () => {
  it('is undefined until a study is loaded, then lists its series', async () => {
    const { viewer } = harness();
    expect(viewer.getStudy()).toBeUndefined();
    await viewer.loadStudy(STUDY);
    expect(viewer.getStudy()?.series.map((series) => series.seriesInstanceUID)).toContain(CT);
  });

  it('does not keep the series of a study the viewer has moved away from', async () => {
    const { viewer } = harness();
    await viewer.loadStudy(STUDY);
    await viewer.setState({ studyInstanceUID: '1.2.4' });
    expect(viewer.getStudy()).toBeUndefined();
  });

  it('is announced once, with the study, by study:loaded', async () => {
    const { viewer, events } = harness();
    const seen = vi.fn();
    viewer.on('study:loaded', seen);
    await viewer.loadStudy(STUDY);
    expect(seen).toHaveBeenCalledOnce();
    expect(events['study:loaded']).toHaveLength(1);
  });
});
