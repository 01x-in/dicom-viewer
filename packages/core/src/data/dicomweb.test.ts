import { describe, expect, it, vi } from 'vitest';
import { createDicomWebDataSource, frameImageId } from './dicomweb';
import { DataSourceError } from './errors';

const STUDY = '1.2.3';
const SERIES = '1.2.3.4';

function instance(
  sop: string,
  position: [number, number, number],
  number: number,
  orientation: number[] = [1, 0, 0, 0, 1, 0],
): Record<string, unknown> {
  return {
    '0020000D': { vr: 'UI', Value: [STUDY] },
    '0020000E': { vr: 'UI', Value: [SERIES] },
    '00080018': { vr: 'UI', Value: [sop] },
    '00200013': { vr: 'IS', Value: [number] },
    '00200032': { vr: 'DS', Value: position },
    '00200037': { vr: 'DS', Value: orientation },
  };
}

function fetchReturning(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/dicom+json' },
      }),
    );
}

describe('frameImageId', () => {
  it('builds a wadors frame image id', () => {
    expect(frameImageId('http://pacs/dicom-web', STUDY, SERIES, 'sop1')).toBe(
      `wadors:http://pacs/dicom-web/studies/${STUDY}/series/${SERIES}/instances/sop1/frames/1`,
    );
  });

  it('does not double a trailing slash in the root', () => {
    expect(frameImageId('http://pacs/dicom-web/', STUDY, SERIES, 'sop1')).toBe(
      `wadors:http://pacs/dicom-web/studies/${STUDY}/series/${SERIES}/instances/sop1/frames/1`,
    );
  });
});

