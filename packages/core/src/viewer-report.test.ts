// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewMeasurement } from './measurements/registry';
import { CT, SR, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();
afterEach(() => {
  vi.restoreAllMocks();
});

const length = (id: string, index: number): NewMeasurement => ({
  id,
  type: 'length',
  reference: {
    studyInstanceUID: STUDY,
    seriesInstanceUID: CT,
    sopInstanceUID: `${CT}.0.${index.toString()}`,
  },
  points: [
    [0, 0, 0],
    [3, 4, 0],
  ],
});

async function ready(h: Harness): Promise<void> {
  await h.viewer.loadStudy(STUDY);
}

function read(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = (): void => {
      reject(new Error('The file could not be read.'));
    };
    reader.readAsText(blob, 'latin1');
  });
}

describe('measurements.exportPdf', () => {
  it('makes a PDF of the measurements of the study on screen', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 4));
    await h.viewer.measurements.add({ ...length('b', 7), label: 'Aorta' });

    const blob = await h.viewer.measurements.exportPdf();
    const pdf = await read(blob);

    expect(blob.type).toBe('application/pdf');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    for (const expected of [
      'Measurement report',
      'Length 1',
      'Aorta',
      'Length 5.0 mm',
      'CT, CT',
      'Not for diagnosis',
    ]) {
      expect(pdf).toContain(expected);
    }
    // The fifth and the eighth slice of the series.
    expect(pdf).toContain('(5)');
    expect(pdf).toContain('(8)');
  });

  it('uses the title a host gives', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 0));
    const pdf = await read(await h.viewer.measurements.exportPdf({ title: 'Follow-up 2' }));
    expect(pdf).toContain('(Follow-up 2)');
  });

  it('says how each measurement came to be', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await ready(h);
    await h.viewer.setViewportSeries('vp-0', CT);
    await h.viewer.measurements.add(length('by-code', 0));
    await h.viewer.measurements.loadSr(SR);
    h.port.stacks[0]?.emitMeasurement({
      kind: 'completed',
      measurement: {
        id: 'by-hand',
        type: 'length',
        imageIndex: 2,
        points: [
          [0, 0, 5],
          [1, 0, 5],
        ],
      },
    });

    const pdf = await read(await h.viewer.measurements.exportPdf());
    expect(pdf).toContain('(API)');
    expect(pdf).toContain('(Imported)');
    expect(pdf).toContain('(Drawn)');
  });

  it('leaves out who the patient is, unless the viewer is set to show it', async () => {
    const hidden = harness();
    await ready(hidden);
    await hidden.viewer.measurements.add(length('a', 0));
    const without = await read(await hidden.viewer.measurements.exportPdf());
    expect(without).not.toContain('DOE');
    expect(without).not.toContain('ID-7');
    expect(without).not.toContain('Patient');

    const shown = harness({ viewer: { overlay: { showPatientInfo: true } } });
    await ready(shown);
    await shown.viewer.measurements.add(length('a', 0));
    const withInfo = await read(await shown.viewer.measurements.exportPdf());
    expect(withInfo).toContain('(Patient: DOE JANE)');
    expect(withInfo).toContain('(Patient ID: ID-7)');
  });

  it('keeps the measurements of another study out of it', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('here', 0));
    await h.viewer.measurements.add({
      ...length('elsewhere', 0),
      label: 'Other study',
      reference: { ...length('x', 0).reference, studyInstanceUID: '9.9.9' },
    });
    const pdf = await read(await h.viewer.measurements.exportPdf());
    expect(pdf).not.toContain('Other study');
  });

  it('rejects when there is nothing to put in it', async () => {
    const h = harness();
    await ready(h);
    await expect(h.viewer.measurements.exportPdf()).rejects.toThrow(RangeError);
    await expect(h.viewer.measurements.exportPdf()).rejects.toThrow(/no measurements/);
  });

  it('rejects before a study is loaded', async () => {
    const h = harness();
    await expect(h.viewer.measurements.exportPdf()).rejects.toThrow(/Load a study first/);
  });
});

describe('the measurements.downloadPdf command', () => {
  it('is there, and can run only when there is something to put in the report', async () => {
    const h = harness();
    expect(h.viewer.commands.has('measurements.downloadPdf')).toBe(true);
    expect(h.viewer.commands.enabled('measurements.downloadPdf')).toBe(false);
    await ready(h);
    expect(h.viewer.commands.enabled('measurements.downloadPdf')).toBe(false);
    await h.viewer.measurements.add(length('a', 0));
    expect(h.viewer.commands.enabled('measurements.downloadPdf')).toBe(true);
    await h.viewer.measurements.clear();
    expect(h.viewer.commands.enabled('measurements.downloadPdf')).toBe(false);
  });

  it('takes no arguments', () => {
    const h = harness();
    expect(h.viewer.commands.check('measurements.downloadPdf')).toBeUndefined();
    expect(h.viewer.commands.check('measurements.downloadPdf', { x: 1 })).toMatch(/does not take/);
  });

  it('saves the report as a file', async () => {
    const h = harness();
    await ready(h);
    await h.viewer.measurements.add(length('a', 0));
    const made: Blob[] = [];
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      if (blob instanceof Blob) made.push(blob);
      return 'blob:fake';
    };
    const revoked = vi.fn();
    URL.revokeObjectURL = revoked;
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });

    await h.viewer.commands.run('measurements.downloadPdf');

    expect(names).toEqual(['measurement-report.pdf']);
    expect(made).toHaveLength(1);
    expect(made[0]?.type).toBe('application/pdf');
    expect(revoked).toHaveBeenCalledWith('blob:fake');
  });
});
