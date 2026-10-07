import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_CORNERS, mergeById, resolveCorners } from './overlay-items';

describe('the default overlay items', () => {
  it('are the lines the overlay has always had, corner by corner', () => {
    const names = (corner: keyof typeof DEFAULT_OVERLAY_CORNERS): string[] =>
      DEFAULT_OVERLAY_CORNERS[corner].map((item) =>
        item.kind === 'builtin' ? item.name : item.tag,
      );
    expect(names('topLeft')).toEqual(['patientName', 'patientId', 'series']);
    expect(names('topRight')).toEqual(['modality', 'size']);
    expect(names('bottomLeft')).toEqual(['window', 'zoom', 'inverted']);
    expect(names('bottomRight')).toEqual(['image']);
  });
});

describe('mergeById', () => {
  const a = { id: 'a', kind: 'builtin', name: 'series' } as const;
  const b = { id: 'b', kind: 'builtin', name: 'modality' } as const;

  it('replaces an item in its place, and adds a new one at the end', () => {
    const merged = mergeById(
      [a, b],
      [
        { id: 'a', kind: 'builtin', name: 'size' },
        { id: 'c', kind: 'builtin', name: 'image' },
      ],
    );
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged[0]).toMatchObject({ name: 'size' });
  });

  it('keeps a removal, so it can act on the defaults', () => {
    expect(mergeById([a], [{ id: 'z', remove: true }])).toEqual([a, { id: 'z', remove: true }]);
  });

  it('lets a later item put back what a removal took out', () => {
    const removed = mergeById([a], [{ id: 'a', remove: true }]);
    expect(mergeById(removed, [a])).toEqual([a]);
  });

  it('does not change what it is given', () => {
    const base = [a];
    mergeById(base, [b]);
    expect(base).toEqual([a]);
  });
});

describe('resolveCorners', () => {
  it('is the defaults when nothing is said', () => {
    expect(resolveCorners(undefined)).toEqual(DEFAULT_OVERLAY_CORNERS);
  });

  it('takes an item out, adds one, and changes one, and leaves a corner that is not mentioned', () => {
    const resolved = resolveCorners({
      topLeft: [{ id: 'patientId', remove: true }],
      topRight: [{ id: 'kvp', kind: 'tag', tag: 'KVP', label: 'kVp' }],
      bottomRight: [{ id: 'image', kind: 'builtin', name: 'image' }],
    });
    expect(resolved.topLeft.map((item) => item.id)).toEqual(['patientName', 'series']);
    expect(resolved.topRight.map((item) => item.id)).toEqual(['modality', 'size', 'kvp']);
    expect(resolved.bottomLeft).toEqual(DEFAULT_OVERLAY_CORNERS.bottomLeft);
  });
});
