import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MockServer, startMockServer } from './server.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/phantom', import.meta.url));
const J2K_TS = '1.2.840.10008.1.2.4.90';
const EVRLE_TS = '1.2.840.10008.1.2.1';

interface Ids {
  study: string;
  j2k: string;
  evrle: string;
  j2kSop: string;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

function firstValue(item: unknown, tag: string): string {
  if (typeof item !== 'object' || item === null) throw new Error('not an object');
  const element: unknown = Reflect.get(item, tag);
  if (typeof element !== 'object' || element === null) throw new Error(`missing ${tag}`);
  const values: unknown = Reflect.get(element, 'Value');
  if (!Array.isArray(values)) throw new Error(`no Value in ${tag}`);
  const value: unknown = values[0];
  if (typeof value !== 'string') throw new Error(`${tag} is not a string`);
  return value;
}

async function discover(server: MockServer): Promise<Ids> {
  const study = server.fixtures.studyUids[0];
  if (study === undefined) throw new Error('no study in fixtures');
  const { body } = await getJson(`${server.url}/studies/${study}/series`);
  if (!Array.isArray(body)) throw new Error('series search did not return an array');
  const byDescription = new Map<string, string>();
  for (const item of body) {
    byDescription.set(firstValue(item, '0008103E'), firstValue(item, '0020000E'));
  }
  const j2k = byDescription.get('Phantom CT (ct-j2k)');
  const evrle = byDescription.get('Phantom CT (ct-evrle)');
  if (j2k === undefined || evrle === undefined) throw new Error('phantom series missing');
  const metadata = await getJson(`${server.url}/studies/${study}/series/${j2k}/metadata`);
  if (!Array.isArray(metadata.body)) throw new Error('metadata is not an array');
  return { study, j2k, evrle, j2kSop: firstValue(metadata.body[0], '00080018') };
}

function partsOf(buffer: Uint8Array, boundary: string): Uint8Array[] {
  const text = new TextDecoder('latin1').decode(buffer);
  const marker = `--${boundary}`;
  const parts: Uint8Array[] = [];
  let cursor = text.indexOf(marker);
  while (cursor !== -1) {
    const afterMarker = cursor + marker.length;
    if (text.startsWith('--', afterMarker)) break;
    const headerEnd = text.indexOf('\r\n\r\n', afterMarker);
    const next = text.indexOf(`\r\n${marker}`, headerEnd);
    parts.push(buffer.subarray(headerEnd + 4, next));
    cursor = next + 2;
  }
  return parts;
}

describe('dicomweb-mock (open mode)', () => {
  let server: MockServer;
  let ids: Ids;

  beforeAll(async () => {
    server = await startMockServer({ fixturesDir: FIXTURES, mode: 'open', port: 0 });
    ids = await discover(server);
  });
  afterAll(async () => {
    await server.close();
  });

  it('serves the J2K phantom as a 64-instance series with metadata', async () => {
    const { status, body } = await getJson(
      `${server.url}/studies/${ids.study}/series/${ids.j2k}/metadata`,
    );
    expect(status).toBe(200);
    expect(body).toHaveLength(64);
  });

  it('keeps pixel data out of metadata and includes the transfer syntax', async () => {
    const { body } = await getJson(`${server.url}/studies/${ids.study}/series/${ids.j2k}/metadata`);
    if (!Array.isArray(body)) throw new Error('expected array');
    const first: unknown = body[0];
    expect(Reflect.has(first as object, '7FE00010')).toBe(false);
    expect(firstValue(first, '00020010')).toBe(J2K_TS);
  });

  it('returns a J2K frame as multipart/related with the transfer syntax in the part header', async () => {
    const response = await fetch(
      `${server.url}/studies/${ids.study}/series/${ids.j2k}/instances/${ids.j2kSop}/frames/1`,
      {
        headers: { Accept: 'multipart/related; type=application/octet-stream; transfer-syntax=*' },
      },
    );
    expect(response.status).toBe(200);
    const contentType = response.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/^multipart\/related/);
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
    expect(boundary).toBeDefined();
    const body = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder('latin1').decode(body.subarray(0, 300));
    expect(text).toContain(`transfer-syntax=${J2K_TS}`);
    const [frame] = partsOf(body, boundary ?? '');
    // A JPEG 2000 codestream starts with the SOC and SIZ markers.
    expect(frame?.slice(0, 4)).toEqual(Uint8Array.from([0xff, 0x4f, 0xff, 0x51]));
  });

  it('returns uncompressed frames at 128*128*2 bytes', async () => {
    const meta = await getJson(`${server.url}/studies/${ids.study}/series/${ids.evrle}/metadata`);
    if (!Array.isArray(meta.body)) throw new Error('expected array');
    const sop = firstValue(meta.body[0], '00080018');
    const response = await fetch(
      `${server.url}/studies/${ids.study}/series/${ids.evrle}/instances/${sop}/frames/1`,
    );
    const contentType = response.headers.get('content-type') ?? '';
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1] ?? '';
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder('latin1').decode(body.subarray(0, 300))).toContain(
      `transfer-syntax=${EVRLE_TS}`,
    );
    expect(partsOf(body, boundary)[0]?.byteLength).toBe(128 * 128 * 2);
  });

  it('answers CORS preflights and exposes headers', async () => {
    const response = await fetch(`${server.url}/studies`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects an unknown series with an RFC 7807 problem', async () => {
    const response = await fetch(`${server.url}/studies/${ids.study}/series/9.9.9/metadata`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ status: 404, title: expect.any(String) as unknown });
  });
});

