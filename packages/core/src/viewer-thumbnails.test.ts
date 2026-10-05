// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CT, CT_TWO_STACKS, SEG, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness } from './testing/harness';

destroyViewersAfterEach();

describe('viewer.thumbnails', () => {
  it('draws the middle slice of the first stack, at the size asked for', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    const picture = await viewer.thumbnails.get(CT, { size: 64 });
    // Ten slices: the middle one is index 5.
    expect(picture).toBe(`data:image/fake,fake:${CT}/0/5@64`);
    expect(port.thumbnailCalls).toEqual([`fake:${CT}/0/5@64`]);
  });

  it('uses the largest stack of a series that splits', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    await viewer.thumbnails.get(CT_TWO_STACKS);
    expect(port.thumbnailCalls).toEqual([`fake:${CT_TWO_STACKS}/0/3@96`]);
  });

  it('has nothing to draw for a SEG, and does not ask the engine', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    await expect(viewer.thumbnails.get(SEG)).resolves.toBeUndefined();
    expect(port.thumbnailCalls).toEqual([]);
  });

  it('keeps a picture, and asks the engine once for a series asked for twice at once', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    const [first, second] = await Promise.all([
      viewer.thumbnails.get(CT),
      viewer.thumbnails.get(CT),
    ]);
    expect(second).toBe(first);
    await viewer.thumbnails.get(CT);
    expect(port.thumbnailCalls).toHaveLength(1);
  });

  it('draws each size separately', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    await viewer.thumbnails.get(CT, { size: 32 });
    await viewer.thumbnails.get(CT, { size: 64 });
    expect(port.thumbnailCalls).toHaveLength(2);
  });

  it('does not keep a failure, so asking again tries again', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    port.failNextThumbnail();
    await expect(viewer.thumbnails.get(CT)).rejects.toThrow(/could not be drawn/);
    await expect(viewer.thumbnails.get(CT)).resolves.toMatch(/^data:/);
  });

  it('draws two at a time, so a long series list does not flood the loader', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    const held = port.holdThumbnails();
    const all = Promise.all([
      viewer.thumbnails.get(CT),
      viewer.thumbnails.get(CT_TWO_STACKS),
      viewer.thumbnails.get(CT, { size: 32 }),
      viewer.thumbnails.get(CT_TWO_STACKS, { size: 32 }),
    ]);
    // Let the series lookups and the first two renders start.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(port.thumbnailCalls).toHaveLength(2);
    held.release();
    await all;
    expect(port.thumbnailCalls).toHaveLength(4);
    expect(held.peak()).toBe(2);
  });

  it('refuses a size that is not a whole number from 16 to 512, and a malformed UID', async () => {
    const { viewer } = harness();
    await viewer.loadStudy(STUDY);
    for (const size of [8, 513, 64.5, Number.NaN]) {
      await expect(viewer.thumbnails.get(CT, { size })).rejects.toThrow(RangeError);
    }
    await expect(viewer.thumbnails.get('../x')).rejects.toThrow(/SeriesInstanceUID/);
  });

  it('needs a study', async () => {
    const { viewer } = harness();
    await expect(viewer.thumbnails.get(CT)).rejects.toThrow(/Load a study first/);
  });

  it('forgets its pictures when another study is loaded', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    await viewer.thumbnails.get(CT);
    await viewer.loadStudy('1.2.4');
    await viewer.thumbnails.get(CT);
    expect(port.thumbnailCalls).toHaveLength(2);
  });

  it('rejects what was waiting when the viewer is destroyed, and refuses new asks', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    const held = port.holdThumbnails();
    const asked = [CT, CT_TWO_STACKS, CT].map((uid, at) =>
      viewer.thumbnails.get(uid, { size: 32 + at * 8 }),
    );
    const settled = Promise.allSettled(asked);
    await new Promise((resolve) => setTimeout(resolve, 0));
    viewer.destroy();
    held.release();
    const results = await settled;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    await expect(viewer.thumbnails.get(CT)).rejects.toThrow(/destroyed/);
  });

  it('rejects a long queue of waiting pictures when the viewer is destroyed', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    const held = port.holdThumbnails();
    const sizes = Array.from({ length: 497 }, (_, at) => 16 + at);
    const asked = sizes.flatMap((size) => [
      viewer.thumbnails.get(CT, { size }),
      viewer.thumbnails.get(CT_TWO_STACKS, { size }),
    ]);
    const settled = Promise.allSettled(asked);
    await new Promise((resolve) => setTimeout(resolve, 0));
    viewer.destroy();
    held.release();
    const results = await settled;
    expect(results).toHaveLength(994);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('rejects requests still waiting when another study is loaded, and never asks for them in the new one', async () => {
    const { viewer, port, source } = harness();
    await viewer.loadStudy(STUDY);
    const held = port.holdThumbnails();
    const asked = [CT, CT_TWO_STACKS, CT, CT_TWO_STACKS].map((uid, at) =>
      viewer.thumbnails.get(uid, { size: 32 + at * 8 }),
    );
    const settled = Promise.allSettled(asked);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await viewer.loadStudy('1.2.4');
    held.release();
    const results = await settled;
    // Two were already being drawn, for the study they were asked in; two had not started.
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'rejected',
    ]);
    expect((results[2] as PromiseRejectedResult).reason).toEqual(
      expect.objectContaining({ message: 'The study changed.' }),
    );
    expect(source.calls.filter((call) => call.startsWith('getSeries 1.2.4'))).toEqual([]);
  });

  it('keeps a picture for the study it was asked in, not for the one that came after', async () => {
    const { viewer, port } = harness();
    await viewer.loadStudy(STUDY);
    const first = viewer.thumbnails.get(CT);
    await viewer.loadStudy('1.2.4');
    await first;
    // The same series UID in the new study is a new picture.
    await viewer.thumbnails.get(CT);
    expect(port.thumbnailCalls).toHaveLength(2);
  });
});
