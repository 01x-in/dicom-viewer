import { fileURLToPath } from 'node:url';
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
    expect(store.studyUids).toHaveLength(3);
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

  it('keeps the multi-frame phantom in a third study: the Enhanced CT, the loop, and the SEG of the CT, one instance each', async () => {
    const store = await loadFixtures(FIXTURES);
    const [main, , third] = store.studyUids;
    const inThird = store.series.filter((item) => item.studyUid === third);
    expect(inThird.map((item) => item.description).sort()).toEqual([
      'Phantom CT (multiframe-ct)',
      'Phantom Loop (multiframe-loop)',
      'Phantom SEG (multiframe-seg)',
    ]);
    for (const series of inThird) {
      expect(series.studyUid).not.toBe(main);
      expect(series.instances).toHaveLength(1);
    }
    const frames = (name: string): number | undefined =>
      inThird.find((item) => item.description.includes(name))?.instances[0]?.frames.length;
    expect(frames('multiframe-ct')).toBe(64);
    expect(frames('multiframe-loop')).toBe(24);
  });
});
