import { describe, expect, it } from 'vitest';
import { addLocalFile, getLocalFile, removeLocalFile } from './local-files';

describe('local file registry', () => {
  it('hands out a distinct dicomfile image id per file and finds the file again', () => {
    const a = new File(['a'], 'a.dcm');
    const b = new File(['b'], 'b.dcm');
    const idA = addLocalFile(a);
    const idB = addLocalFile(b);
    expect(idA).toMatch(/^dicomfile:\d+$/);
    expect(idB).not.toBe(idA);
    expect(getLocalFile(idA)).toBe(a);
    expect(getLocalFile(idB)).toBe(b);
  });

  it('forgets a removed file, and ignores ids it never gave out', () => {
    const id = addLocalFile(new File(['x'], 'x.dcm'));
    removeLocalFile(id);
    expect(getLocalFile(id)).toBeUndefined();
    expect(getLocalFile('dicomfile:999999')).toBeUndefined();
    expect(() => {
      removeLocalFile('dicomfile:999999');
    }).not.toThrow();
  });
});