describe('dicomweb-mock (oncotrace-proxy mode)', () => {
  let server: MockServer;
  let ids: Ids;

  beforeAll(async () => {
    server = await startMockServer({
      fixturesDir: FIXTURES,
      mode: 'oncotrace-proxy',
      port: 0,
    });
    ids = await discover(server);
  });
  afterAll(async () => {
    await server.close();
  });

  it('requires a StudyInstanceUID filter on series search', async () => {
    expect((await fetch(`${server.url}/series`)).status).toBe(400);
    const ok = await fetch(`${server.url}/series?StudyInstanceUID=${ids.study}`);
    expect(ok.status).toBe(200);
  });

  it('forbids whole-study and whole-series retrieval', async () => {
    expect((await fetch(`${server.url}/studies/${ids.study}`)).status).toBe(403);
    expect((await fetch(`${server.url}/studies/${ids.study}/series/${ids.j2k}`)).status).toBe(403);
  });

  it('forbids whole-instance retrieval of CT', async () => {
    const url = `${server.url}/studies/${ids.study}/series/${ids.j2k}/instances/${ids.j2kSop}`;
    expect((await fetch(url)).status).toBe(403);
  });

  it('serves series metadata and frames', async () => {
    const metadata = await getJson(`${server.url}/studies/${ids.study}/series/${ids.j2k}/metadata`);
    expect(metadata.status).toBe(200);
    const frame = await fetch(
      `${server.url}/studies/${ids.study}/series/${ids.j2k}/instances/${ids.j2kSop}/frames/1`,
    );
    expect(frame.status).toBe(200);
  });

  it('allows at most 16 frames per request', async () => {
    const base = `${server.url}/studies/${ids.study}/series/${ids.j2k}/instances/${ids.j2kSop}/frames`;
    const sixteen = Array.from({ length: 16 }, (_, index) => index + 1).join(',');
    const seventeen = Array.from({ length: 17 }, (_, index) => index + 1).join(',');
    // The phantom instances are single-frame, so frame 2+ does not exist: the limit is checked first.
    expect((await fetch(`${base}/${seventeen}`)).status).toBe(400);
    expect((await fetch(`${base}/${sixteen}`)).status).toBe(404);
  });

  it('records requests so tests can assert what a client asked for', async () => {
    server.requestLog.length = 0;
    await fetch(`${server.url}/studies/${ids.study}`);
    expect(server.requestLog).toEqual([
      { method: 'GET', path: `/studies/${ids.study}`, status: 403 },
    ]);
  });
});

describe('dicomweb-mock (auth and faults)', () => {
  let server: MockServer;
  let study: string;

  beforeAll(async () => {
    server = await startMockServer({
      fixturesDir: FIXTURES,
      mode: 'oncotrace-proxy',
      port: 0,
      auth: true,
    });
    const [first] = server.fixtures.studyUids;
    if (first === undefined) throw new Error('no study in fixtures');
    study = first;
  });
  afterAll(async () => {
    await server.close();
  });

  const seriesUrl = (): string => `${server.url}/studies/${study}/series`;

  it('answers 401 without a token, and with one that was not accepted', async () => {
    expect((await fetch(seriesUrl())).status).toBe(401);
    const bad = await fetch(seriesUrl(), { headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('content-type')).toMatch(/^application\/problem\+json/);
  });

  it('accepts a token until it is revoked, which is how an expiry looks to the client', async () => {
    server.auth.accept('t1');
    const headers = { Authorization: 'Bearer t1' };
    expect((await fetch(seriesUrl(), { headers })).status).toBe(200);
    server.auth.revoke('t1');
    expect((await fetch(seriesUrl(), { headers })).status).toBe(401);
  });

  it('still answers CORS preflights without a token', async () => {
    const response = await fetch(seriesUrl(), {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    expect(response.status).toBe(204);
  });

  it('fails the next requests with an injected status, then recovers', async () => {
    server.auth.accept('t2');
    const headers = { Authorization: 'Bearer t2' };
    server.failNext(503, 2);
    expect((await fetch(seriesUrl(), { headers })).status).toBe(503);
    expect((await fetch(seriesUrl(), { headers })).status).toBe(503);
    expect((await fetch(seriesUrl(), { headers })).status).toBe(200);
  });
});

describe('jsonFiles', () => {
  it('serves a file as JSON, with CORS, and leaves other paths alone', async () => {
    const file = fileURLToPath(new URL('../package.json', import.meta.url));
    const server = await startMockServer({
      fixturesDir: FIXTURES,
      mode: 'oncotrace-proxy',
      jsonFiles: { '/viewer-config.json': file },
    });
    try {
      const response = await fetch(`${server.url}/viewer-config.json`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      const body: unknown = await response.json();
      expect(body).toHaveProperty('name');
      expect((await fetch(`${server.url}/other.json`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
