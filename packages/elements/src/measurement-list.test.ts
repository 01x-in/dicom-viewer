// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@01x/dicom-viewer-core/testing';
import type { Measurement, Point3 } from '@01x/dicom-viewer-core';
import { afterEach, describe, expect, it } from 'vitest';
import './define';
import { measurementName } from './index';
import type { DvMeasurementListElement } from './measurement-list';

const open: FakeViewer[] = [];

afterEach(() => {
  document.body.replaceChildren();
  for (const fake of open.splice(0)) fake.viewer.destroy();
});

const settle = async (element: DvMeasurementListElement): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
};

const p = (x: number, y: number): Point3 => [x, y, 0];

const reference = (index: number): Measurement['reference'] => ({
  studyInstanceUID: FAKE_IDS.study,
  seriesInstanceUID: FAKE_IDS.ct,
  sopInstanceUID: `${FAKE_IDS.ct}.0.${index.toString()}`,
});

const length = (id: string, index = 5, label?: string): Measurement => ({
  id,
  type: 'length',
  reference: reference(index),
  points: [p(0, 0), p(3, 4)],
  ...(label === undefined ? {} : { label }),
});

async function mount(
  measurements: readonly Measurement[] = [],
): Promise<{ list: DvMeasurementListElement; fake: FakeViewer }> {
  const fake = createFakeViewer();
  open.push(fake);
  fake.viewer.viewports.attach('vp-0', document.createElement('div'));
  await fake.viewer.loadStudy(FAKE_IDS.study);
  await fake.viewer.setViewportSeries('vp-0', FAKE_IDS.ct);
  for (const measurement of measurements) await fake.viewer.measurements.add(measurement);
  const list = document.createElement('dv-measurement-list') as DvMeasurementListElement;
  list.viewer = fake.viewer;
  document.body.append(list);
  await settle(list);
  return { list, fake };
}

const rows = (list: DvMeasurementListElement): HTMLElement[] => [
  ...(list.shadowRoot?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
];
const row = (list: DvMeasurementListElement, id: string): HTMLElement => {
  const found = rows(list).find((item) => item.dataset['measurement'] === id);
  if (found === undefined) throw new Error(`No row for ${id}`);
  return found;
};
const action = (list: DvMeasurementListElement, name: string): HTMLButtonElement => {
  const found = list.shadowRoot?.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);
  if (found === null || found === undefined) throw new Error(`No ${name} button`);
  return found;
};
const press = (element: HTMLElement, key: string): void => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};
const input = (list: DvMeasurementListElement): HTMLInputElement => {
  const found = list.shadowRoot?.querySelector<HTMLInputElement>('input');
  if (found === null || found === undefined) throw new Error('No input');
  return found;
};

describe('measurementName', () => {
  it('is the label, or the kind and its number among those of the kind', () => {
    const a = length('a');
    const b = length('b');
    const c: Measurement = { id: 'c', type: 'probe', reference: reference(1), points: [p(0, 0)] };
    const all = [a, c, b];
    expect(measurementName(a, all)).toBe('Length 1');
    expect(measurementName(b, all)).toBe('Length 2');
    expect(measurementName(c, all)).toBe('Probe 1');
    expect(measurementName({ ...b, label: 'Aorta' }, all)).toBe('Aorta');
  });
});

