import { z } from 'zod';
import { DataSourceError } from './errors';
import { extractFirstPart } from './multipart';
import type { DataSource, DicomJsonInstance, LoadedSeriesData, SeriesInstance } from './types';

export interface DicomWebDataSourceOptions {
  readonly wadoRoot: string;
  /** Injected for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

const dicomJsonElement = z.object({ vr: z.string(), Value: z.array(z.unknown()).optional() });
const dicomJsonInstance = z.record(z.string(), dicomJsonElement);
const seriesMetadata = z.array(dicomJsonInstance).min(1);

function trimTrailingSlash(root: string): string {
  return root.endsWith('/') ? root.slice(0, -1) : root;
}

/** The single-frame image id the `wadors` loader understands. */
export function frameImageId(
  wadoRoot: string,
  studyUid: string,
  seriesUid: string,
  sopUid: string,
): string {
  const root = trimTrailingSlash(wadoRoot);
  return `wadors:${root}/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/frames/1`;
}

type Vec3 = readonly [number, number, number];

/** DS and IS values may arrive as numbers or as numeric strings in DICOM JSON; blanks are dropped. */
function numbers(metadata: DicomJsonInstance, tag: string): number[] {
  const values = metadata[tag]?.Value ?? [];
  return values.flatMap((value) => {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN;
    return Number.isFinite(parsed) ? [parsed] : [];
  });
}

function requiredString(metadata: DicomJsonInstance, tag: string): string {
  const value = metadata[tag]?.Value?.[0];
  if (typeof value !== 'string') {
    throw new DataSourceError(`Instance metadata is missing ${tag}.`);
  }
  return value;
}

function triple(values: number[], offset: number): Vec3 | undefined {
  const [x, y, z] = values.slice(offset, offset + 3);
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Orders slices by their position projected on the slice normal (row x column direction).
 * Instance numbers are not trusted: they are frequently wrong or missing.
 */
function sortAlongNormal(instances: SeriesInstance[]): SeriesInstance[] {
  const first = instances[0];
  const orientation = first === undefined ? [] : numbers(first.metadata, '00200037');
  const row = triple(orientation, 0);
  const column = triple(orientation, 3);
  if (row === undefined || column === undefined) return instances;
  const normal = cross(row, column);
  const keyed = instances.map((instance) => {
    const position = triple(numbers(instance.metadata, '00200032'), 0);
    return { instance, key: position === undefined ? 0 : dot(position, normal) };
  });
  return keyed.sort((a, b) => a.key - b.key).map((entry) => entry.instance);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DataSourceError('The server did not return JSON.', response.status);
  }
}

export function createDicomWebDataSource(options: DicomWebDataSourceOptions): DataSource {
  const rawFetch = options.fetch ?? ((input, init) => fetch(input, init));
  // Network, CORS, and abort failures reject with native errors; callers only handle DataSourceError.
  const doFetch: typeof fetch = async (input, init) => {
    try {
      return await rawFetch(input, init);
    } catch (error) {
      if (error instanceof DataSourceError) throw error;
      throw new DataSourceError(
        `The DICOMweb request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const root = trimTrailingSlash(options.wadoRoot);

  return {
    async getSeries(studyInstanceUID, seriesInstanceUID): Promise<LoadedSeriesData> {
      const url = `${root}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/metadata`;
      const response = await doFetch(url, { headers: { Accept: 'application/dicom+json' } });
      // 403 and 404 are final. Retrying belongs in the real client (M2), and never for these.
      if (!response.ok) {
        throw new DataSourceError(
          `Series metadata request failed with HTTP ${response.status.toString()}.`,
          response.status,
        );
      }
      const parsed = seriesMetadata.safeParse(await readJson(response));
      if (!parsed.success) {
        throw new DataSourceError(`Series metadata is not DICOM JSON: ${parsed.error.message}`);
      }
      const instances = parsed.data.map((metadata): SeriesInstance => {
        const sopInstanceUID = requiredString(metadata, '00080018');
        const instanceNumber = numbers(metadata, '00200013')[0];
        return {
          sopInstanceUID,
          instanceNumber,
          imageId: frameImageId(root, studyInstanceUID, seriesInstanceUID, sopInstanceUID),
          metadata,
        };
      });
      const sorted = sortAlongNormal(instances);
      return {
        studyInstanceUID,
        seriesInstanceUID,
        instances: sorted,
        imageIds: sorted.map((instance) => instance.imageId),
      };
    },
    async getInstanceBytes(
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
    ): Promise<ArrayBuffer> {
      const url = `${root}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/instances/${sopInstanceUID}`;
      const response = await doFetch(url, {
        headers: { Accept: 'multipart/related; type="application/dicom"' },
      });
      if (!response.ok) {
        throw new DataSourceError(
          `Instance retrieval failed with HTTP ${response.status.toString()}.`,
          response.status,
        );
      }
      const body = new Uint8Array(await response.arrayBuffer());
      const part = extractFirstPart(response.headers.get('content-type') ?? '', body);
      return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;
    },
  };
}
