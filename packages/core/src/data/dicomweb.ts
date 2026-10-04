import { z } from 'zod';
import { firstNumber, optionalString } from './dicom-json';
import { DataSourceError } from './errors';
import { extractFirstPart } from './multipart';
import { createRequester, type RequesterOptions } from './request';
import { buildSeries } from './series';
import { assertDicomUid } from './uid';
import type {
  DataSource,
  DataSourceCapabilities,
  LoadedSeriesData,
  ResolvedCapabilities,
  SeriesSummary,
  StudyData,
} from './types';

export interface DicomWebDataSourceOptions extends RequesterOptions {
  readonly wadoRoot: string;
  /** Where series are listed (QIDO-RS). Defaults to `wadoRoot`. */
  readonly qidoRoot?: string;
  readonly capabilities?: DataSourceCapabilities;
}

const dicomJsonElement = z.object({ vr: z.string(), Value: z.array(z.unknown()).optional() });
const dicomJsonInstance = z.record(z.string(), dicomJsonElement);
const seriesMetadata = z.array(dicomJsonInstance).min(1);
const seriesList = z.array(dicomJsonInstance);

function trimTrailingSlash(root: string): string {
  return root.endsWith('/') ? root.slice(0, -1) : root;
}

/**
 * The single-frame image id the `wadors` loader understands. An `owner` is appended as a URL
 * fragment, which is never sent to the server, so the frame loader can tell whose request a frame
 * is when two sources share a root.
 */
export function frameImageId(
  wadoRoot: string,
  studyUid: string,
  seriesUid: string,
  sopUid: string,
  owner?: string,
): string {
  const root = trimTrailingSlash(wadoRoot);
  const base = `wadors:${root}/studies/${studyUid}/series/${seriesUid}/instances/${sopUid}/frames/1`;
  return owner === undefined ? base : `${base}#${owner}`;
}

let sourceCount = 0;

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
  const qidoRoot = trimTrailingSlash(options.qidoRoot ?? options.wadoRoot);
  sourceCount += 1;
  const owner = `dv-source-${sourceCount.toString()}`;
  const capabilities: ResolvedCapabilities = {
    instanceRetrieve: options.capabilities?.instanceRetrieve ?? 'seg-sr-only',
  };

  return {
    capabilities,
    frameRequests: {
      owns: (imageId) => imageId.startsWith(`wadors:${root}/`) && imageId.endsWith(`#${owner}`),
      headers: (request) => requester.headers(request),
      generation: () => requester.generation(),
      refresh: (request, sentAt) => requester.refresh(request, sentAt),
    },
    async getStudy(studyInstanceUID): Promise<StudyData> {
      assertDicomUid(studyInstanceUID, 'StudyInstanceUID');
      // QIDO is used at series level only, and always scoped to one study: the OncoTrace proxy
      // rejects unfiltered searches.
      const response = await requester.get(
        `${qidoRoot}/studies/${studyInstanceUID}/series`,
        'application/dicom+json',
      );
      const parsed = seriesList.safeParse(await readJson(response));
      if (!parsed.success) {
        throw new DataSourceError(`The series list is not DICOM JSON: ${parsed.error.message}`);
      }
      const series = parsed.data.map((item): SeriesSummary => {
        const seriesInstanceUID = optionalString(item, '0020000E');
        if (seriesInstanceUID === undefined) {
          throw new DataSourceError('A series in the list has no SeriesInstanceUID.');
        }
        assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
        return {
          seriesInstanceUID,
          modality: optionalString(item, '00080060') ?? 'OT',
          description: optionalString(item, '0008103E'),
          seriesNumber: firstNumber(item, '00200011'),
          instanceCount: firstNumber(item, '00201209'),
        };
      });
      series.sort(
        (a, b) =>
          (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) -
            (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
          a.seriesInstanceUID.localeCompare(b.seriesInstanceUID),
      );
      return { studyInstanceUID, series };
    },
    async getSeries(studyInstanceUID, seriesInstanceUID): Promise<LoadedSeriesData> {
      assertDicomUid(studyInstanceUID, 'StudyInstanceUID');
      assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
      const url = `${root}/studies/${studyInstanceUID}/series/${seriesInstanceUID}/metadata`;
      const response = await requester.get(url, 'application/dicom+json');
      const parsed = seriesMetadata.safeParse(await readJson(response));
      if (!parsed.success) {
        throw new DataSourceError(`Series metadata is not DICOM JSON: ${parsed.error.message}`);
      }
      return buildSeries({
        studyInstanceUID,
        seriesInstanceUID,
        metadata: parsed.data,
        imageIdFor: (sopInstanceUID) => {
          assertDicomUid(sopInstanceUID, 'SOPInstanceUID');
          return frameImageId(root, studyInstanceUID, seriesInstanceUID, sopInstanceUID, owner);
        },
      });
    },
    async getInstanceBytes(
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
      modality,
    ): Promise<ArrayBuffer> {
      assertDicomUid(studyInstanceUID, 'StudyInstanceUID');
      assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
      assertDicomUid(sopInstanceUID, 'SOPInstanceUID');
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
