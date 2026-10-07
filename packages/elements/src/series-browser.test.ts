// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@scope/viewer-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import { describeSeries, isDisplayableModality } from './index';
import type { DvSeriesBrowserElement } from './series-browser';

const open: FakeViewer[] = [];

afterEach(() => {
  document.body.replaceChildren();
  for (const fake of open.splice(0)) fake.viewer.destroy();
});

const settle = async (element: DvSeriesBrowserElement): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
};

async function mount(options: { study?: boolean } = {}): Promise<{
  browser: DvSeriesBrowserElement;
  fake: FakeViewer;
}> {
  const fake = createFakeViewer();
  open.push(fake);
  fake.viewer.viewports.attach('vp-0', document.createElement('div'));
  if (options.study !== false) await fake.viewer.loadStudy(FAKE_IDS.study);
  const browser = document.createElement('dv-series-browser') as DvSeriesBrowserElement;
  browser.viewer = fake.viewer;
  document.body.append(browser);
  await settle(browser);
  return { browser, fake };
}

const rows = (browser: DvSeriesBrowserElement): HTMLElement[] => [
  ...(browser.shadowRoot?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
];
const row = (browser: DvSeriesBrowserElement, uid: string): HTMLElement => {
  const found = rows(browser).find((item) => item.dataset['series'] === uid);
  if (found === undefined) throw new Error(`No row for ${uid}`);
  return found;
};
const nth = <T>(list: readonly T[], index: number): T => {
  const found = list.at(index);
  if (found === undefined) throw new Error(`No item at ${index.toString()}`);
  return found;
};
const press = (element: HTMLElement, key: string): void => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

describe('describeSeries', () => {
  it('names a series by number and description, and counts its images', () => {
    expect(
      describeSeries({
        seriesInstanceUID: '1',
        modality: 'CT',
        description: 'Chest',
        seriesNumber: 3,
        instanceCount: 64,
      }),
    ).toEqual({ title: '3. Chest', detail: 'CT · 64 images' });
  });

  it('falls back to the modality, and says "image" for one', () => {
    expect(
      describeSeries({
        seriesInstanceUID: '1',
        modality: 'MR',
        description: undefined,
        seriesNumber: undefined,
        instanceCount: 1,
      }),
    ).toEqual({ title: 'MR', detail: 'MR · 1 image' });
    expect(
      describeSeries({
        seriesInstanceUID: '1',
        modality: 'MR',
        description: 'x',
        seriesNumber: undefined,
        instanceCount: undefined,
      }).detail,
    ).toBe('MR');
  });

  it('knows which modalities have no picture', () => {
    expect(isDisplayableModality('CT')).toBe(true);
    expect(isDisplayableModality('SEG')).toBe(false);
    expect(isDisplayableModality('SR')).toBe(false);
  });
});

describe('<dv-series-browser>', () => {
  it('says there are no series before a study is loaded', async () => {
    const { browser } = await mount({ study: false });
    expect(browser.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe('No series.');
    expect(browser.shadowRoot?.querySelector('[role="listbox"]')).toBeNull();
  });

  it('lists the series of the study as options of a named listbox', async () => {
    const { browser, fake } = await mount();
    expect(browser.shadowRoot?.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Series',
    );
    expect(rows(browser)).toHaveLength(fake.viewer.getStudy()?.series.length ?? 0);
    expect(row(browser, FAKE_IDS.ct).textContent).toContain('CT');
  });

  it('picks up a study loaded after it was mounted', async () => {
    const { browser, fake } = await mount({ study: false });
    await fake.viewer.loadStudy(FAKE_IDS.study);
    await settle(browser);
    expect(rows(browser)).toHaveLength(fake.viewer.getStudy()?.series.length ?? 0);
    expect(rows(browser).length).toBeGreaterThan(0);
  });

  it('marks the series on screen as selected, and follows the viewport', async () => {
    const { browser, fake } = await mount();
    expect(rows(browser).every((item) => item.getAttribute('aria-selected') === 'false')).toBe(
      true,
    );
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
    await settle(browser);
    expect(row(browser, FAKE_IDS.ct).getAttribute('aria-selected')).toBe('true');
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ctTwoStacks);
    await settle(browser);
    expect(row(browser, FAKE_IDS.ct).getAttribute('aria-selected')).toBe('false');
    expect(row(browser, FAKE_IDS.ctTwoStacks).getAttribute('aria-selected')).toBe('true');
  });

  it('shows a series in the viewport when its row is clicked, or Enter or Space is pressed', async () => {
    const { browser, fake } = await mount();
    row(browser, FAKE_IDS.ct).click();
    await settle(browser);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBe(FAKE_IDS.ct);
    press(row(browser, FAKE_IDS.ctTwoStacks), 'Enter');
    await settle(browser);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBe(FAKE_IDS.ctTwoStacks);
    press(row(browser, FAKE_IDS.ct), ' ');
    await settle(browser);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBe(FAKE_IDS.ct);
  });

  it('works on the viewport it is told to', async () => {
    const fake = createFakeViewer({
      initialState: {
        version: 1,
        layout: '1x2',
        viewports: [{ id: 'vp-0' }, { id: 'vp-1' }],
      },
    });
    open.push(fake);
    fake.viewer.viewports.attach('vp-1', document.createElement('div'));
    await fake.viewer.loadStudy(FAKE_IDS.study);
    const browser = document.createElement('dv-series-browser') as DvSeriesBrowserElement;
    browser.viewer = fake.viewer;
    browser.viewportId = 'vp-1';
    document.body.append(browser);
    await settle(browser);
    row(browser, FAKE_IDS.ct).click();
    await settle(browser);
    expect(
      fake.viewer.getState().viewports.find((viewport) => viewport.id === 'vp-1')
        ?.seriesInstanceUID,
    ).toBe(FAKE_IDS.ct);
  });

  it('shows a SEG as unavailable, does not draw it, and ignores a click on it', async () => {
    const { browser, fake } = await mount();
    const seg = row(browser, FAKE_IDS.seg);
    expect(seg.getAttribute('aria-disabled')).toBe('true');
    seg.click();
    await settle(browser);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBeUndefined();
    expect(fake.port.thumbnailCalls.some((call) => call.includes(FAKE_IDS.seg))).toBe(false);
  });

  it('draws a thumbnail for each picture series, at 96 pixels, and falls back to the modality', async () => {
    const { browser, fake } = await mount();
    expect(fake.port.thumbnailCalls.filter((call) => call.endsWith('@96'))).toHaveLength(2);
    expect(row(browser, FAKE_IDS.ct).querySelector('img')?.getAttribute('src')).toMatch(
      /^data:image\/fake,/,
    );
    expect(row(browser, FAKE_IDS.seg).querySelector('img')).toBeNull();
    expect(row(browser, FAKE_IDS.seg).querySelector('.thumb')?.textContent.trim()).toBe('SEG');
    // The picture is decoration: the row's name says what it is.
    expect(row(browser, FAKE_IDS.ct).querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('keeps a row usable when its thumbnail cannot be drawn', async () => {
    const fake = createFakeViewer();
    open.push(fake);
    fake.viewer.viewports.attach('vp-0', document.createElement('div'));
    await fake.viewer.loadStudy(FAKE_IDS.study);
    fake.port.failNextThumbnail();
    const browser = document.createElement('dv-series-browser') as DvSeriesBrowserElement;
    browser.viewer = fake.viewer;
    document.body.append(browser);
    await settle(browser);
    // The first picture to be drawn fails. The series with nothing to show asks the engine for none,
    // so it is the CT that has no picture.
    const failed = row(browser, FAKE_IDS.ct);
    expect(failed.querySelector('img')).toBeNull();
    expect(row(browser, FAKE_IDS.ctTwoStacks).querySelector('img')).not.toBeNull();
    failed.click();
    await settle(browser);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBe(FAKE_IDS.ct);
  });

  it('starts over for another study', async () => {
    const { browser, fake } = await mount();
    const before = fake.port.thumbnailCalls.length;
    await fake.viewer.loadStudy('1.2.4');
    await settle(browser);
    expect(fake.port.thumbnailCalls.length).toBeGreaterThan(before);
  });

  it('has one tab stop, and the arrows move between rows without choosing one', async () => {
    const { browser, fake } = await mount();
    const all = rows(browser);
    expect(all.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    all[0]?.focus();
    press(nth(all, 0), 'ArrowDown');
    expect(browser.shadowRoot?.activeElement).toBe(all[1]);
    press(nth(all, 1), 'End');
    expect(browser.shadowRoot?.activeElement).toBe(all.at(-1));
    press(nth(all, -1), 'ArrowDown');
    expect(browser.shadowRoot?.activeElement).toBe(all[0]);
    await settle(browser);
    expect(fake.viewer.getState().viewports[0]?.seriesInstanceUID).toBeUndefined();
    expect(rows(browser).filter((item) => item.tabIndex === 0)).toHaveLength(1);
  });

  it('reports a series that cannot be shown as dv-error', async () => {
    const { browser } = await mount();
    // A viewport the viewer does not have: showing a series in it fails.
    browser.viewportId = 'vp-3';
    await settle(browser);
    const errors: Error[] = [];
    browser.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error }>).detail.error);
    });
    row(browser, FAKE_IDS.ct).click();
    await settle(browser);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/no viewport vp-3/);
  });

  it('stops listening when removed', async () => {
    const { browser, fake } = await mount();
    browser.remove();
    await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
    expect(browser.shownUid).toBeUndefined();
  });
});
