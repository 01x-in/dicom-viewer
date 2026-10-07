// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import { segmentationName } from './index';
import type { DvSegmentationListElement } from './segmentation-list';

const open: FakeViewer[] = [];

afterEach(() => {
  document.body.replaceChildren();
  for (const fake of open.splice(0)) fake.viewer.destroy();
});

const settle = async (element: DvSegmentationListElement): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
};

async function mount(
  options: { study?: boolean; load?: readonly string[] } = {},
): Promise<{ list: DvSegmentationListElement; fake: FakeViewer }> {
  const fake = createFakeViewer();
  open.push(fake);
  fake.viewer.viewports.attach('vp-0', document.createElement('div'));
  if (options.study !== false) {
    await fake.viewer.loadStudy(FAKE_IDS.study);
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
  }
  for (const uid of options.load ?? []) await fake.viewer.segmentations.load(uid);
  const list = document.createElement('dv-segmentation-list') as DvSegmentationListElement;
  list.viewer = fake.viewer;
  document.body.append(list);
  await settle(list);
  return { list, fake };
}

const groups = (list: DvSegmentationListElement): HTMLElement[] => [
  ...(list.shadowRoot?.querySelectorAll<HTMLElement>('[data-segmentation]') ?? []),
];
const group = (list: DvSegmentationListElement, uid: string): HTMLElement => {
  const found = groups(list).find((item) => item.dataset['segmentation'] === uid);
  if (found === undefined) throw new Error(`No group for ${uid}`);
  return found;
};
const segmentRow = (list: DvSegmentationListElement, uid: string, number: number): HTMLElement => {
  const found = [...group(list, uid).querySelectorAll<HTMLElement>('[data-segment]')].find(
    (item) => item.dataset['segment'] === number.toString(),
  );
  if (found === undefined) throw new Error(`No segment ${number.toString()} in ${uid}`);
  return found;
};
const within = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`No ${selector}`);
  return found;
};
const inputIn = (root: HTMLElement, selector: string): HTMLInputElement => {
  const found = root.querySelector<HTMLInputElement>(selector);
  if (found === null) throw new Error(`No ${selector}`);
  return found;
};
const buttonIn = (root: HTMLElement, selector: string): HTMLButtonElement => {
  const found = root.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`No ${selector}`);
  return found;
};
const change = (element: HTMLInputElement, value: string | boolean): void => {
  if (typeof value === 'boolean') element.checked = value;
  else element.value = value;
  element.dispatchEvent(
    new Event(element.type === 'checkbox' ? 'change' : 'input', { bubbles: true }),
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('segmentationName', () => {
  it('is the number and the description, or just SEG', () => {
    const series = {
      seriesInstanceUID: '1',
      modality: 'SEG',
      description: 'Organs',
      seriesNumber: 4,
      instanceCount: 1,
    };
    expect(segmentationName(series)).toBe('4. Organs');
    expect(segmentationName({ ...series, seriesNumber: undefined })).toBe('Organs');
    expect(segmentationName({ ...series, seriesNumber: undefined, description: undefined })).toBe(
      'SEG',
    );
  });
});

describe('<dv-segmentation-list>', () => {
  it('says there are none before a study is loaded', async () => {
    const { list } = await mount({ study: false });
    expect(list.shadowRoot?.querySelector('[role="status"]')?.textContent).toContain(
      'no segmentations',
    );
    expect(groups(list)).toEqual([]);
  });

  it('lists every SEG of the study, none loaded, each with a Load button', async () => {
    const { list, fake } = await mount();
    const segs = fake.viewer.getStudy()?.series.filter((item) => item.modality === 'SEG') ?? [];
    expect(segs.length).toBeGreaterThan(1);
    expect(groups(list)).toHaveLength(segs.length);
    for (const item of groups(list)) {
      expect(buttonIn(item, '[data-action="load"]').getAttribute('aria-label')).toMatch(/^Load /);
      expect(item.querySelector('[data-segment]')).toBeNull();
    }
  });

  it('loads a SEG when Load is pressed, says it is loading, and then lists its segments', async () => {
    const { list, fake } = await mount();
    const button = buttonIn(group(list, FAKE_IDS.seg), '[data-action="load"]');
    const hold = fake.port.holdSegmentationLoads();
    button.click();
    await settle(list);
    expect(group(list, FAKE_IDS.seg).getAttribute('aria-busy')).toBe('true');
    const again = buttonIn(group(list, FAKE_IDS.seg), '[data-action="load"]');
    expect(again.textContent).toContain('Loading');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    // A second press while it loads does nothing more.
    again.click();
    hold.release();
    await settle(list);
    expect(fake.port.segmentationLoads).toHaveLength(1);
    const names = [...group(list, FAKE_IDS.seg).querySelectorAll('.segment-name')].map((item) =>
      item.textContent.trim(),
    );
    expect(names).toEqual(['Body', 'Lesion']);
    expect(group(list, FAKE_IDS.seg).querySelector('[data-action="load"]')).toBeNull();
  });

  it('lists the segments of a SEG that was loaded before it was shown', async () => {
    const { list } = await mount({ load: [FAKE_IDS.seg, FAKE_IDS.segSecond] });
    expect(
      [...group(list, FAKE_IDS.segSecond).querySelectorAll('.segment-name')].map((item) =>
        item.textContent.trim(),
      ),
    ).toEqual(['Air', 'Water', 'Fat']);
  });

  it('shows and hides a segment from its checkbox', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const box = inputIn(segmentRow(list, FAKE_IDS.seg, 2), 'input[type="checkbox"]');
    expect(box.checked).toBe(true);
    expect(box.getAttribute('aria-label')).toBe('Show Lesion');
    change(box, false);
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.segments[1]?.visible).toBe(false);
    expect(inputIn(segmentRow(list, FAKE_IDS.seg, 2), 'input[type="checkbox"]').checked).toBe(
      false,
    );
    expect(inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="checkbox"]').checked).toBe(true);
  });

  it('shows and hides a whole SEG from its checkbox', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const box = inputIn(group(list, FAKE_IDS.seg), '.seg-head input[type="checkbox"]');
    change(box, false);
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.visible).toBe(false);
  });

  it('changes a segment colour from its colour input, in hex', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const picker = inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="color"]');
    expect(picker.getAttribute('aria-label')).toBe('Body colour');
    expect(picker.value).toBe('#e6194b');
    change(picker, '#00ff80');
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.segments[0]?.color).toEqual([0, 255, 128]);
    expect(inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="color"]').value).toBe('#00ff80');
  });

  it('changes the opacity of a segment and of a SEG from sliders, in percent', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const segmentSlider = inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="range"]');
    expect(segmentSlider.getAttribute('aria-label')).toBe('Body opacity');
    expect(segmentSlider.value).toBe('100');
    change(segmentSlider, '40');
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.segments[0]?.opacity).toBeCloseTo(0.4);
    const wholeSlider = inputIn(group(list, FAKE_IDS.seg), '.seg-opacity input');
    expect(wholeSlider.value).toBe('50');
    change(wholeSlider, '75');
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.opacity).toBeCloseTo(0.75);
  });

  it('sends the newest value when a slider is moved faster than the viewer answers', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const slider = inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="range"]');
    for (const value of ['10', '20', '30', '60']) {
      slider.value = value;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.segments[0]?.opacity).toBeCloseTo(0.6);
  });

  it('does not send a slider value that was waiting to a viewer set afterwards', async () => {
    const { list } = await mount({ load: [FAKE_IDS.seg] });
    const other = createFakeViewer();
    open.push(other);
    await other.viewer.loadStudy(FAKE_IDS.study);
    await other.viewer.segmentations.load(FAKE_IDS.seg);
    const slider = inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="range"]');
    // Two values in a row: the first is sent at once, the second waits for it.
    slider.value = '20';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.value = '70';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    list.viewer = other.viewer;
    await settle(list);
    expect(other.viewer.segmentations.get(FAKE_IDS.seg)?.segments[0]?.opacity).toBe(1);
  });

  it('highlights a segment, and takes the highlight away when pressed again', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const button = (): HTMLButtonElement =>
      buttonIn(segmentRow(list, FAKE_IDS.seg, 2), '[data-action="highlight"]');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    button().click();
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.highlight?.segments).toEqual([2]);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(
      buttonIn(segmentRow(list, FAKE_IDS.seg, 1), '[data-action="highlight"]').getAttribute(
        'aria-pressed',
      ),
    ).toBe('false');
    button().click();
    await settle(list);
    expect(fake.viewer.segmentations.get(FAKE_IDS.seg)?.highlight).toBeUndefined();
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('shows an image of a segment when Go to is pressed', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    const button = buttonIn(segmentRow(list, FAKE_IDS.seg, 1), '[data-action="jump"]');
    expect(button.getAttribute('aria-label')).toBe('Go to Body');
    button.click();
    await settle(list);
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(4);
  });

  it('works on the viewport it is told to', async () => {
    const fake = createFakeViewer({
      initialState: {
        version: 1,
        layout: '1x1',
        viewports: [{ id: 'vp-0' }, { id: 'vp-1' }],
      },
    });
    open.push(fake);
    fake.viewer.viewports.attach('vp-1', document.createElement('div'));
    await fake.viewer.loadStudy(FAKE_IDS.study);
    await fake.viewer.segmentations.load(FAKE_IDS.seg);
    const list = document.createElement('dv-segmentation-list') as DvSegmentationListElement;
    list.viewer = fake.viewer;
    list.viewportId = 'vp-1';
    document.body.append(list);
    await settle(list);
    buttonIn(segmentRow(list, FAKE_IDS.seg, 1), '[data-action="jump"]').click();
    await settle(list);
    expect(
      fake.viewer.getState().viewports.find((viewport) => viewport.id === 'vp-1'),
    ).toMatchObject({
      seriesInstanceUID: FAKE_IDS.ct,
      imageIndex: 4,
    });
  });

  it('unloads a SEG, which goes back to a Load button', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    buttonIn(group(list, FAKE_IDS.seg), '[data-action="unload"]').click();
    await settle(list);
    expect(fake.viewer.segmentations.list()).toEqual([]);
    expect(within(group(list, FAKE_IDS.seg), '[data-action="load"]')).toBeDefined();
    expect(group(list, FAKE_IDS.seg).querySelector('[data-segment]')).toBeNull();
  });

  it('says what is doubtful about a SEG that was loaded', async () => {
    const { list } = await mount({ load: [FAKE_IDS.segOff] });
    const warnings = within(group(list, FAKE_IDS.segOff), '.warnings');
    expect(warnings.getAttribute('aria-label')).toBe('Warnings');
    expect(warnings.textContent).toContain('Warning:');
    expect(warnings.textContent).toContain('another frame of reference');
  });

  it('says a segment has no pixels, and does not go to it', async () => {
    const fake = createFakeViewer();
    open.push(fake);
    fake.viewer.viewports.attach('vp-0', document.createElement('div'));
    await fake.viewer.loadStudy(FAKE_IDS.study);
    fake.port.segmentationIndexOf = () => ({ segments: [], overlaps: [] });
    await fake.viewer.segmentations.load(FAKE_IDS.seg);
    const list = document.createElement('dv-segmentation-list') as DvSegmentationListElement;
    list.viewer = fake.viewer;
    document.body.append(list);
    await settle(list);
    const row = segmentRow(list, FAKE_IDS.seg, 1);
    expect(row.textContent).toContain('No pixels');
    const jump = buttonIn(row, '[data-action="jump"]');
    expect(jump.getAttribute('aria-disabled')).toBe('true');
    jump.click();
    await settle(list);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBeUndefined();
  });

  it('reports a SEG that cannot be loaded as dv-error, and offers Load again', async () => {
    const { list } = await mount();
    const errors: { error: Error; context: string }[] = [];
    list.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error; context: string }>).detail);
    });
    buttonIn(group(list, FAKE_IDS.segUnreadable), '[data-action="load"]').click();
    await settle(list);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('segmentation');
    expect(errors[0]?.error.message).toMatch(/not a readable DICOM file/);
    const button = buttonIn(group(list, FAKE_IDS.segUnreadable), '[data-action="load"]');
    expect(button.textContent).toContain('Load');
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('follows changes the host makes through the viewer', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    await fake.viewer.segmentations.setSegmentVisible(FAKE_IDS.seg, 1, false);
    await fake.viewer.segmentations.setSegmentColor(FAKE_IDS.seg, 2, '#112233');
    await fake.viewer.segmentations.highlight(FAKE_IDS.seg, [1]);
    await settle(list);
    expect(inputIn(segmentRow(list, FAKE_IDS.seg, 1), 'input[type="checkbox"]').checked).toBe(
      false,
    );
    expect(inputIn(segmentRow(list, FAKE_IDS.seg, 2), 'input[type="color"]').value).toBe('#112233');
    expect(
      buttonIn(segmentRow(list, FAKE_IDS.seg, 1), '[data-action="highlight"]').getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    await fake.viewer.segmentations.load(FAKE_IDS.segSecond);
    await settle(list);
    expect(segmentRow(list, FAKE_IDS.segSecond, 3)).toBeDefined();
  });

  it('forgets the SEGs when another study is loaded', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    await fake.viewer.loadStudy('1.2.4');
    await settle(list);
    expect(groups(list).every((item) => item.querySelector('[data-segment]') === null)).toBe(true);
  });

  it('stops listening when removed, and listens again when it is put back', async () => {
    const { list, fake } = await mount({ load: [FAKE_IDS.seg] });
    list.remove();
    await fake.viewer.segmentations.setVisible(FAKE_IDS.seg, false);
    document.body.append(list);
    await settle(list);
    expect(inputIn(group(list, FAKE_IDS.seg), '.seg-head input[type="checkbox"]').checked).toBe(
      false,
    );
    await fake.viewer.segmentations.setVisible(FAKE_IDS.seg, true);
    await settle(list);
    expect(inputIn(group(list, FAKE_IDS.seg), '.seg-head input[type="checkbox"]').checked).toBe(
      true,
    );
  });

  it('names the icon buttons of a segment, for the screen reader and for a hover', async () => {
    const { list } = await mount({ load: [FAKE_IDS.seg] });
    const row = segmentRow(list, FAKE_IDS.seg, 1);
    for (const action of ['highlight', 'jump']) {
      const button = buttonIn(row, `[data-action="${action}"]`);
      expect(button.getAttribute('aria-label')).toMatch(/\S/);
      expect(button.getAttribute('title')).toMatch(/\S/);
      expect(button.querySelector('svg.icon[aria-hidden="true"]')).not.toBeNull();
      expect(button.textContent.trim()).toBe('');
    }
  });

  it('keeps the name of a segment as plain text, apart from the buttons, so it can wrap', async () => {
    const { list } = await mount({ load: [FAKE_IDS.seg] });
    const name = within(segmentRow(list, FAKE_IDS.seg, 1), '.segment-name');
    expect(name.textContent.trim()).toBe('Body');
    expect(name.querySelector('button, input')).toBeNull();
  });

  it('says warning to a screen reader and shows a picture for it', async () => {
    const { list } = await mount({ load: [FAKE_IDS.segOff] });
    const first = group(list, FAKE_IDS.segOff).querySelector('.warnings li');
    expect(first?.querySelector('svg.icon[aria-hidden="true"]')).not.toBeNull();
    expect(first?.querySelector('.dv-visually-hidden')?.textContent).toBe('Warning: ');
  });
});
