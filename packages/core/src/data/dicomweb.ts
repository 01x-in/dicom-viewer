import { z } from 'zod';
import { DataSourceError } from './errors';
import { extractFirstPart } from './multipart';
import { createRequester, type RequesterOptions } from './request';
import type {
  DataSource,
  DataSourceCapabilities,
  DicomJsonInstance,
  LoadedSeriesData,
  ResolvedCapabilities,
  SeriesInstance,
} from './types';

export interface DicomWebDataSourceOptions extends RequesterOptions {
  readonly wadoRoot: string;
  readonly capabilities?: DataSourceCapabilities;
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

const WHOLE_INSTANCE_MODALITIES: ReadonlySet<string> = new Set(['SEG', 'SR']);

export function createDicomWebDataSource(options: DicomWebDataSourceOptions): DataSource {
  const requester = createRequester(options);
  const root = trimTrailingSlash(options.wadoRoot);
  const capabilities: ResolvedCapabilities = {
    instanceRetrieve: options.capabilities?.instanceRetrieve ?? 'seg-sr-only',
  };

  return {
    capabilities,
    frameRequests: {
      imageIdPrefix: `wadors:${root}/`,
      headers: (request) => requester.headers(request),
      generation: () => requester.generation(),
      refresh: (request, sentAt) => requester.refresh(request, sentAt),
    },
    async getSeries(studyInstanceUID, seriesInstanceUID): Promise<LoadedSeriesData> {
      const url = `${root}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/metadata`;
      const response = await requester.get(url, 'application/dicom+json');
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
      modality,
    ): Promise<ArrayBuffer> {
      const allowed =
        capabilities.instanceRetrieve === 'all' ||
        (capabilities.instanceRetrieve === 'seg-sr-only' &&
          WHOLE_INSTANCE_MODALITIES.has(modality));
      if (!allowed) {
        throw new DataSourceError(
          `Whole-instance retrieval of ${modality} is not allowed by this source (instanceRetrieve: ${capabilities.instanceRetrieve}).`,
        );
      }
      const url = `${root}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/instances/${sopInstanceUID}`;
      const response = await requester.get(url, 'multipart/related; type="application/dicom"');
      const body = new Uint8Array(await response.arrayBuffer());
      const part = extractFirstPart(response.headers.get('content-type') ?? '', body);
      return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;
    },
  };
}
