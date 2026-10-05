// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CT, CT_TWO_STACKS, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, type Harness } from './testing/harness';
import type { ViewportApi } from './viewer-core';

destroyViewersAfterEach();

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function show(h: Harness, imageIndex = 0): Promise<ViewportApi> {
  h.viewer.viewports.attach('vp-0', h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT, { imageIndex });
  const api = h.viewer.viewports.get('vp-0');
  if (api === undefined) throw new Error('nothing is shown');
  return api;
}

const indices = (h: Harness): number[] =>
  h.events['viewport:image'].map((event) => event.imageIndex);

describe('cine', () => {
  it('moves one slice at the rate it was asked for, and says it started', async () => {
    const h = harness();
    const api = await show(h, 2);
    await api.cine.play({ fps: 10 });

    expect(api.cine.playing).toBe(true);
    expect(h.events['viewport:cine']).toEqual([{ viewportId: 'vp-0', playing: true, fps: 10 }]);

    await vi.advanceTimersByTimeAsync(99);
    expect(api.getImageIndex()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getImageIndex()).toBe(3);
    await vi.advanceTimersByTimeAsync(200);
    expect(api.getImageIndex()).toBe(5);
    api.cine.stop();
  });

  it('starts again at the first slice after the last, by default', async () => {
    const h = harness();
    const api = await show(h, 8);
    await api.cine.play({ fps: 20 });
    await vi.advanceTimersByTimeAsync(150);
    expect(indices(h).slice(-3)).toEqual([9, 0, 1]);
    api.cine.stop();
  });

  it('stops at the last slice when it does not loop, and says it stopped', async () => {
    const h = harness();
    const api = await show(h, 8);
    await api.cine.play({ fps: 20, loop: false });
    await vi.advanceTimersByTimeAsync(500);
    expect(api.getImageIndex()).toBe(9);
    expect(api.cine.playing).toBe(false);
    expect(h.events['viewport:cine'].map((event) => event.playing)).toEqual([true, false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when asked, and nothing moves afterwards', async () => {
    const h = harness();
    const api = await show(h);
    await api.cine.play({ fps: 10 });
    await vi.advanceTimersByTimeAsync(250);
    api.cine.stop();
    const at = api.getImageIndex();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getImageIndex()).toBe(at);
    expect(vi.getTimerCount()).toBe(0);
    api.cine.stop();
    expect(h.events['viewport:cine'].filter((event) => !event.playing)).toHaveLength(1);
  });

  it('changes rate while playing, without starting over', async () => {
    const h = harness();
    const api = await show(h);
    await api.cine.play({ fps: 10 });
    await api.cine.play({ fps: 50 });
    expect(api.cine.fps).toBe(50);
    await vi.advanceTimersByTimeAsync(100);
    expect(api.getImageIndex()).toBe(5);
    expect(h.events['viewport:cine'].map((event) => event.fps)).toEqual([10, 50]);
    api.cine.stop();
  });

  it('carries on from where the user scrolled to', async () => {
    const h = harness();
    const api = await show(h);
    await api.cine.play({ fps: 10 });
    h.port.stacks[0]?.emitImage(6);
    await vi.advanceTimersByTimeAsync(100);
    expect(api.getImageIndex()).toBe(7);
    api.cine.stop();
  });

  it.each([0, -1, 61, Number.NaN])('refuses %s slices per second', async (fps) => {
    const h = harness();
    const api = await show(h);
    await expect(api.cine.play({ fps })).rejects.toThrow(RangeError);
    expect(api.cine.playing).toBe(false);
  });

  it('refuses a rate from JavaScript that is not a number at all, with a RangeError', async () => {
    const h = harness();
    const api = await show(h);
    // A host without types can pass null; reporting it must not throw a TypeError of its own.
    const notANumber = (value: unknown): number => value as number;
    await expect(api.cine.play({ fps: notANumber(null) })).rejects.toThrow(RangeError);
    await expect(api.cine.play({ fps: notANumber('fast') })).rejects.toThrow(RangeError);
  });

  it('is not started by a play that was still queued when stop was called', async () => {
    const h = harness();
    const api = await show(h);
    const starting = api.cine.play({ fps: 10 });
    api.cine.stop();
    await starting;
    await vi.advanceTimersByTimeAsync(500);
    expect(api.cine.playing).toBe(false);
    expect(h.events['viewport:cine']).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets the last of several quick calls win', async () => {
    const h = harness();
    const api = await show(h);
    const first = api.cine.play({ fps: 10 });
    api.cine.stop();
    const second = api.cine.play({ fps: 20 });
    await Promise.all([first, second]);
    expect(api.cine.playing).toBe(true);
    expect(api.cine.fps).toBe(20);
    api.cine.stop();
  });

  it('needs a series on screen', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    await expect(h.viewer.viewports.get('vp-0')?.cine.play()).rejects.toThrow(/shows no series/);
  });

  it('stops when another series is shown, the element is detached, or the viewer is destroyed', async () => {
    const h = harness();
    const api = await show(h);
    await api.cine.play();
    await h.viewer.setViewportSeries('vp-0', CT_TWO_STACKS);
    expect(api.cine.playing).toBe(false);

    await api.cine.play();
    h.viewer.viewports.detach('vp-0');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.cine.playing).toBe(false);

    h.viewer.viewports.attach('vp-0', h.element);
    await vi.advanceTimersByTimeAsync(0);
    const again = h.viewer.viewports.get('vp-0');
    await again?.cine.play();
    h.viewer.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops and reports when the engine fails, instead of failing every tick', async () => {
    const h = harness();
    const api = await show(h);
    const stack = h.port.stacks[0];
    if (stack === undefined) throw new Error('no stack');
    vi.spyOn(stack, 'setImageIndex').mockRejectedValue(new Error('lost context'));
    await api.cine.play({ fps: 10 });

    await vi.advanceTimersByTimeAsync(500);

    expect(api.cine.playing).toBe(false);
    expect(h.events.error).toHaveLength(1);
    expect(h.events.error[0]).toMatchObject({ context: 'cine' });
    expect(h.events.error[0]?.error.message).toBe('lost context');
  });
});
