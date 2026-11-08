// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewMeasurement } from './measurements/registry';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NEW_REPORT = '1.2.3.99';
const sop = (index: number): string => `${CT}.0.${index.toString()}`;

const length = (id: string, index: number, label?: string): NewMeasurement => ({
  id,
  type: 'length',
  ...(label === undefined ? {} : { label }),
  reference: { studyInstanceUID: STUDY, seriesInstanceUID: CT, sopInstanceUID: sop(index) },
  points: [
    [0, 0, 0],
    [3, 4, 0],
  ],
});

const probe = (id: string, index: number): NewMeasurement => ({
  id,
  type: 'probe',
  reference: { studyInstanceUID: STUDY, seriesInstanceUID: CT, sopInstanceUID: sop(index) },
  points: [[1, 2, 0]],
});

async function ready(h: Harness): Promise<void> {
  await h.viewer.loadStudy(STUDY);
}

describe('measurements.exportSr', () => {
  it('makes a DICOM file of the measurements of the study on screen, and hands the engine them in the order of the list, with their numbers', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('b', 7, 'Aorta'));
    await h.viewer.measurements.add(probe('a', 2));

    const blob = await h.viewer.measurements.exportSr();

    expect(blob.type).toBe('application/dicom');
    expect(blob.size).toBeGreaterThan(0);
    expect(h.port.reportWrites).toHaveLength(1);
    const [written] = h.port.reportWrites;
    expect(written?.measurements.map((m) => [m.id, m.type, m.label, m.sopInstanceUID])).toEqual([
      ['b', 'length', 'Aorta', sop(7)],
      ['a', 'probe', undefined, sop(2)],
    ]);
    expect(written?.measurements[0]?.values.lengthMm).toBeCloseTo(5, 5);
    expect(written?.measurements[0]?.points).toEqual([
      [0, 0, 0],
      [3, 4, 0],
    ]);
  });

  it('gives the engine the images the measurements are on, each once', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    await h.viewer.measurements.add(length('b', 2));
    await h.viewer.measurements.add(length('c', 5));
    await h.viewer.measurements.exportSr();
    expect(h.port.reportWrites[0]?.instances.map((i) => i.sopInstanceUID).sort()).toEqual(
      [sop(2), sop(5)].sort(),
    );
  });

  it('is a series of its own: the default description and number, or what the host gives, and a new UID each time', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    await h.viewer.measurements.exportSr();
    await h.viewer.measurements.exportSr({ seriesDescription: 'Follow-up', seriesNumber: 61 });
    const [first, second] = h.port.reportWrites;
    expect([first?.seriesDescription, first?.seriesNumber]).toEqual(['Measurements', 60]);
    expect([second?.seriesDescription, second?.seriesNumber]).toEqual(['Follow-up', 61]);
    expect(first?.seriesInstanceUID).toMatch(/^2\.25\.\d{1,39}$/);
    expect(first?.sopInstanceUID).toMatch(/^2\.25\.\d{1,39}$/);
    expect(first?.seriesInstanceUID).not.toBe(second?.seriesInstanceUID);
    expect(first?.sopInstanceUID).not.toBe(first?.seriesInstanceUID);
  });

  it('writes the time of the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 8, 9, 14, 5)));
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    await h.viewer.measurements.exportSr();
    expect(h.port.reportWrites[0]?.madeAt.toISOString()).toBe('2026-11-08T09:14:05.000Z');
  });

  it('refuses a description longer than a series description can be, and a number that is not a whole number from 0', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    await expect(
      h.viewer.measurements.exportSr({ seriesDescription: 'x'.repeat(65) }),
    ).rejects.toThrow(RangeError);
    await expect(
      h.viewer.measurements.exportSr({ seriesDescription: 'x'.repeat(64) }),
    ).resolves.toBeInstanceOf(Blob);
    for (const seriesNumber of [-1, 1.5, Number.NaN]) {
      await expect(h.viewer.measurements.exportSr({ seriesNumber })).rejects.toThrow(RangeError);
    }
  });

  it('rejects with nothing to write, before a study is loaded, and after destroy', async () => {
    const h = harness();
    await expect(h.viewer.measurements.exportSr()).rejects.toThrow(/Load a study first/);
    await ready(h);
    await expect(h.viewer.measurements.exportSr()).rejects.toThrow(/no measurements/);
    await h.viewer.measurements.add(length('a', 2));
    h.viewer.destroy();
    await expect(h.viewer.measurements.exportSr()).rejects.toThrow();
  });

  it('rejects, and says why, for a measurement on a series the source does not have: a report cannot refer to an image it cannot name', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    await h.viewer.measurements.importJson({
      format: 'measurements/v1',
      measurements: [
        {
          id: 'far',
          type: 'length',
          reference: {
            studyInstanceUID: STUDY,
            seriesInstanceUID: '9.9.9',
            sopInstanceUID: '9.9.9.1',
          },
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
        },
      ],
    });
    await expect(h.viewer.measurements.exportSr()).rejects.toThrow(/1 measurement/);
    expect(h.port.reportWrites).toEqual([]);
  });

  it('rejects when the engine fails, and changes nothing', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    h.port.failNextReportWrite();
    await expect(h.viewer.measurements.exportSr()).rejects.toThrow(/could not be written/);
    expect(h.viewer.measurements.list()).toHaveLength(1);
    await expect(h.viewer.measurements.exportSr()).resolves.toBeInstanceOf(Blob);
  });

  it('comes after the calls made before it, as every change does', async () => {
    const h = harness();
    await ready(h);
    const adding = h.viewer.measurements.add(length('a', 2));
    const exporting = h.viewer.measurements.exportSr();
    await adding;
    await exporting;
    expect(h.port.reportWrites[0]?.measurements.map((m) => m.id)).toEqual(['a']);
  });

  it('is read back by the viewer: the same shapes, with their labels, on the same images', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2, 'Aorta'));
    await h.viewer.measurements.add(probe('b', 5));
    const before = h.viewer.measurements.list().map((m) => ({
      type: m.type,
      label: m.label,
      points: m.points,
      sop: m.reference.sopInstanceUID,
    }));
    const blob = await h.viewer.measurements.exportSr();

    h.source.addReport(NEW_REPORT, await blob.arrayBuffer());
    await h.viewer.loadStudy(STUDY);
    await h.viewer.measurements.clear();
    const result = await h.viewer.measurements.loadSr(NEW_REPORT);

    expect(result).toMatchObject({ added: 2, replaced: 0, skipped: [] });
    expect(
      h.viewer.measurements.list().map((m) => ({
        type: m.type,
        label: m.label,
        points: m.points,
        sop: m.reference.sopInstanceUID,
      })),
    ).toEqual(before);
  });

  it('writes again a measurement that came from a report', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.loadSr('1.2.3.20');
    const count = h.viewer.measurements.list().length;
    expect(count).toBeGreaterThan(0);
    await h.viewer.measurements.exportSr();
    expect(h.port.reportWrites[0]?.measurements).toHaveLength(count);
  });
});

describe('the measurements.downloadSr command', () => {
  it('is there, takes no arguments, and can run only when there is something to write', async () => {
    const h = harness();
    expect(h.viewer.commands.has('measurements.downloadSr')).toBe(true);
    expect(h.viewer.commands.check('measurements.downloadSr')).toBeUndefined();
    expect(h.viewer.commands.check('measurements.downloadSr', { x: 1 })).toMatch(/does not take/);
    expect(h.viewer.commands.enabled('measurements.downloadSr')).toBe(false);
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    expect(h.viewer.commands.enabled('measurements.downloadSr')).toBe(true);
  });

  it('saves the report as measurements.dcm', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 2));
    const made: Blob[] = [];
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      if (blob instanceof Blob) made.push(blob);
      return 'blob:fake';
    };
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });

    await h.viewer.commands.run('measurements.downloadSr');

    expect(names).toEqual(['measurements.dcm']);
    expect(made[0]?.type).toBe('application/dicom');
  });
});
