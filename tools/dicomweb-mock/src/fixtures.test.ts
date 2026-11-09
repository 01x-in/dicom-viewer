import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { data } from 'dcmjs';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from './fixtures.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/phantom', import.meta.url));

describe('loadFixtures', () => {
  it('reads the series directories in alphabetical order, so the first study is the main one on every disk', async () => {
    const store = await loadFixtures(FIXTURES);
    const names = store.series.map((item) => item.description);
    // `readdir` has no order of its own: the order of the series, and so the first study, must not depend on it.
    const sorted = [...store.series]
      .map((item) => item.description)
      .sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    expect(store.studyUids).toHaveLength(2);
    const main = store.series.find((item) => item.description.includes('ct-evrle'));
    expect(store.studyUids[0]).toBe(main?.studyUid);
  });

  it('reads the report, which has no pixels, with its whole file and no frames', async () => {
    const store = await loadFixtures(FIXTURES);
    const report = store.series.find((item) => item.modality === 'SR');
    expect(report?.description).toBe('Phantom SR (sr-measurements)');
    expect(report?.instances).toHaveLength(1);
    expect(report?.instances[0]?.frames).toEqual([]);
    expect(report?.instances[0]?.file.byteLength).toBeGreaterThan(1000);
    const main = store.series.find((item) => item.description.includes('ct-evrle'));
    expect(report?.studyUid).toBe(main?.studyUid);
  });

  it('puts the fallback series in the second study', async () => {
    const store = await loadFixtures(FIXTURES);
    const [, second] = store.studyUids;
    const inSecond = store.series
      .filter((item) => item.studyUid === second)
      .map((item) => item.description)
      .sort();
    expect(inSecond).toEqual(['Phantom CT (ct-nonuniform)', 'Phantom CT (ct-tilted)']);
  });
});

describe('addInstance', () => {
  /** The phantom's report, with the series and instance UIDs changed, as a file. */
  function anotherReport(): ArrayBuffer {
    const file = readFileSync(`${FIXTURES}/sr-measurements/0001.dcm`);
    const read = data.DicomMessage.readFile(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    );
    read.dict['0020000E'] = { vr: 'UI', Value: ['2.25.9001'] };
    read.dict['00080018'] = { vr: 'UI', Value: ['2.25.9002'] };
    read.meta['00020003'] = { vr: 'UI', Value: ['2.25.9002'] };
    return read.write();
  }

  it('adds a file as a series of its own study, which is then found like the others', async () => {
    const store = await loadFixtures(FIXTURES);
    const before = store.series.length;
    store.addInstance(anotherReport());
    expect(store.series).toHaveLength(before + 1);
    const added = store.series.find((item) => item.seriesUid === '2.25.9001');
    expect(added?.modality).toBe('SR');
    expect(added?.instances[0]?.sopUid).toBe('2.25.9002');
    expect(added?.instances[0]?.frames).toEqual([]);
    expect(store.findSeries(added?.studyUid ?? '', '2.25.9001')).toBe(added);
    // It is in the study the report is of, and adds no study.
    expect(store.studyUids).toHaveLength(2);
  });

  it('adds to a series that is there, and refuses a file that is not DICOM', async () => {
    const store = await loadFixtures(FIXTURES);
    store.addInstance(anotherReport());
    store.addInstance(anotherReport());
    expect(store.series.filter((item) => item.seriesUid === '2.25.9001')).toHaveLength(1);
    expect(store.findSeries(store.studyUids[0] ?? '', '2.25.9001')?.instances).toHaveLength(1);
    expect(() => {
      store.addInstance(new Uint8Array([1, 2, 3]).buffer);
    }).toThrow();
  });
});
