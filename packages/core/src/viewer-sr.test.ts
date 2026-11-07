// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { srMeasurementId } from './measurements/sr';
import { CT, SR, SR_NOT_A_REPORT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';

destroyViewersAfterEach();

/** The SOP instance of the one instance of the fake report. */
const SR_SOP = `${SR}.0.0`;
const CT_FIRST = `${CT}.0.0`;
const CT_FOURTH = `${CT}.0.3`;

async function show(h: Harness): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT);
}

describe('measurements.loadSr', () => {
  it('reads the report against the series it names, and keeps its shapes as measurements', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);

    const result = await h.viewer.measurements.loadSr(SR);

    expect(result.added).toBe(2);
    expect(result.replaced).toBe(0);
    expect(h.viewer.measurements.list().map((m) => [m.id, m.type, m.label])).toEqual([
      [srMeasurementId(SR_SOP, 0), 'length', 'Aorta'],
      [srMeasurementId(SR_SOP, 1), 'probe', undefined],
    ]);
    expect(h.viewer.measurements.list()[0]?.reference).toEqual({
      studyInstanceUID: STUDY,
      seriesInstanceUID: CT,
      sopInstanceUID: CT_FIRST,
      frameOfReferenceUID: '1.2.3.77',
    });
    expect(h.viewer.measurements.list()[1]?.reference.sopInstanceUID).toBe(CT_FOURTH);
    expect(h.source.calls).toContain(`getInstanceBytes ${SR} SR`);
  });

  it('gives the engine every instance of the series the report names, and reads the bytes of the report', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    await h.viewer.measurements.loadSr(SR);

    expect(h.port.reportReads).toHaveLength(1);
    const [read] = h.port.reportReads;
    expect(read?.sopInstanceUIDs).toHaveLength(10);
    expect(read?.sopInstanceUIDs[0]).toBe(CT_FIRST);
    expect(read?.report).toBe(SR);
  });

  it('says that the measurements came from an import', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    await h.viewer.measurements.loadSr(SR);
    expect(h.events['measurement:added'].map((event) => event.origin)).toEqual([
      'import',
      'import',
    ]);
  });

  it('counts what it could not keep, with the reason', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    h.port.reportResult = {
      shapes: [
        {
          type: 'length',
          points: [
            [0, 0, 0],
            [3, 4, 0],
          ],
          sopInstanceUID: CT_FIRST,
          position: 0,
        },
        {
          type: 'length',
          points: [
            [0, 0, 0],
            [3, 4, 0],
          ],
          sopInstanceUID: '9.9.9',
          position: 1,
        },
      ],
      unreadable: 1,
      unsupported: ['ArrowAnnotate'],
    };

    const result = await h.viewer.measurements.loadSr(SR);

    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([
      { reason: 'The report refers to an image that is not in this study.', count: 1 },
      { reason: 'The reader could not read the shape.', count: 1 },
      {
        reason: 'The viewer has no place for this kind of shape (ArrowAnnotate).',
        count: 1,
      },
    ]);
  });

  it('replaces what an earlier load of the same report made, instead of adding it again', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    await h.viewer.measurements.loadSr(SR);
    const result = await h.viewer.measurements.loadSr(SR);

    expect(result).toMatchObject({ added: 0, replaced: 2 });
    expect(h.viewer.measurements.list()).toHaveLength(2);
  });

  it('does not replace a measurement that something else made with the id of a shape, and counts the shape as left out', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    const id = srMeasurementId(SR_SOP, 0);
    await h.viewer.measurements.add({
      id,
      type: 'length',
      label: 'Mine',
      reference: { studyInstanceUID: STUDY, seriesInstanceUID: CT, sopInstanceUID: CT_FIRST },
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    const result = await h.viewer.measurements.loadSr(SR);
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([
      {
        reason:
          'A measurement that was not made by loading a report already has the id of this shape.',
        count: 1,
      },
    ]);
    expect(h.viewer.measurements.get(id)?.label).toBe('Mine');
    // Loading again still replaces what the report made.
    await expect(h.viewer.measurements.loadSr(SR)).resolves.toMatchObject({
      added: 0,
      replaced: 1,
    });
  });

  it('does not replace a measurement brought in with importJson that has the id of a shape', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    const id = srMeasurementId(SR_SOP, 0);
    await h.viewer.measurements.importJson({
      format: 'measurements/v1',
      measurements: [
        {
          id,
          type: 'length',
          label: 'Imported by the host',
          reference: { studyInstanceUID: STUDY, seriesInstanceUID: CT, sopInstanceUID: CT_FIRST },
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
        },
      ],
    });
    const result = await h.viewer.measurements.loadSr(SR);
    expect(result.added).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(h.viewer.measurements.get(id)?.label).toBe('Imported by the host');
    // Once the host's measurement is gone, the id is free and the report makes its own.
    await h.viewer.measurements.remove(id);
    await h.viewer.measurements.loadSr(SR);
    expect(h.viewer.measurements.get(id)?.label).toBe('Aorta');
  });

  it('keeps what the person drew, and what the host added', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    await h.viewer.measurements.add({
      id: 'mine',
      type: 'length',
      reference: {
        studyInstanceUID: STUDY,
        seriesInstanceUID: CT,
        sopInstanceUID: CT_FIRST,
      },
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    });
    await h.viewer.measurements.loadSr(SR);
    expect(h.viewer.measurements.get('mine')).toBeDefined();
    expect(h.viewer.measurements.list()).toHaveLength(3);
  });

  it('draws the shapes on the image that is on screen', async () => {
    const h = harness();
    await show(h);
    await h.viewer.measurements.loadSr(SR);

    const stack = h.port.stacks[0];
    expect(stack?.measurements.get(srMeasurementId(SR_SOP, 0))).toMatchObject({
      type: 'length',
      imageIndex: 0,
    });
    expect(stack?.measurements.get(srMeasurementId(SR_SOP, 1))).toMatchObject({
      type: 'probe',
      imageIndex: 3,
    });
  });

  it('keeps what it can when the report names a series the study does not have', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    h.port.reportReferences = ['1.9.9.9', CT];
    const result = await h.viewer.measurements.loadSr(SR);
    expect(result.added).toBe(2);
    expect(h.port.reportReads[0]?.sopInstanceUIDs).toHaveLength(10);
  });

  it('counts every shape as left out when none of the series it names is in the study', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    h.port.reportReferences = ['1.9.9.9'];
    const result = await h.viewer.measurements.loadSr(SR);
    expect(result.added).toBe(0);
    expect(result.skipped).toEqual([
      { reason: 'The report refers to an image that is not in this study.', count: 2 },
    ]);
    expect(h.port.reportReads[0]?.sopInstanceUIDs).toEqual([]);
  });

  it('rejects for a series that is not a report, and changes nothing', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    await expect(h.viewer.measurements.loadSr(CT)).rejects.toThrow(RangeError);
    await expect(h.viewer.measurements.loadSr(CT)).rejects.toThrow(/not an SR/);
    expect(h.viewer.measurements.list()).toEqual([]);
    expect(h.port.reportReads).toEqual([]);
  });

  it('rejects for a series that is not a UID, before it asks the server for anything', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    const before = h.source.calls.length;
    await expect(h.viewer.measurements.loadSr('../x')).rejects.toThrow(RangeError);
    expect(h.source.calls).toHaveLength(before);
  });

  it('rejects before a study is loaded', async () => {
    const h = harness();
    await expect(h.viewer.measurements.loadSr(SR)).rejects.toThrow(/Load a study first/);
  });

  it('rejects for a report the engine will not read, without asking for the series it names', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    const before = h.source.calls.length;
    await expect(h.viewer.measurements.loadSr(SR_NOT_A_REPORT)).rejects.toThrow(
      /not a TID 1500 measurement report/,
    );
    expect(h.viewer.measurements.list()).toEqual([]);
    expect(h.source.calls.slice(before)).not.toContain(`getSeries ${STUDY} ${CT}`);
  });

  it('rejects when the engine fails, and adds nothing', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    h.port.failNextReportRead();
    await expect(h.viewer.measurements.loadSr(SR)).rejects.toThrow(/could not be read/);
    expect(h.viewer.measurements.list()).toEqual([]);
    expect(h.events['measurement:added']).toEqual([]);
  });

  it('comes after the calls made before it, as every change does', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    const first = h.viewer.measurements.loadSr(SR);
    const cleared = h.viewer.measurements.clear();
    await first;
    // The clear was asked for after the load, so it runs after it and removes what it made.
    await expect(cleared).resolves.toBe(2);
    expect(h.viewer.measurements.list()).toEqual([]);
  });

  it('rejects after the viewer is destroyed', async () => {
    const h = harness();
    await h.viewer.loadStudy(STUDY);
    h.viewer.destroy();
    await expect(h.viewer.measurements.loadSr(SR)).rejects.toThrow();
  });
});
