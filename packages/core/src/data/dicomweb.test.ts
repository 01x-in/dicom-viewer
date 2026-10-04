import { describe, expect, it, vi } from 'vitest';
import { createDicomWebDataSource, frameImageId } from './dicomweb';
import { DataSourceError } from './errors';
import type { DataSource } from './types';

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
    '00080060': { vr: 'CS', Value: ['CT'] },
    '00280010': { vr: 'US', Value: [4] },
    '00280011': { vr: 'US', Value: [4] },
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
    expect(frameImageId('http://pacs/dicom-web', STUDY, SERIES, '9.1')).toBe(
      `wadors:http://pacs/dicom-web/studies/${STUDY}/series/${SERIES}/instances/9.1/frames/1`,
    );
  });

  it('does not double a trailing slash in the root', () => {
    expect(frameImageId('http://pacs/dicom-web/', STUDY, SERIES, '9.1')).toBe(
      `wadors:http://pacs/dicom-web/studies/${STUDY}/series/${SERIES}/instances/9.1/frames/1`,
    );
  });
});

describe('createDicomWebDataSource', () => {
  // Sorting, splitting, and reconstructability are covered in series.test.ts.
  it('builds stacks of wadors frame image ids from the series metadata', async () => {
    const urls: string[] = [];
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs/dicom-web/',
      fetch: (input) => {
        urls.push(typeof input === 'string' ? input : '');
        return Promise.resolve(
          new Response(
            JSON.stringify([
              instance('9.4', [0, 0, 20], 1),
              instance('9.2', [0, 0, 0], 3),
              instance('9.3', [0, 0, 10], 2),
            ]),
          ),
        );
      },
    });

    const series = await source.getSeries(STUDY, SERIES);

    expect(urls).toEqual([`http://pacs/dicom-web/studies/${STUDY}/series/${SERIES}/metadata`]);
    expect(series.modality).toBe('CT');
    // Each image id ends in a fragment that names the source, which is never sent to the server.
    expect(series.stacks[0]?.imageIds.map((id) => id.replace(/#dv-source-\d+$/, ''))).toEqual(
      ['9.2', '9.3', '9.4'].map(
        (sop) =>
          `wadors:http://pacs/dicom-web/studies/${STUDY}/series/${SERIES}/instances/${sop}/frames/1`,
      ),
    );
  });

  it('gives sources with the same root image ids that only their own frame policy owns', async () => {
    const make = (): DataSource =>
      createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        fetch: fetchReturning(200, [instance('9.2', [0, 0, 0], 1)]),
      });
    const first = make();
    const second = make();
    const [firstId] = (await first.getSeries(STUDY, SERIES)).stacks[0]?.imageIds ?? [];
    const [secondId] = (await second.getSeries(STUDY, SERIES)).stacks[0]?.imageIds ?? [];
    if (firstId === undefined || secondId === undefined) throw new Error('no image ids');
    expect(firstId).not.toBe(secondId);
    expect(first.frameRequests?.owns(firstId)).toBe(true);
    expect(first.frameRequests?.owns(secondId)).toBe(false);
    expect(second.frameRequests?.owns(secondId)).toBe(true);
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

      const bytes = await source.getInstanceBytes(STUDY, SERIES, '9.1', 'SEG');

      expect(Array.from(new Uint8Array(bytes))).toEqual([9, 8, 7]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(`http://pacs/studies/${STUDY}/series/${SERIES}/instances/9.1`);
      expect(requests[0]?.accept).toContain('application/dicom');
    });

    it('wraps a network failure in a DataSourceError', async () => {
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      });
      await expect(source.getInstanceBytes(STUDY, SERIES, '9.1', 'SEG')).rejects.toBeInstanceOf(
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
        const result = source.getInstanceBytes(STUDY, SERIES, '9.1', modality);
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
      await expect(source.getInstanceBytes(STUDY, SERIES, '9.1', 'SEG')).rejects.toMatchObject({
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
              ? new Response(JSON.stringify([instance('9.2', [0, 0, 0], 1)]))
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
      await source.getInstanceBytes(STUDY, SERIES, '9.2', 'SEG');
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
              ? new Response(JSON.stringify([instance('9.2', [0, 0, 0], 1)]))
              : new Response('{}', { status: 401 }),
          ),
      });
      const series = await source.getSeries(STUDY, SERIES);
      expect(series.instances).toHaveLength(1);
    });

    it('refreshes after a 401 on the series list as well', async () => {
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
              ? new Response('[]')
              : new Response('{}', { status: 401 }),
          ),
      });
      await expect(source.getStudy(STUDY)).resolves.toMatchObject({ series: [] });
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
              : new Response(JSON.stringify([instance('9.2', [0, 0, 0], 1)])),
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
      expect(frames?.owns('wadors:http://pacs/dicom-web/studies/1/x#other')).toBe(false);
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

  describe('getStudy', () => {
    const summary = (
      uid: string,
      number: number,
      modality: string,
      count?: number,
    ): Record<string, unknown> => ({
      '0020000D': { vr: 'UI', Value: [STUDY] },
      '0020000E': { vr: 'UI', Value: [uid] },
      '00080060': { vr: 'CS', Value: [modality] },
      '0008103E': { vr: 'LO', Value: [`Series ${uid}`] },
      '00200011': { vr: 'IS', Value: [number] },
      ...(count === undefined ? {} : { '00201209': { vr: 'IS', Value: [count] } }),
    });

    it('lists the series of a study, ordered by series number', async () => {
      const urls: string[] = [];
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs/wado/',
        fetch: (input) => {
          urls.push(typeof input === 'string' ? input : '');
          return Promise.resolve(
            new Response(JSON.stringify([summary('9.6', 2, 'SEG'), summary('9.5', 1, 'CT', 64)])),
          );
        },
      });

      const study = await source.getStudy(STUDY);

      expect(urls).toEqual([`http://pacs/wado/studies/${STUDY}/series`]);
      expect(study.studyInstanceUID).toBe(STUDY);
      expect(study.series).toEqual([
        {
          seriesInstanceUID: '9.5',
          modality: 'CT',
          description: 'Series 9.5',
          seriesNumber: 1,
          instanceCount: 64,
        },
        {
          seriesInstanceUID: '9.6',
          modality: 'SEG',
          description: 'Series 9.6',
          seriesNumber: 2,
          instanceCount: undefined,
        },
      ]);
    });

    it('searches at qidoRoot when the host gives one', async () => {
      const urls: string[] = [];
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs/wado',
        qidoRoot: 'http://pacs/qido',
        fetch: (input) => {
          urls.push(typeof input === 'string' ? input : '');
          return Promise.resolve(new Response('[]'));
        },
      });
      await source.getStudy(STUDY);
      expect(urls).toEqual([`http://pacs/qido/studies/${STUDY}/series`]);
    });

    it('rejects a series without a SeriesInstanceUID', async () => {
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        fetch: fetchReturning(200, [{ '00080060': { vr: 'CS', Value: ['CT'] } }]),
      });
      await expect(source.getStudy(STUDY)).rejects.toBeInstanceOf(DataSourceError);
    });

    it('reports a 404 for an unknown study with its status', async () => {
      const source = createDicomWebDataSource({
        wadoRoot: 'http://pacs',
        fetch: fetchReturning(404, {}),
      });
      await expect(source.getStudy(STUDY)).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe('UIDs from the host or a link', () => {
  const hostile = ['../../admin', '1.2/../3', '1.2?x=y', 'abc', ''];

  function neverFetches(): { source: DataSource; calls: () => number } {
    let calls = 0;
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response('[]'));
      },
    });
    return { source, calls: () => calls };
  }

  it.each(hostile)('refuses %j before it can reach a request path', async (uid) => {
    const { source, calls } = neverFetches();
    await expect(source.getStudy(uid)).rejects.toBeInstanceOf(DataSourceError);
    await expect(source.getSeries(STUDY, uid)).rejects.toBeInstanceOf(DataSourceError);
    await expect(source.getSeries(uid, SERIES)).rejects.toBeInstanceOf(DataSourceError);
    await expect(source.getInstanceBytes(STUDY, SERIES, uid, 'SEG')).rejects.toBeInstanceOf(
      DataSourceError,
    );
    expect(calls()).toBe(0);
  });

  it('refuses a series list entry whose UID is not a UID', async () => {
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: fetchReturning(200, [{ '0020000E': { vr: 'UI', Value: ['../x'] } }]),
    });
    await expect(source.getStudy(STUDY)).rejects.toBeInstanceOf(DataSourceError);
  });

  it('refuses an instance whose SOPInstanceUID is not a UID', async () => {
    const source = createDicomWebDataSource({
      wadoRoot: 'http://pacs',
      fetch: fetchReturning(200, [instance('../x', [0, 0, 0], 1)]),
    });
    await expect(source.getSeries(STUDY, SERIES)).rejects.toBeInstanceOf(DataSourceError);
  });
});
