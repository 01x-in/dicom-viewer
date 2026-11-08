// @vitest-environment jsdom
import { createFakeViewer, FAKE_IDS, type FakeViewer } from '@01x/dicom-viewer-core/testing';
import type { Measurement, Point3 } from '@01x/dicom-viewer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const found = list.shadowRoot?.querySelector<HTMLInputElement>('input[type="text"]');
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
    expect(row(list, 'a').getAttribute('aria-label')).toBe('Length 1, Length 5.0 mm, Slice 6');
    expect(row(list, 'b').getAttribute('aria-label')).toBe('Aorta, Length 5.0 mm, Slice 3');
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

describe('the slice of each measurement', () => {
  const slice = (list: DvMeasurementListElement, id: string): string | undefined =>
    row(list, id).querySelector('[data-slice]')?.textContent.trim();

  it('is on its row, counting from 1 as the overlay does, and in the name the row has for assistive technology', async () => {
    const { list } = await mount([length('a', 0), length('b', 6, 'Aorta')]);
    expect(slice(list, 'a')).toBe('Slice 1');
    expect(slice(list, 'b')).toBe('Slice 7');
    expect(row(list, 'b').getAttribute('aria-label')).toBe('Aorta, Length 5.0 mm, Slice 7');
  });

  it('follows a measurement added later, and says nothing for one whose series the source lacks', async () => {
    const { list, fake } = await mount([length('a', 2)]);
    await fake.viewer.measurements.add(length('b', 4));
    await settle(list);
    expect(slice(list, 'b')).toBe('Slice 5');
    await fake.viewer.measurements.importJson({
      format: 'measurements/v1',
      measurements: [
        {
          ...length('far'),
          reference: {
            studyInstanceUID: FAKE_IDS.study,
            seriesInstanceUID: '9.9.9',
            sopInstanceUID: '9.9.9.1',
          },
        },
      ],
    });
    await settle(list);
    expect(slice(list, 'far')).toBeUndefined();
    expect(row(list, 'far').getAttribute('aria-label')).not.toMatch(/Slice/);
  });

  it('uses the words the host gives', async () => {
    const { list } = await mount([length('a', 2)]);
    list.messages = { measurementSlice: 'Corte {slice}' };
    await settle(list);
    expect(slice(list, 'a')).toBe('Corte 3');
  });
});

describe('stepping between measurements', () => {
  it('shows the next one, and the one before, and picks each', async () => {
    const { list, fake } = await mount([length('a', 2), length('b', 7), length('c', 4)]);
    row(list, 'a').click();
    await settle(list);

    action(list, 'next-measurement').click();
    await settle(list);
    expect(fake.viewer.measurements.getSelected()).toBe('b');
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(7);

    action(list, 'previous-measurement').click();
    await settle(list);
    expect(fake.viewer.measurements.getSelected()).toBe('a');
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(2);
  });

  it('goes round: past the last is the first, and before the first is the last', async () => {
    const { list, fake } = await mount([length('a', 2), length('b', 7)]);
    row(list, 'b').click();
    await settle(list);
    action(list, 'next-measurement').click();
    await settle(list);
    expect(fake.viewer.measurements.getSelected()).toBe('a');
    action(list, 'previous-measurement').click();
    await settle(list);
    expect(fake.viewer.measurements.getSelected()).toBe('b');
  });

  it('starts at the first with Next, and at the last with Previous, when none is picked', async () => {
    const first = await mount([length('a', 2), length('b', 7)]);
    action(first.list, 'next-measurement').click();
    await settle(first.list);
    expect(first.fake.viewer.measurements.getSelected()).toBe('a');

    const last = await mount([length('a', 2), length('b', 7)]);
    action(last.list, 'previous-measurement').click();
    await settle(last.list);
    expect(last.fake.viewer.measurements.getSelected()).toBe('b');
  });

  it('puts the tab stop on the row it shows, so the keyboard carries on from there', async () => {
    const { list } = await mount([length('a', 2), length('b', 7)]);
    action(list, 'next-measurement').click();
    await settle(list);
    action(list, 'next-measurement').click();
    await settle(list);
    expect(rows(list).filter((item) => item.tabIndex === 0)).toEqual([row(list, 'b')]);
  });

  it('has buttons with names, and only with measurements to step through', async () => {
    const { list } = await mount([length('a', 2)]);
    expect(action(list, 'next-measurement').textContent.trim()).toBe('Next');
    expect(action(list, 'previous-measurement').textContent.trim()).toBe('Previous');
    const empty = await mount();
    expect(empty.list.shadowRoot?.querySelector('[data-action="next-measurement"]')).toBeNull();
  });

  it('uses the words the host gives', async () => {
    const { list } = await mount([length('a', 2)]);
    list.messages = { nextMeasurement: 'Siguiente', previousMeasurement: 'Anterior' };
    await settle(list);
    expect(action(list, 'next-measurement').textContent.trim()).toBe('Siguiente');
    expect(action(list, 'previous-measurement').textContent.trim()).toBe('Anterior');
  });

  it('reports a measurement that cannot be shown as dv-error', async () => {
    const { list } = await mount([length('a')]);
    list.viewportId = 'vp-3';
    await settle(list);
    const errors: Error[] = [];
    list.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error }>).detail.error);
    });
    action(list, 'next-measurement').click();
    await settle(list);
    expect(errors).toHaveLength(1);
  });
});

