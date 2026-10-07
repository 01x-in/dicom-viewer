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
    expect(store.studyUids).toHaveLength(2);
    const main = store.series.find((item) => item.description.includes('ct-evrle'));
    expect(store.studyUids[0]).toBe(main?.studyUid);
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