describe('createDicomWebDataSource', () => {
  it('sorts slices by position along the slice normal, not by instance number', async () => {
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: fetchReturning(200, [
        instance('c', [0, 0, 20], 1),
        instance('a', [0, 0, 0], 3),
        instance('b', [0, 0, 10], 2),
      ]),
    });
    const series = await source.getSeries(STUDY, SERIES);
    expect(series.instances.map((item) => item.sopInstanceUID)).toEqual(['a', 'b', 'c']);
    expect(series.imageIds).toHaveLength(3);
  });

  it('uses the orientation normal, so a flipped series still sorts head to foot along its normal', async () => {
    // Rows run along -y, so the normal is -z (cross of [1,0,0] and [0,-1,0]).
    const flipped = [1, 0, 0, 0, -1, 0];
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: fetchReturning(200, [
        instance('low', [0, 0, 0], 1, flipped),
        instance('high', [0, 0, 10], 2, flipped),
      ]),
    });
    const series = await source.getSeries(STUDY, SERIES);
    expect(series.instances.map((item) => item.sopInstanceUID)).toEqual(['high', 'low']);
  });

  it('sorts correctly when DS values are encoded as strings, as DICOM JSON permits', async () => {
    const asStrings = (sop: string, z: number, number: number): Record<string, unknown> => ({
      ...instance(sop, [0, 0, 0], number),
      '00200032': { vr: 'DS', Value: ['0', '0', String(z)] },
      '00200037': { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] },
      '00200013': { vr: 'IS', Value: [String(number)] },
    });
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: fetchReturning(200, [
        asStrings('c', 20, 1),
        asStrings('a', 0, 2),
        asStrings('b', 10, 3),
      ]),
    });
    const series = await source.getSeries(STUDY, SERIES);
    expect(series.instances.map((entry) => entry.sopInstanceUID)).toEqual(['a', 'b', 'c']);
    expect(series.instances.map((entry) => entry.instanceNumber)).toEqual([2, 3, 1]);
  });

  it('wraps a network failure in a DataSourceError without an HTTP status', async () => {
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const failure: unknown = await source.getSeries(STUDY, SERIES).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DataSourceError);
    expect(failure).toMatchObject({ status: undefined });
    expect(String(Reflect.get(failure as object, 'message'))).toContain('Failed to fetch');
  });

  it('rejects metadata that is not DICOM JSON', async () => {
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: fetchReturning(200, { not: 'an array' }),
    });
    await expect(source.getSeries(STUDY, SERIES)).rejects.toBeInstanceOf(DataSourceError);
  });

  it('reports a 403 as a DataSourceError carrying the status, without retrying', async () => {
    let calls = 0;
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response('{}', { status: 403 }));
      },
    });
    await expect(source.getSeries(STUDY, SERIES)).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(1);
  });

  describe('getInstanceBytes', () => {
    const multipart = (payload: number[]): Uint8Array<ArrayBuffer> =>
      Uint8Array.from([
        ...new TextEncoder().encode('--xyz\r\nContent-Type: application/dicom\r\n\r\n'),
        ...payload,
        ...new TextEncoder().encode('\r\n--xyz--\r\n'),
      ]);

    it('retrieves one whole instance (SEG or SR) as bytes', async () => {
      const requests: { url: string; accept: string | null }[] = [];
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs/',
        fetch: (input, init) => {
          requests.push({
            url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            accept: new Headers(init?.headers).get('accept'),
          });
          return Promise.resolve(
            new Response(multipart([9, 8, 7]), {
              headers: {
                'content-type': 'multipart/related; type="application/dicom"; boundary=xyz',
              },
            }),
          );
        },
      });

      const bytes = await source.getInstanceBytes(STUDY, SERIES, 'sop1', 'SEG');

      expect(Array.from(new Uint8Array(bytes))).toEqual([9, 8, 7]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(`http://pacs/studies/${STUDY}/series/${SERIES}/instances/sop1`);
      expect(requests[0]?.accept).toContain('application/dicom');
    });

    it('wraps a network failure in a DataSourceError', async () => {
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      });
      await expect(source.getInstanceBytes(STUDY, SERIES, 'sop1', 'SEG')).rejects.toBeInstanceOf(
        DataSourceError,
      );
    });

    it.each([
      ['seg-sr-only', 'CT', false],
      ['seg-sr-only', 'SEG', true],
      ['seg-sr-only', 'SR', true],
      ['all', 'CT', true],
      ['none', 'SEG', false],
    ] as const)(
      'with instanceRetrieve %s, a %s instance is allowed: %s',
      async (mode, modality, allowed) => {
        let calls = 0;
        const source = createDicomWebDataSource({
          wadoRoot: 'http://pacs',
          capabilities: { instanceRetrieve: mode },
          fetch: () => {
            calls += 1;
            return Promise.resolve(
              new Response(multipart([1]), {
                headers: {
                  'content-type': 'multipart/related; type="application/dicom"; boundary=xyz',
                },
              }),
            );
          },
        });
        const result = source.getInstanceBytes(STUDY, SERIES, 'sop1', modality);
        if (allowed) {
          await expect(result).resolves.toBeInstanceOf(ArrayBuffer);
        } else {
          await expect(result).rejects.toBeInstanceOf(DataSourceError);
          expect(calls).toBe(0);
        }
      },
    );

    it('defaults to retrieving whole instances of SEG and SR only', () => {
      const source = createDicomWebDataSource({ wadoRoot: 'http://pacs' });
      expect(source.capabilities).toEqual({ instanceRetrieve: 'seg-sr-only' });
    });

    it('reports a 403 as a DataSourceError carrying the status', async () => {
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        fetch: () => Promise.resolve(new Response('{}', { status: 403 })),
      });
      await expect(source.getInstanceBytes(STUDY, SERIES, 'sop1', 'SEG')).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('request policy', () => {
    it('sends the host headers with metadata and instance requests', async () => {
      const seen: (string | null)[] = [];
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        getRequestHeaders: () => ({ Authorization: 'Bearer t' }),
        fetch: (input, init) => {
          seen.push(new Headers(init?.headers).get('authorization'));
          const url = typeof input === 'string' ? input : '';
          return Promise.resolve(
            url.endsWith('/metadata')
              ? new Response(JSON.stringify([instance('a', [0, 0, 0], 1)]))
              : new Response(
                  Uint8Array.from([
                    ...new TextEncoder().encode('--xyz\r\nContent-Type: application/dicom\r\n\r\n'),
                    1,
                    ...new TextEncoder().encode('\r\n--xyz--\r\n'),
                  ]),
                  { headers: { 'content-type': 'multipart/related; boundary=xyz' } },
                ),
          );
        },
      });
      await source.getSeries(STUDY, SERIES);
      await source.getInstanceBytes(STUDY, SERIES, 'a', 'SEG');
      expect(seen).toEqual(['Bearer t', 'Bearer t']);
    });

    it('refreshes after a 401 and retries the metadata request once', async () => {
      let token = 'old';
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        getRequestHeaders: () => ({ Authorization: `Bearer ${token}` }),
        onUnauthorized: () => {
          token = 'new';
        },
        fetch: (_input, init) =>
          Promise.resolve(
            new Headers(init?.headers).get('authorization') === 'Bearer new'
              ? new Response(JSON.stringify([instance('a', [0, 0, 0], 1)]))
              : new Response('{}', { status: 401 }),
          ),
      });
      const series = await source.getSeries(STUDY, SERIES);
      expect(series.instances).toHaveLength(1);
    });

    it('retries a 5xx on the metadata request', async () => {
      let calls = 0;
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        retry: { retries: 1, baseDelayMs: 0 },
        fetch: () => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? new Response('{}', { status: 503 })
              : new Response(JSON.stringify([instance('a', [0, 0, 0], 1)])),
          );
        },
      });
      await source.getSeries(STUDY, SERIES);
      expect(calls).toBe(2);
    });

    it('hands the frame loader the same policy, keyed by the image id prefix', async () => {
      const refresh = vi.fn();
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs/dicom-web/',
        getRequestHeaders: () => ({ Authorization: 'Bearer t' }),
        onUnauthorized: refresh,
      });
      const frames = source.frameRequests;
      expect(frames?.imageIdPrefix).toBe('wadors:http://pacs/dicom-web/');
      expect(frames?.headers({ url: 'http://pacs/dicom-web/x', accept: 'a/b' })).toEqual({
        Authorization: 'Bearer t',
      });
      await expect(frames?.refresh({ url: 'u', accept: 'a/b' }, frames.generation())).resolves.toBe(
        true,
      );
      expect(refresh).toHaveBeenCalledOnce();
      // A request sent before that refresh finished does not trigger another one.
      await frames?.refresh({ url: 'u', accept: 'a/b' }, 0);
      expect(refresh).toHaveBeenCalledOnce();
      expect(frames?.generation()).toBe(1);
    });
  });
});
