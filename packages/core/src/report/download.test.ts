// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, REVOKE_AFTER_MS } from './download';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadBlob', () => {
  it('names the file and clicks a link to it', () => {
    URL.createObjectURL = (): string => 'blob:fake';
    URL.revokeObjectURL = (): void => undefined;
    const clicks: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ name: this.download, href: this.href });
    });
    downloadBlob(new Blob(['x']), 'a.pdf');
    expect(clicks).toEqual([{ name: 'a.pdf', href: 'blob:fake' }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('gives the address back, but not before the browser has had time to start the download', () => {
    vi.useFakeTimers();
    URL.createObjectURL = (): string => 'blob:fake';
    const revoked = vi.fn();
    URL.revokeObjectURL = revoked;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadBlob(new Blob(['x']), 'a.pdf');
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoked).toHaveBeenCalledWith('blob:fake');
  });

  it('gives the address back even when the click throws', () => {
    vi.useFakeTimers();
    URL.createObjectURL = (): string => 'blob:fake';
    const revoked = vi.fn();
    URL.revokeObjectURL = revoked;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      downloadBlob(new Blob(['x']), 'a.pdf');
    }).toThrow('blocked');
    vi.advanceTimersByTime(REVOKE_AFTER_MS);
    expect(revoked).toHaveBeenCalledWith('blob:fake');
  });
});
