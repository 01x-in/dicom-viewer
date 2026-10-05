import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutCells } from './layout';
import { createThrottledAnnouncer, describeViewport } from './live-label';

describe('describeViewport', () => {
  it('says what is shown and where in the series', () => {
    expect(describeViewport({ name: 'Chest CT', imageIndex: 11, imageCount: 64 })).toBe(
      'Chest CT, image 12 of 64',
    );
  });

  it('adds only what differs from the default view', () => {
    expect(
      describeViewport({
        name: 'CT',
        imageIndex: 0,
        imageCount: 10,
        window: { center: 480.4, width: 2500 },
        invert: true,
        zoom: 2,
      }),
    ).toBe('CT, image 1 of 10, window 2500, level 480, inverted, zoom 2.0 times');
    expect(describeViewport({ name: 'CT', imageIndex: 0, imageCount: 10, invert: false })).toBe(
      'CT, image 1 of 10',
    );
  });

  it('says there is nothing when no series is shown, or the series is empty', () => {
    expect(describeViewport({ name: undefined, imageIndex: undefined, imageCount: 0 })).toBe(
      'No image shown',
    );
    expect(describeViewport({ name: 'CT', imageIndex: 0, imageCount: 0 })).toBe('No image shown');
  });
});

describe('the throttled announcer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says only the latest text, once things have been still for the delay', () => {
    const say = vi.fn();
    const announcer = createThrottledAnnouncer(say, 500);
    announcer.push('image 1');
    vi.advanceTimersByTime(300);
    announcer.push('image 2');
    vi.advanceTimersByTime(300);
    expect(say).not.toHaveBeenCalled();
    announcer.push('image 3');
    vi.advanceTimersByTime(500);
    expect(say.mock.calls).toEqual([['image 3']]);
  });

  it('does not say the same text twice in a row, but does after a different one', () => {
    const say = vi.fn();
    const announcer = createThrottledAnnouncer(say, 100);
    announcer.push('a');
    vi.advanceTimersByTime(100);
    announcer.push('a');
    vi.advanceTimersByTime(100);
    announcer.push('b');
    vi.advanceTimersByTime(100);
    announcer.push('a');
    vi.advanceTimersByTime(100);
    expect(say.mock.calls).toEqual([['a'], ['b'], ['a']]);
  });

  it('says what is waiting on flush, and drops it on cancel', () => {
    const say = vi.fn();
    const announcer = createThrottledAnnouncer(say, 500);
    announcer.push('now');
    announcer.flush();
    expect(say).toHaveBeenCalledWith('now');
    announcer.push('never');
    announcer.cancel();
    vi.advanceTimersByTime(1000);
    expect(say).toHaveBeenCalledOnce();
  });
});

describe('layoutCells', () => {
  it('has one cell for 1x1', () => {
    expect(layoutCells('1x1')).toEqual({ ids: ['vp-0'], columns: 1, rows: 1 });
  });
});