describe('<dv-measurement-list>', () => {
  it('says there are none, and how to make one', async () => {
    const { list } = await mount();
    const status = list.shadowRoot?.querySelector('[role="status"]');
    expect(status?.textContent).toMatch(/No measurements yet/);
    expect(list.shadowRoot?.querySelector('[role="listbox"]')).toBeNull();
  });

  it('lists the measurements as options of a named listbox, with what they measure', async () => {
    const { list } = await mount([length('a'), length('b', 2, 'Aorta')]);
    expect(list.shadowRoot?.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe(
      'Measurements',
    );
    expect(rows(list)).toHaveLength(2);
    expect(row(list, 'a').getAttribute('aria-label')).toBe('Length 1, Length 5.0 mm');
    expect(row(list, 'b').getAttribute('aria-label')).toBe('Aorta, Length 5.0 mm');
    expect(row(list, 'b').textContent).toContain('Aorta');
  });

  it('shows only the measurements of the study on screen', async () => {
    const { list } = await mount([
      length('a'),
      { ...length('other'), reference: { ...reference(1), studyInstanceUID: '9.9' } },
    ]);
    expect(rows(list).map((item) => item.dataset['measurement'])).toEqual(['a']);
  });

  it('follows measurements added, changed, and removed elsewhere', async () => {
    const { list, fake } = await mount();
    await fake.viewer.measurements.add(length('a'));
    await settle(list);
    expect(rows(list)).toHaveLength(1);

    await fake.viewer.measurements.update('a', { label: 'Aorta' });
    await settle(list);
    expect(row(list, 'a').textContent).toContain('Aorta');

    await fake.viewer.measurements.remove('a');
    await settle(list);
    expect(rows(list)).toHaveLength(0);
  });

  it('starts over for another study', async () => {
    const { list, fake } = await mount([length('a')]);
    await fake.viewer.loadStudy('1.2.4');
    await settle(list);
    expect(rows(list)).toHaveLength(0);
  });

  it('marks the picked measurement, and follows a pick made on the image', async () => {
    const { list, fake } = await mount([length('a'), length('b')]);
    expect(rows(list).every((item) => item.getAttribute('aria-selected') === 'false')).toBe(true);
    await fake.viewer.measurements.select('b');
    await settle(list);
    expect(row(list, 'b').getAttribute('aria-selected')).toBe('true');
    expect(row(list, 'a').getAttribute('aria-selected')).toBe('false');
    // The tab stop is on the picked one.
    expect(row(list, 'b').tabIndex).toBe(0);
    expect(row(list, 'a').tabIndex).toBe(-1);
    await fake.viewer.measurements.select(undefined);
    await settle(list);
    expect(rows(list).every((item) => item.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('shows the image a measurement is on, and picks it, when its row is clicked or Enter or Space is pressed', async () => {
    const { list, fake } = await mount([length('a', 2), length('b', 7)]);
    row(list, 'a').click();
    await settle(list);
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(2);
    expect(fake.viewer.measurements.getSelected()).toBe('a');

    press(row(list, 'b'), 'Enter');
    await settle(list);
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(7);
    expect(fake.viewer.measurements.getSelected()).toBe('b');

    press(row(list, 'a'), ' ');
    await settle(list);
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(2);
  });

  it('jumps in the viewport it is told to', async () => {
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
    await fake.viewer.measurements.add(length('a', 3));
    const list = document.createElement('dv-measurement-list') as DvMeasurementListElement;
    list.viewer = fake.viewer;
    list.viewportId = 'vp-1';
    document.body.append(list);
    await settle(list);
    row(list, 'a').click();
    await settle(list);
    expect(
      fake.viewer.getState().viewports.find((viewport) => viewport.id === 'vp-1'),
    ).toMatchObject({ seriesInstanceUID: FAKE_IDS.ct, imageIndex: 3 });
  });

  it('has one tab stop, and the arrows move between rows without choosing one', async () => {
    const { list, fake } = await mount([length('a'), length('b'), length('c')]);
    const all = rows(list);
    expect(all.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    all[0]?.focus();
    press(row(list, 'a'), 'ArrowDown');
    expect(list.shadowRoot?.activeElement).toBe(row(list, 'b'));
    press(row(list, 'b'), 'End');
    expect(list.shadowRoot?.activeElement).toBe(row(list, 'c'));
    press(row(list, 'c'), 'ArrowDown');
    expect(list.shadowRoot?.activeElement).toBe(row(list, 'a'));
    await settle(list);
    expect(fake.viewer.measurements.getSelected()).toBeUndefined();
    expect(rows(list).filter((item) => item.tabIndex === 0)).toHaveLength(1);
  });

  it('reports a measurement that cannot be shown as dv-error', async () => {
    const { list, fake } = await mount([length('a')]);
    // A viewport the viewer does not have: showing the image fails.
    list.viewportId = 'vp-3';
    await settle(list);
    const errors: { error: Error; context: string }[] = [];
    list.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error; context: string }>).detail);
    });
    row(list, 'a').click();
    await settle(list);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('measurement');
    expect(errors[0]?.error.message).toMatch(/no viewport vp-3/);
    expect(fake.viewer.measurements.getSelected()).toBeUndefined();
  });
});

describe('deleting', () => {
  it('removes the measurement that has the focus, with the Delete button, and the Delete and Backspace keys', async () => {
    const { list, fake } = await mount([length('a'), length('b'), length('c')]);
    row(list, 'b').focus();
    action(list, 'delete').click();
    await settle(list);
    expect(fake.viewer.measurements.list().map((item) => item.id)).toEqual(['a', 'c']);

    press(row(list, 'a'), 'Delete');
    await settle(list);
    expect(fake.viewer.measurements.list().map((item) => item.id)).toEqual(['c']);

    press(row(list, 'c'), 'Backspace');
    await settle(list);
    expect(fake.viewer.measurements.list()).toEqual([]);
    expect(list.shadowRoot?.querySelector('[role="status"]')).not.toBeNull();
  });

  it('keeps the keyboard in the list: the row that took its place has the focus', async () => {
    const { list } = await mount([length('a'), length('b'), length('c')]);
    row(list, 'a').focus();
    press(row(list, 'a'), 'Delete');
    await settle(list);
    expect(list.shadowRoot?.activeElement).toBe(row(list, 'b'));
  });

  it('puts the focus on the last row when the last row was deleted', async () => {
    const { list } = await mount([length('a'), length('b')]);
    row(list, 'b').focus();
    press(row(list, 'b'), 'Delete');
    await settle(list);
    expect(list.shadowRoot?.activeElement).toBe(row(list, 'a'));
  });
});

describe('renaming', () => {
  it('names the measurement that has the focus: the button opens a field, and Enter saves', async () => {
    const { list, fake } = await mount([length('a'), length('b')]);
    row(list, 'b').focus();
    action(list, 'rename').click();
    await settle(list);
    expect(list.shadowRoot?.activeElement).toBe(input(list));
    input(list).value = '  Aorta ';
    input(list).form?.requestSubmit();
    await settle(list);
    expect(fake.viewer.measurements.get('b')?.label).toBe('Aorta');
    expect(list.shadowRoot?.querySelector('input')).toBeNull();
    // The focus is back on the row.
    expect(list.shadowRoot?.activeElement).toBe(row(list, 'b'));
    expect(row(list, 'b').textContent).toContain('Aorta');
  });

  it('opens from F2 and from a double click, starting from the name it has', async () => {
    const { list } = await mount([length('a', 5, 'Aorta'), length('b')]);
    press(row(list, 'a'), 'F2');
    await settle(list);
    expect(input(list).value).toBe('Aorta');
    row(list, 'b').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle(list);
    // The field is for the row that was asked about, not the one that was open.
    expect(input(list).value).toBe('Length 2');
  });

  it('is left with Escape or Cancel, and changes nothing', async () => {
    const { list, fake } = await mount([length('a', 5, 'Aorta')]);
    press(row(list, 'a'), 'F2');
    await settle(list);
    input(list).value = 'Something else';
    input(list).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(list);
    expect(list.shadowRoot?.querySelector('input')).toBeNull();
    expect(fake.viewer.measurements.get('a')?.label).toBe('Aorta');

    press(row(list, 'a'), 'F2');
    await settle(list);
    input(list).value = 'Other';
    list.shadowRoot?.querySelector<HTMLButtonElement>('button[type="button"]')?.click();
    await settle(list);
    expect(fake.viewer.measurements.get('a')?.label).toBe('Aorta');
  });

  it('takes the name away when the field is emptied', async () => {
    const { list, fake } = await mount([length('a', 5, 'Aorta')]);
    press(row(list, 'a'), 'F2');
    await settle(list);
    input(list).value = '';
    input(list).form?.requestSubmit();
    await settle(list);
    expect(fake.viewer.measurements.get('a')?.label).toBeUndefined();
    expect(row(list, 'a').textContent).toContain('Length 1');
  });

  it('limits the name to what a measurement can hold', async () => {
    const { list } = await mount([length('a')]);
    press(row(list, 'a'), 'F2');
    await settle(list);
    expect(input(list).maxLength).toBe(200);
  });

  it('closes when the measurement goes away', async () => {
    const { list, fake } = await mount([length('a')]);
    press(row(list, 'a'), 'F2');
    await settle(list);
    await fake.viewer.measurements.remove('a');
    await settle(list);
    expect(list.shadowRoot?.querySelector('input')).toBeNull();
  });
});

describe('when it is removed', () => {
  it('stops listening to the viewer', async () => {
    const { list, fake } = await mount([length('a')]);
    list.remove();
    await fake.viewer.measurements.add(length('b'));
    expect(list.items.map((item) => item.id)).toEqual(['a']);
  });
});