describe('choosing several measurements', () => {
  const box = (list: DvMeasurementListElement, id: string): HTMLElement => {
    const found = row(list, id).querySelector<HTMLElement>('[data-check]');
    if (found === null) throw new Error(`No check box for ${id}`);
    return found;
  };
  const selectAll = (list: DvMeasurementListElement): HTMLInputElement => {
    const found = list.shadowRoot?.querySelector<HTMLInputElement>('[data-action="select-all"]');
    if (found === null || found === undefined) throw new Error('No select all');
    return found;
  };
  const count = (list: DvMeasurementListElement): string | undefined =>
    list.shadowRoot?.querySelector('[data-selected-count]')?.textContent.trim();
  const checked = (list: DvMeasurementListElement): string[] =>
    rows(list)
      .filter((item) => item.getAttribute('aria-checked') === 'true')
      .map((item) => item.dataset['measurement'] ?? '');
  const toggle = async (list: DvMeasurementListElement, id: string): Promise<void> => {
    box(list, id).click();
    await settle(list);
  };

  it('has a box on each row, which the option says is checked or not, with none checked and nothing to do with them', async () => {
    const { list } = await mount([length('a', 2, 'Aorta'), length('b', 7)]);
    expect(box(list, 'a').getAttribute('aria-hidden')).toBe('true');
    expect(row(list, 'a').getAttribute('aria-checked')).toBe('false');
    expect(row(list, 'a').getAttribute('aria-keyshortcuts')).toBe('X');
    expect(checked(list)).toEqual([]);
    expect(count(list)).toBe('0 selected');
    expect(action(list, 'show-together').getAttribute('aria-disabled')).toBe('true');
    expect(action(list, 'delete-selected').getAttribute('aria-disabled')).toBe('true');
  });

  it('checks and unchecks a row without showing it: choosing is not the same as picking', async () => {
    const { list, fake } = await mount([length('a', 2), length('b', 7)]);
    await toggle(list, 'b');
    expect(checked(list)).toEqual(['b']);
    expect(count(list)).toBe('1 selected');
    expect(fake.viewer.measurements.getSelected()).toBeUndefined();
    expect(fake.viewer.getState().viewports[0]?.imageIndex).toBe(5);
    expect(action(list, 'show-together').getAttribute('aria-disabled')).toBeNull();
    await toggle(list, 'b');
    expect(checked(list)).toEqual([]);
  });

  it('checks every row with Select all, and clears them when it is used again; it is mixed when some are checked', async () => {
    const { list } = await mount([length('a', 2), length('b', 7), length('c', 4)]);
    await toggle(list, 'a');
    expect(selectAll(list).indeterminate).toBe(true);
    selectAll(list).click();
    await settle(list);
    expect(checked(list)).toEqual(['a', 'b', 'c']);
    expect(selectAll(list).checked).toBe(true);
    expect(selectAll(list).indeterminate).toBe(false);
    expect(count(list)).toBe('3 selected');
    selectAll(list).click();
    await settle(list);
    expect(checked(list)).toEqual([]);
  });

  it('is done from the keyboard too: x on a row, and Ctrl+A in the list', async () => {
    const { list } = await mount([length('a', 2), length('b', 7)]);
    press(row(list, 'b'), 'x');
    await settle(list);
    expect(checked(list)).toEqual(['b']);
    press(row(list, 'a'), 'x');
    press(row(list, 'a'), 'x');
    await settle(list);
    expect(checked(list)).toEqual(['b']);
    row(list, 'a').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await settle(list);
    expect(checked(list)).toEqual(['a', 'b']);
  });

  it('forgets a measurement that goes away', async () => {
    const { list, fake } = await mount([length('a', 2), length('b', 7)]);
    selectAll(list).click();
    await settle(list);
    await fake.viewer.measurements.remove('a');
    await settle(list);
    expect(count(list)).toBe('1 selected');
    expect(checked(list)).toEqual(['b']);
  });

  it('deletes the ones that are checked, and no other', async () => {
    const { list, fake } = await mount([length('a', 2), length('b', 7), length('c', 4)]);
    await toggle(list, 'a');
    await toggle(list, 'c');
    action(list, 'delete-selected').click();
    await settle(list);
    expect(fake.viewer.measurements.list().map((item) => item.id)).toEqual(['b']);
    expect(count(list)).toBe('0 selected');
  });

  it('does nothing with nothing checked', async () => {
    const { list, fake } = await mount([length('a', 2)]);
    action(list, 'delete-selected').click();
    action(list, 'show-together').click();
    await settle(list);
    expect(fake.viewer.measurements.list()).toHaveLength(1);
    expect(fake.viewer.getState().layout).toBe('1x1');
  });

  describe('showing them together', () => {
    const imageAt = (fake: FakeViewer, id: string): number | undefined =>
      fake.viewer.getState().viewports.find((viewport) => viewport.id === id)?.imageIndex;

    it('puts two in a row of two viewports, each on its own slice, in the order of the list', async () => {
      const { list, fake } = await mount([length('a', 2), length('b', 7), length('c', 4)]);
      await toggle(list, 'c');
      await toggle(list, 'a');
      action(list, 'show-together').click();
      await settle(list);
      expect(fake.viewer.getState().layout).toBe('1x2');
      expect(imageAt(fake, 'vp-0')).toBe(2);
      expect(imageAt(fake, 'vp-1')).toBe(4);
      // The first of them is the one that is picked.
      expect(fake.viewer.measurements.getSelected()).toBe('a');
    });

    it('uses a grid of four for three or four', async () => {
      const { list, fake } = await mount([length('a', 1), length('b', 2), length('c', 3)]);
      selectAll(list).click();
      await settle(list);
      action(list, 'show-together').click();
      await settle(list);
      expect(fake.viewer.getState().layout).toBe('2x2');
      expect([imageAt(fake, 'vp-0'), imageAt(fake, 'vp-1'), imageAt(fake, 'vp-2')]).toEqual([
        1, 2, 3,
      ]);
    });

    it('shows one where it is, without changing the layout', async () => {
      const { list, fake } = await mount([length('a', 1), length('b', 8)]);
      await toggle(list, 'b');
      action(list, 'show-together').click();
      await settle(list);
      expect(fake.viewer.getState().layout).toBe('1x1');
      expect(imageAt(fake, 'vp-0')).toBe(8);
      expect(fake.viewer.measurements.getSelected()).toBe('b');
    });

    it('shows the first four of more, and says so', async () => {
      const five = [0, 1, 2, 3, 4].map((at) => length(`m${at.toString()}`, at));
      const { list, fake } = await mount(five);
      selectAll(list).click();
      await settle(list);
      action(list, 'show-together').click();
      await settle(list);
      expect(fake.viewer.getState().layout).toBe('2x2');
      expect([0, 1, 2, 3].map((at) => imageAt(fake, `vp-${at.toString()}`))).toEqual([0, 1, 2, 3]);
      const status = list.shadowRoot?.querySelector('[data-selection-status]');
      expect(status?.textContent.trim()).toBe('Showing the first 4 of 5 selected.');
    });

    it('reports what cannot be shown as dv-error', async () => {
      const { list, fake } = await mount([length('a', 1), length('b', 2)]);
      // No viewport is attached for vp-1, and the layout cannot be changed after the viewer is gone.
      selectAll(list).click();
      await settle(list);
      const errors: Error[] = [];
      list.addEventListener('dv-error', (event) => {
        errors.push((event as CustomEvent<{ error: Error }>).detail.error);
      });
      fake.viewer.destroy();
      action(list, 'show-together').click();
      await settle(list);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it('uses the words the host gives', async () => {
    const { list } = await mount([length('a', 2)]);
    list.messages = {
      selectAll: 'Elegir todo',
      selectedCount: '{count} elegidas',
      showTogether: 'Mostrar juntas',
      deleteSelected: 'Eliminar las elegidas',
    };
    await settle(list);
    expect(selectAll(list).getAttribute('aria-label')).toBe('Elegir todo');
    expect(count(list)).toBe('0 elegidas');
    expect(action(list, 'show-together').textContent.trim()).toBe('Mostrar juntas');
    expect(action(list, 'delete-selected').textContent.trim()).toBe('Eliminar las elegidas');
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
    expect(list.shadowRoot?.querySelector('input[type="text"]')).toBeNull();
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
    expect(list.shadowRoot?.querySelector('input[type="text"]')).toBeNull();
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
    expect(list.shadowRoot?.querySelector('input[type="text"]')).toBeNull();
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

const reportSelect = (list: DvMeasurementListElement): HTMLSelectElement | null =>
  list.shadowRoot?.querySelector<HTMLSelectElement>('[data-action="load-report"]') ?? null;
const reportStatus = (list: DvMeasurementListElement): string =>
  list.shadowRoot?.querySelector('[data-report-status]')?.textContent.replace(/\s+/g, ' ').trim() ??
  '';

async function choose(list: DvMeasurementListElement, value: string): Promise<void> {
  const select = reportSelect(list);
  if (select === null) throw new Error('No Load report control');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(list);
}

describe('loading a report', () => {
  it('lists the SR series of the study in a control with a name, and says nothing is chosen', async () => {
    const { list } = await mount();
    const select = reportSelect(list);
    expect(select?.getAttribute('aria-label')).toBe('Load report');
    const options = [...(select?.options ?? [])].map((option) => [option.value, option.text]);
    expect(options[0]).toEqual(['', 'Load report…']);
    expect(options.map(([value]) => value)).toContain(FAKE_IDS.sr);
    expect(options.map(([value]) => value)).not.toContain(FAKE_IDS.ct);
    expect(options.map(([value]) => value)).not.toContain(FAKE_IDS.seg);
  });

  it('has no control when the study has no report', async () => {
    const { list, fake } = await mount();
    await fake.viewer.loadStudy('1.2.5');
    await settle(list);
    expect(reportSelect(list)).toBeNull();
  });

  it('keeps the shapes of the report as measurements, and says how many', async () => {
    const { list, fake } = await mount();
    await choose(list, FAKE_IDS.sr);
    expect(fake.viewer.measurements.list()).toHaveLength(2);
    expect(rows(list)).toHaveLength(2);
    expect(reportStatus(list)).toBe('Report loaded: 2 added, 0 replaced.');
    // The control says which report it is.
    expect(reportSelect(list)?.value).toBe(FAKE_IDS.sr);
    expect(reportSelect(list)?.selectedOptions[0]?.text.trim()).toBe(`SR ${FAKE_IDS.sr}`);
  });

  it('shows the prompt again when the prompt is chosen, with the report still loaded', async () => {
    const { list, fake } = await mount();
    await choose(list, FAKE_IDS.sr);
    await choose(list, '');
    expect(reportSelect(list)?.value).toBe(FAKE_IDS.sr);
    expect(fake.viewer.measurements.list()).toHaveLength(2);
  });

  it('goes back to the prompt when the report cannot be loaded', async () => {
    const { list } = await mount();
    await choose(list, FAKE_IDS.srNotAReport);
    expect(reportSelect(list)?.value).toBe('');
  });

  it('goes back to the prompt when the study changes', async () => {
    const { list, fake } = await mount();
    await choose(list, FAKE_IDS.sr);
    await fake.viewer.loadStudy('1.2.5');
    await fake.viewer.loadStudy(FAKE_IDS.study);
    await settle(list);
    expect(reportSelect(list)?.value).toBe('');
  });

  it('says what it left out, and why', async () => {
    const { list, fake } = await mount();
    fake.port.reportResult = { shapes: [], unreadable: 2, unsupported: ['ArrowAnnotate'] };
    await choose(list, FAKE_IDS.sr);
    expect(reportStatus(list)).toContain('No measurements were added.');
    expect(reportStatus(list)).toContain('The reader could not read the shape. (2)');
    expect(reportStatus(list)).toContain(
      'The viewer has no place for this kind of shape (ArrowAnnotate). (1)',
    );
  });

  it('reports a report that cannot be loaded as dv-error, and says so', async () => {
    const { list } = await mount();
    const errors: { error: Error; context: string }[] = [];
    list.addEventListener('dv-error', (event) => {
      errors.push((event as CustomEvent<{ error: Error; context: string }>).detail);
    });
    await choose(list, FAKE_IDS.srNotAReport);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('measurement');
    expect(reportStatus(list)).toContain('The report could not be loaded');
    expect(reportStatus(list)).toContain('not a TID 1500 measurement report');
  });

  it('ignores the answer to a request made through a viewer that was replaced', async () => {
    const { list } = await mount();
    const other = createFakeViewer();
    open.push(other);
    await other.viewer.loadStudy(FAKE_IDS.study);
    const select = reportSelect(list);
    if (select === null) throw new Error('No Load report control');
    select.value = FAKE_IDS.sr;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // The old viewer's request is on its way when the list is given another viewer.
    list.viewer = other.viewer;
    await settle(list);
    await settle(list);
    expect(reportStatus(list)).toBe('');
    expect(reportSelect(list)?.disabled).toBe(false);
    expect(other.viewer.measurements.list()).toEqual([]);
  });

  it('forgets the message when another study is loaded', async () => {
    const { list, fake } = await mount();
    await choose(list, FAKE_IDS.sr);
    expect(reportStatus(list)).not.toBe('');
    await fake.viewer.loadStudy('1.2.4');
    await settle(list);
    expect(reportStatus(list)).toBe('');
  });
});

describe('the PDF button', () => {
  it('is there with no measurements, and can not be used', async () => {
    const { list } = await mount();
    const button = action(list, 'download-pdf');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.textContent.trim()).toBe('Download PDF');
  });

  it('can be used when there are measurements, and saves the report', async () => {
    const { list } = await mount([length('a')]);
    const button = action(list, 'download-pdf');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    const made: Blob[] = [];
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      if (blob instanceof Blob) made.push(blob);
      return 'blob:fake';
    };
    URL.revokeObjectURL = (): void => undefined;
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    try {
      button.click();
      await vi.waitFor(() => {
        expect(names).toEqual(['measurement-report.pdf']);
      });
    } finally {
      click.mockRestore();
    }
    expect(made[0]?.type).toBe('application/pdf');
  });

  it('does nothing when it can not be used', async () => {
    const { list } = await mount();
    const errors: unknown[] = [];
    list.addEventListener('dv-error', (event) => errors.push(event));
    action(list, 'download-pdf').click();
    await settle(list);
    expect(errors).toEqual([]);
  });
});
