import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type FixtureStore,
  type InstanceRecord,
  loadFixtures,
  type SeriesRecord,
} from './fixtures.ts';

/**
 * - `open`: every route this server implements works.
 * - `oncotrace-proxy`: reproduces the restrictions of the OncoTrace DICOMweb proxy that the
 *   viewer must live with (see docs/plan.md, "Context").
 */
export type MockMode = 'open' | 'oncotrace-proxy';

export interface MockServerOptions {
  readonly fixturesDir: string;
  readonly mode: MockMode;
  /** 0 picks a free port. */
  readonly port?: number;
}

export interface RequestLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

export interface MockServer {
  readonly url: string;
  readonly mode: MockMode;
  readonly fixtures: FixtureStore;
  /** Every request served, newest last. Tests may clear it with `length = 0`. */
  readonly requestLog: RequestLogEntry[];
  close(): Promise<void>;
}

export const MAX_FRAMES_PER_REQUEST = 16;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, accept, content-type',
  'access-control-expose-headers': 'content-type, content-length',
};

const MEDIA_TYPE_BY_TRANSFER_SYNTAX: Record<string, string> = {
  '1.2.840.10008.1.2.4.90': 'image/jp2',
  '1.2.840.10008.1.2.4.91': 'image/jp2',
  '1.2.840.10008.1.2.4.50': 'image/jpeg',
  '1.2.840.10008.1.2.4.51': 'image/jpeg',
  '1.2.840.10008.1.2.4.70': 'image/jll',
  '1.2.840.10008.1.2.4.80': 'image/jls',
  '1.2.840.10008.1.2.4.81': 'image/jls',
  '1.2.840.10008.1.2.5': 'image/x-dicom-rle',
};

class HttpProblem extends Error {
  readonly status: number;
  readonly title: string;
  constructor(status: number, title: string, detail: string) {
    super(detail);
    this.status = status;
    this.title = title;
  }
}

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string | Buffer;
}

function problemReply(problem: HttpProblem): Reply {
  return {
    status: problem.status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/problem+json' },
    body: JSON.stringify({
      type: 'about:blank',
      title: problem.title,
      status: problem.status,
      detail: problem.message,
    }),
  };
}

function jsonReply(body: unknown): Reply {
  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'content-type': 'application/dicom+json' },
    body: JSON.stringify(body),
  };
}

function seriesSummary(series: SeriesRecord): Record<string, unknown> {
  const first = series.instances[0];
  return {
    '0020000D': { vr: 'UI', Value: [series.studyUid] },
    '0020000E': { vr: 'UI', Value: [series.seriesUid] },
    '00080060': { vr: 'CS', Value: [series.modality] },
    '0008103E': { vr: 'LO', Value: [series.description] },
    '00200011': first?.metadata['00200011'] ?? { vr: 'IS' },
    '00201209': { vr: 'IS', Value: [series.instances.length] },
  };
}

function studySummary(studyUid: string, store: FixtureStore): Record<string, unknown> {
  return {
    '0020000D': { vr: 'UI', Value: [studyUid] },
    '00201206': {
      vr: 'IS',
      Value: [store.series.filter((series) => series.studyUid === studyUid).length],
    },
  };
}

