/* eslint-disable @typescript-eslint/prefer-promise-reject-errors -- the real loader rejects with an XMLHttpRequest, not an Error */
import { describe, expect, it, vi } from 'vitest';
import type { FrameRequestPolicy } from '../data/types';
import { createFrameRequests } from './frame-policy';

const PREFIX = 'wadors:http://pacs/dicom-web/';
const IMAGE_ID = `${PREFIX}studies/1/series/2/instances/3/frames/1`;

function policy(overrides: Partial<FrameRequestPolicy> = {}): FrameRequestPolicy {
  return {
    imageIdPrefix: PREFIX,
    headers: () => ({ Authorization: 'Bearer t' }),
    generation: () => 0,
    refresh: () => Promise.resolve(true),
    ...overrides,
  };
}

describe('createFrameRequests', () => {
  it('adds the registered policy headers to a frame request, with the URL and Accept type', () => {
    const headers = vi.fn(() => ({ Authorization: 'Bearer t' }));
    const frames = createFrameRequests();
    frames.register(policy({ headers }));

    expect(frames.headersFor(IMAGE_ID, { Accept: 'multipart/related' })).toEqual({
      Authorization: 'Bearer t',
    });
    expect(headers).toHaveBeenCalledWith({
      url: 'http://pacs/dicom-web/studies/1/series/2/instances/3/frames/1',
      accept: 'multipart/related',
    });
  });

  it('adds nothing for an image id no policy owns', () => {
    const frames = createFrameRequests();
    frames.register(policy());
    expect(frames.headersFor('wadors:http://other/x', { Accept: 'a/b' })).toEqual({});
  });

  it('stops adding headers once the policy is unregistered', () => {
    const frames = createFrameRequests();
    const unregister = frames.register(policy());
    unregister();
    expect(frames.headersFor(IMAGE_ID, { Accept: 'a/b' })).toEqual({});
  });

  it('keeps the policy of an equal prefix that is still registered by another viewer', () => {
    const frames = createFrameRequests();
    const first = frames.register(policy({ headers: () => ({ X: '1' }) }));
    const second = frames.register(policy({ headers: () => ({ X: '2' }) }));
    first();
    expect(frames.headersFor(IMAGE_ID, { Accept: 'a/b' })).toEqual({ X: '2' });
    second();
    expect(frames.headersFor(IMAGE_ID, { Accept: 'a/b' })).toEqual({});
  });

  describe('wrap', () => {
    const loaded = { pixels: 1 };
    const unauthorized = { status: 401 };

    it('returns the image of a load that succeeds, and never refreshes', async () => {
      const refresh = vi.fn(() => Promise.resolve(true));
      const frames = createFrameRequests();
      frames.register(policy({ refresh }));
      const load = vi.fn(() => ({ promise: Promise.resolve(loaded) }));

      const result = frames.wrap(load)(IMAGE_ID, {});

      await expect(result.promise).resolves.toBe(loaded);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes after a 401 and loads the image once more', async () => {
      const refresh = vi.fn(() => Promise.resolve(true));
      const frames = createFrameRequests();
      frames.register(policy({ refresh }));
      const load = vi
        .fn<(id: string, options?: Record<string, unknown>) => { promise: Promise<unknown> }>()
        .mockReturnValueOnce({ promise: Promise.reject(unauthorized) })
        .mockReturnValueOnce({ promise: Promise.resolve(loaded) });

      const result = frames.wrap(load)(IMAGE_ID, { priority: 1 });

      await expect(result.promise).resolves.toBe(loaded);
      expect(load).toHaveBeenCalledTimes(2);
      expect(load).toHaveBeenLastCalledWith(IMAGE_ID, { priority: 1 });
      expect(refresh).toHaveBeenCalledOnce();
    });

    it('does not refresh again when the retry is also 401', async () => {
      const refresh = vi.fn(() => Promise.resolve(true));
      const frames = createFrameRequests();
      frames.register(policy({ refresh }));
      const load = vi.fn(() => ({ promise: Promise.reject(unauthorized) }));

      await expect(frames.wrap(load)(IMAGE_ID, {}).promise).rejects.toBe(unauthorized);
      expect(load).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledOnce();
    });

    it.each([403, 404, 500])('passes a %i straight through', async (status) => {
      const refresh = vi.fn(() => Promise.resolve(true));
      const frames = createFrameRequests();
      frames.register(policy({ refresh }));
      const failure = { status };
      const load = vi.fn(() => ({ promise: Promise.reject(failure) }));

      await expect(frames.wrap(load)(IMAGE_ID, {}).promise).rejects.toBe(failure);
      expect(load).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('rethrows the 401 when the host gave no refresh hook', async () => {
      const frames = createFrameRequests();
      frames.register(policy({ refresh: () => Promise.resolve(false) }));
      const load = vi.fn(() => ({ promise: Promise.reject(unauthorized) }));

      await expect(frames.wrap(load)(IMAGE_ID, {}).promise).rejects.toBe(unauthorized);
      expect(load).toHaveBeenCalledOnce();
    });

    it('rethrows a 401 for an image id no policy owns', async () => {
      const frames = createFrameRequests();
      const load = vi.fn(() => ({ promise: Promise.reject(unauthorized) }));
      await expect(frames.wrap(load)(IMAGE_ID, {}).promise).rejects.toBe(unauthorized);
      expect(load).toHaveBeenCalledOnce();
    });

    it('reads the status from an Error as well as from an XMLHttpRequest', async () => {
      const refresh = vi.fn(() => Promise.resolve(true));
      const frames = createFrameRequests();
      frames.register(policy({ refresh }));
      const failure = Object.assign(new Error('request failed'), { status: 401 });
      const load = vi
        .fn<(id: string) => { promise: Promise<unknown> }>()
        .mockReturnValueOnce({ promise: Promise.reject(failure) })
        .mockReturnValueOnce({ promise: Promise.resolve(loaded) });
      await expect(frames.wrap(load)(IMAGE_ID, {}).promise).resolves.toBe(loaded);
    });

    it('skips the refresh when one finished after the failed request was sent', async () => {
      let generation = 0;
      const refresh = vi.fn((_request, sentAt: number) => {
        if (sentAt !== generation) return Promise.resolve(true);
        generation += 1;
        return Promise.resolve(true);
      });
      const frames = createFrameRequests();
      frames.register(policy({ generation: () => generation, refresh }));
      frames.headersFor(IMAGE_ID, { Accept: 'a/b' }); // the request is sent at generation 0
      generation = 1; // another request refreshed meanwhile

      const load = vi
        .fn<(id: string) => { promise: Promise<unknown> }>()
        .mockReturnValueOnce({ promise: Promise.reject(unauthorized) })
        .mockReturnValueOnce({ promise: Promise.resolve(loaded) });
      await expect(frames.wrap(load)(IMAGE_ID, {}).promise).resolves.toBe(loaded);

      expect(refresh).toHaveBeenCalledWith(expect.anything(), 0);
      expect(generation).toBe(1);
    });
  });
});
