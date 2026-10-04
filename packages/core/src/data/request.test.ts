import { describe, expect, it, vi } from 'vitest';
import { DataSourceError } from './errors';
import { createRequester, type DicomWebRequest } from './request';

function respond(status: number): Response {
  return new Response('{}', { status });
}

/** A fetch that answers from a script and records the Authorization header it saw. */
function scripted(statuses: readonly number[]): {
  fetch: typeof fetch;
  seen: (string | null)[];
} {
  const seen: (string | null)[] = [];
  let call = 0;
  return {
    seen,
    fetch: (_input, init) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      const status = statuses[Math.min(call, statuses.length - 1)] ?? 200;
      call += 1;
      return Promise.resolve(respond(status));
    },
  };
}

const NO_DELAY = { retries: 2, baseDelayMs: 0 } as const;

describe('createRequester', () => {
  it('asks for headers synchronously on every request, with the URL and Accept type', async () => {
    const infos: DicomWebRequest[] = [];
    let token = 0;
    const script = scripted([200]);
    const requester = createRequester({
      fetch: script.fetch,
      retry: NO_DELAY,
      getRequestHeaders: (info) => {
        infos.push(info);
        token += 1;
        return { Authorization: `Bearer ${token.toString()}` };
      },
    });

    await requester.get('http://pacs/a', 'application/dicom+json');
    await requester.get('http://pacs/b', 'application/dicom+json');

    expect(script.seen).toEqual(['Bearer 1', 'Bearer 2']);
    expect(infos).toEqual([
      { url: 'http://pacs/a', accept: 'application/dicom+json' },
      { url: 'http://pacs/b', accept: 'application/dicom+json' },
    ]);
  });

  it('does not let custom headers replace Accept', async () => {
    let accept: string | null = null;
    const requester = createRequester({
      retry: NO_DELAY,
      getRequestHeaders: () => ({ Accept: 'text/html' }),
      fetch: (_input, init) => {
        accept = new Headers(init?.headers).get('accept');
        return Promise.resolve(respond(200));
      },
    });
    await requester.get('http://pacs/a', 'application/dicom+json');
    expect(accept).toBe('application/dicom+json');
  });

  it('refreshes once on 401, then retries with the new headers', async () => {
    let token = 'old';
    const script = scripted([401, 200]);
    const onUnauthorized = vi.fn(() => {
      token = 'new';
    });
    const requester = createRequester({
      fetch: script.fetch,
      retry: NO_DELAY,
      getRequestHeaders: () => ({ Authorization: `Bearer ${token}` }),
      onUnauthorized,
    });

    const response = await requester.get('http://pacs/a', 'application/dicom+json');

    expect(response.status).toBe(200);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onUnauthorized).toHaveBeenCalledWith({
      url: 'http://pacs/a',
      accept: 'application/dicom+json',
    });
    expect(script.seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('gives up after one refresh when the retry is still 401', async () => {
    const script = scripted([401]);
    const onUnauthorized = vi.fn();
    const requester = createRequester({ fetch: script.fetch, retry: NO_DELAY, onUnauthorized });

    await expect(requester.get('http://pacs/a', 'x/y')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(script.seen).toHaveLength(2);
  });

  it('reports a 401 straight away when there is no refresh hook', async () => {
    const script = scripted([401]);
    const requester = createRequester({ fetch: script.fetch, retry: NO_DELAY });
    await expect(requester.get('http://pacs/a', 'x/y')).rejects.toMatchObject({ status: 401 });
    expect(script.seen).toHaveLength(1);
  });

  it('shares one refresh between requests that fail with 401 at the same time', async () => {
    let token = 'old';
    const onUnauthorized = vi.fn(async () => {
      await Promise.resolve();
      token = 'new';
    });
    const requester = createRequester({
      retry: NO_DELAY,
      getRequestHeaders: () => ({ Authorization: `Bearer ${token}` }),
      fetch: (_input, init) =>
        Promise.resolve(
          respond(new Headers(init?.headers).get('authorization') === 'Bearer new' ? 200 : 401),
        ),
      onUnauthorized,
    });

    const responses = await Promise.all([
      requester.get('http://pacs/1', 'x/y'),
      requester.get('http://pacs/2', 'x/y'),
      requester.get('http://pacs/3', 'x/y'),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('retries without a second refresh when the 401 belongs to a request sent before the last refresh', async () => {
    let token = 'old';
    let releaseLate: () => void = () => undefined;
    const late = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    const onUnauthorized = vi.fn(() => {
      token = 'new';
    });
    const requester = createRequester({
      retry: NO_DELAY,
      getRequestHeaders: () => ({ Authorization: `Bearer ${token}` }),
      onUnauthorized,
      fetch: async (_input, init) => {
        const bearer = new Headers(init?.headers).get('authorization');
        if (bearer === 'Bearer new') return respond(200);
        // The second request was sent with the old token and only fails after the first refresh ran.
        if (_input === 'http://pacs/slow') await late;
        return respond(401);
      },
    });

    const fast = requester.get('http://pacs/fast', 'x/y');
    const slow = requester.get('http://pacs/slow', 'x/y');
    await fast;
    releaseLate();

    expect((await slow).status).toBe(200);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not count a failed refresh: a request sent before it still has stale credentials and refreshes again', async () => {
    let attempts = 0;
    const onUnauthorized = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    });
    const requester = createRequester({ retry: NO_DELAY, onUnauthorized });
    const info = { url: 'http://pacs/a', accept: 'x/y' };

    await expect(requester.refresh(info, 0)).rejects.toThrow('offline');
    expect(requester.generation()).toBe(0);
    // Sent at generation 0, which is still current, so the hook runs again and this time works.
    await expect(requester.refresh(info, 0)).resolves.toBe(true);
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
    expect(requester.generation()).toBe(1);
  });

  it('wraps a failing refresh hook in a DataSourceError that keeps the 401', async () => {
    const requester = createRequester({
      fetch: scripted([401]).fetch,
      retry: NO_DELAY,
      onUnauthorized: () => Promise.reject(new Error('session expired')),
    });
    const failure: unknown = await requester
      .get('http://pacs/a', 'x/y')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataSourceError);
    expect(failure).toMatchObject({ status: 401 });
    expect((failure as DataSourceError).message).toContain('session expired');
  });

  it.each([403, 404])('never retries a %i', async (status) => {
    const script = scripted([status]);
    const requester = createRequester({
      fetch: script.fetch,
      retry: NO_DELAY,
      onUnauthorized: vi.fn(),
    });
    await expect(requester.get('http://pacs/a', 'x/y')).rejects.toMatchObject({ status });
    expect(script.seen).toHaveLength(1);
  });

  it('retries 5xx with backoff, then succeeds', async () => {
    const delays: number[] = [];
    const script = scripted([503, 500, 200]);
    const requester = createRequester({
      fetch: script.fetch,
      retry: { retries: 2, baseDelayMs: 100 },
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    const response = await requester.get('http://pacs/a', 'x/y');

    expect(response.status).toBe(200);
    expect(script.seen).toHaveLength(3);
    expect(delays).toEqual([100, 200]);
  });

  it('reports the last 5xx once the retries are spent', async () => {
    const script = scripted([502]);
    const requester = createRequester({ fetch: script.fetch, retry: NO_DELAY });
    await expect(requester.get('http://pacs/a', 'x/y')).rejects.toMatchObject({ status: 502 });
    expect(script.seen).toHaveLength(3);
  });

  it('does not retry other 4xx statuses', async () => {
    const script = scripted([400]);
    const requester = createRequester({ fetch: script.fetch, retry: NO_DELAY });
    await expect(requester.get('http://pacs/a', 'x/y')).rejects.toMatchObject({ status: 400 });
    expect(script.seen).toHaveLength(1);
  });

  it('wraps a network failure in a DataSourceError without retrying', async () => {
    let calls = 0;
    const requester = createRequester({
      retry: NO_DELAY,
      fetch: () => {
        calls += 1;
        return Promise.reject(new TypeError('Failed to fetch'));
      },
    });
    const failure: unknown = await requester
      .get('http://pacs/a', 'x/y')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataSourceError);
    expect(failure).toMatchObject({ status: undefined });
    expect(calls).toBe(1);
  });

  it('refresh() runs the hook once for concurrent callers and is a no-op without a hook', async () => {
    const hook = vi.fn(() => Promise.resolve());
    const requester = createRequester({ retry: NO_DELAY, onUnauthorized: hook });
    const info = { url: 'http://pacs/a', accept: 'x/y' };
    await Promise.all([requester.refresh(info), requester.refresh(info)]);
    expect(hook).toHaveBeenCalledOnce();
    expect(requester.generation()).toBe(1);
    await requester.refresh(info, 0); // sent before the refresh above: nothing to do
    expect(hook).toHaveBeenCalledOnce();
    await requester.refresh(info, 1);
    expect(hook).toHaveBeenCalledTimes(2);

    const plain = createRequester({ retry: NO_DELAY });
    await expect(plain.refresh(info)).resolves.toBe(false);
    await expect(requester.refresh(info)).resolves.toBe(true);
  });

  it('headers() exposes the per-request headers to the frame loader', () => {
    const requester = createRequester({
      retry: NO_DELAY,
      getRequestHeaders: (info) => ({ 'X-Url': info.url }),
    });
    expect(requester.headers({ url: 'http://pacs/f', accept: 'x/y' })).toEqual({
      'X-Url': 'http://pacs/f',
    });
    expect(createRequester({ retry: NO_DELAY }).headers({ url: 'u', accept: 'a' })).toEqual({});
  });
});