function multipartFrames(
  instance: InstanceRecord,
  frameNumbers: readonly number[],
): { contentType: string; body: Buffer } {
  const boundary = `dicomweb-mock-${randomUUID()}`;
  const mediaType =
    MEDIA_TYPE_BY_TRANSFER_SYNTAX[instance.transferSyntax] ?? 'application/octet-stream';
  const chunks: Buffer[] = [];
  for (const frameNumber of frameNumbers) {
    const frame = instance.frames[frameNumber - 1];
    if (frame === undefined) {
      throw new HttpProblem(
        404,
        'Frame not found',
        `Instance ${instance.sopUid} has no frame ${frameNumber.toString()}.`,
      );
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Type: ${mediaType}; transfer-syntax=${instance.transferSyntax}\r\n\r\n`,
        'latin1',
      ),
      Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength),
      Buffer.from('\r\n', 'latin1'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));
  return {
    contentType: `multipart/related; type="${mediaType}"; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

function parseFrameList(raw: string): number[] {
  const frames = raw.split(',').map((part) => Number(part));
  if (frames.some((frame) => !Number.isInteger(frame) || frame < 1)) {
    throw new HttpProblem(400, 'Bad frame list', `"${raw}" is not a list of frame numbers.`);
  }
  return frames;
}

interface Router {
  handle(url: URL): Reply;
}

function createRouter(store: FixtureStore, mode: MockMode): Router {
  const proxy = mode === 'oncotrace-proxy';

  function requireSeries(studyUid: string, seriesUid: string): SeriesRecord {
    const series = store.findSeries(studyUid, seriesUid);
    if (series === undefined) {
      throw new HttpProblem(
        404,
        'Series not found',
        `No series ${seriesUid} in study ${studyUid}.`,
      );
    }
    return series;
  }

  function requireInstance(series: SeriesRecord, sopUid: string): InstanceRecord {
    const instance = series.instances.find((candidate) => candidate.sopUid === sopUid);
    if (instance === undefined) {
      throw new HttpProblem(404, 'Instance not found', `No instance ${sopUid} in this series.`);
    }
    return instance;
  }

  function forbidden(what: string): HttpProblem {
    return new HttpProblem(
      403,
      'Forbidden',
      `${what} is not available through the OncoTrace proxy. Retrieve frames instead.`,
    );
  }

  return {
    handle(url): Reply {
      const segments = url.pathname.split('/').filter((segment) => segment !== '');
      const [root, studyUid, kind, seriesUid, kind2, sopUid, kind3, frames] = segments;

      if (root === 'studies' && studyUid === undefined) {
        if (proxy && !url.searchParams.has('StudyInstanceUID')) {
          throw new HttpProblem(400, 'Missing filter', 'Study search requires StudyInstanceUID.');
        }
        const filter = url.searchParams.get('StudyInstanceUID');
        const uids = store.studyUids.filter((uid) => filter === null || uid === filter);
        return jsonReply(uids.map((uid) => studySummary(uid, store)));
      }

      if (root === 'series' && studyUid === undefined) {
        const filter = url.searchParams.get('StudyInstanceUID');
        if (proxy && filter === null) {
          throw new HttpProblem(400, 'Missing filter', 'Series search requires StudyInstanceUID.');
        }
        return jsonReply(
          store.series
            .filter((series) => filter === null || series.studyUid === filter)
            .map(seriesSummary),
        );
      }

      if (root !== 'studies' || studyUid === undefined) {
        throw new HttpProblem(404, 'Not found', `No route for ${url.pathname}.`);
      }

      if (kind === undefined) {
        if (proxy) throw forbidden('Whole-study retrieval');
        throw new HttpProblem(501, 'Not implemented', 'Study retrieval is not implemented.');
      }
      if (kind !== 'series')
        throw new HttpProblem(404, 'Not found', `No route for ${url.pathname}.`);

      if (seriesUid === undefined) {
        return jsonReply(
          store.series.filter((series) => series.studyUid === studyUid).map(seriesSummary),
        );
      }

      const series = requireSeries(studyUid, seriesUid);

      if (kind2 === undefined) {
        if (proxy) throw forbidden('Whole-series retrieval');
        throw new HttpProblem(501, 'Not implemented', 'Series retrieval is not implemented.');
      }
      if (kind2 === 'metadata') {
        return jsonReply(series.instances.map((instance) => instance.metadata));
      }
      if (kind2 !== 'instances')
        throw new HttpProblem(404, 'Not found', `No route for ${url.pathname}.`);
      if (sopUid === undefined) {
        throw new HttpProblem(501, 'Not implemented', 'Instance search is not implemented.');
      }

      const instance = requireInstance(series, sopUid);

      if (kind3 === undefined) {
        // The proxy hands out whole instances only for SEG and SR.
        if (proxy && instance.modality !== 'SEG' && instance.modality !== 'SR') {
          throw forbidden('Whole-instance retrieval of this modality');
        }
        const boundary = `dicomweb-mock-${randomUUID()}`;
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`, 'latin1'),
          Buffer.from(instance.file.buffer, instance.file.byteOffset, instance.file.byteLength),
          Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
        ]);
        return {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'content-type': `multipart/related; type="application/dicom"; boundary=${boundary}`,
          },
          body,
        };
      }
      if (kind3 === 'metadata') return jsonReply([instance.metadata]);
      if (kind3 === 'frames' && frames !== undefined) {
        const frameNumbers = parseFrameList(frames);
        if (proxy && frameNumbers.length > MAX_FRAMES_PER_REQUEST) {
          throw new HttpProblem(
            400,
            'Too many frames',
            `The proxy allows at most ${MAX_FRAMES_PER_REQUEST.toString()} frames per request.`,
          );
        }
        const { contentType, body } = multipartFrames(instance, frameNumbers);
        return { status: 200, headers: { ...CORS_HEADERS, 'content-type': contentType }, body };
      }
      throw new HttpProblem(404, 'Not found', `No route for ${url.pathname}.`);
    },
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export async function startMockServer(options: MockServerOptions): Promise<MockServer> {
  const fixtures = await loadFixtures(options.fixturesDir);
  const router = createRouter(fixtures, options.mode);
  const requestLog: RequestLogEntry[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.on('finish', () => {
      if (method !== 'OPTIONS') {
        requestLog.push({ method, path: url.pathname, status: response.statusCode });
      }
    });
    let reply: Reply;
    if (method === 'OPTIONS') {
      reply = { status: 204, headers: CORS_HEADERS, body: '' };
    } else if (method !== 'GET') {
      reply = problemReply(
        new HttpProblem(405, 'Method not allowed', `${method} is not supported.`),
      );
    } else {
      try {
        reply = router.handle(url);
      } catch (error) {
        if (!(error instanceof HttpProblem)) throw error;
        reply = problemReply(error);
      }
    }
    response.writeHead(reply.status, reply.headers);
    response.end(reply.body);
  });

  const port = await listen(server, options.port ?? 0);
  return {
    url: `http://127.0.0.1:${port.toString()}`,
    mode: options.mode,
    fixtures,
    requestLog,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      }),
  };
}
