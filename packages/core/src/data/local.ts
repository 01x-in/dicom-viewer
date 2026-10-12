import { DataSourceError } from './errors';
import { firstNumber, optionalString } from './dicom-json';
import { addLocalFile, removeLocalFile } from './local-files';
import { parseLocalInstance } from './local-parse';
import { buildSeries } from './series';
import type {
  DataSource,
  DicomJsonInstance,
  LoadedSeriesData,
  SeriesSummary,
  StudyData,
} from './types';
import { assertDicomUid, isDicomUid } from './uid';

export interface SkippedFile {
  readonly name: string;
  readonly reason: string;
}

export interface LocalFileDataSource extends DataSource {
  /** The studies found in the files, in the order they were first seen. */
  studyInstanceUIDs(): Promise<readonly string[]>;
  /** Files that were not used: not DICOM, unreadable, or a second copy of an instance. */
  skipped(): Promise<readonly SkippedFile[]>;
  /** Releases the files. The host calls this when it is done with the source: destroying the viewer does not. */
  dispose(): void;
}

interface Entry {
  readonly file: File;
  readonly metadata: DicomJsonInstance;
  readonly sopInstanceUID: string;
}

interface Index {
  /** study UID to series UID to instances. */
  readonly studies: Map<string, Map<string, Entry[]>>;
  readonly skipped: SkippedFile[];
}

const READ_CONCURRENCY = 8;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readEntry(file: File): Promise<{ study: string; series: string; entry: Entry }> {
  const metadata = parseLocalInstance(new Uint8Array(await file.arrayBuffer()));
  const study = optionalString(metadata, '0020000D');
  const series = optionalString(metadata, '0020000E');
  const sopInstanceUID = optionalString(metadata, '00080018');
  if (study === undefined || series === undefined || sopInstanceUID === undefined) {
    throw new DataSourceError('The file has no study, series, or SOP instance UID.');
  }
  if (![study, series, sopInstanceUID].every(isDicomUid)) {
    throw new DataSourceError('The file has a malformed UID.');
  }
  return { study, series, entry: { file, metadata, sopInstanceUID } };
}

async function indexFiles(files: readonly File[]): Promise<Index> {
  const results = new Array<{ study: string; series: string; entry: Entry } | SkippedFile>(
    files.length,
  );
  let cursor = 0;
  async function worker(): Promise<void> {
    for (let at = cursor++; at < files.length; at = cursor++) {
      const file = files[at];
      if (file === undefined) continue;
      try {
        results[at] = await readEntry(file);
      } catch (error) {
        results[at] = { name: file.name, reason: reasonOf(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));

  const studies = new Map<string, Map<string, Entry[]>>();
  const skipped: SkippedFile[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if ('reason' in result) {
      skipped.push(result);
      continue;
    }
    if (seen.has(result.entry.sopInstanceUID)) {
      skipped.push({
        name: result.entry.file.name,
        reason: 'A copy of this instance was already read.',
      });
      continue;
    }
    seen.add(result.entry.sopInstanceUID);
    const series = studies.get(result.study) ?? new Map<string, Entry[]>();
    studies.set(result.study, series);
    const entries = series.get(result.series) ?? [];
    series.set(result.series, entries);
    entries.push(result.entry);
  }
  return { studies, skipped };
}

function notFound(what: string): DataSourceError {
  return new DataSourceError(`The files contain no ${what}.`, 404);
}

/**
 * Reads DICOM Part 10 files the user picked or dropped (a folder, or `<input type=file multiple>`).
 * Headers are parsed on first use; pixel data is read later, by the engine, when a slice is shown.
 */
export function createLocalFileDataSource(files: readonly File[]): LocalFileDataSource {
  let index: Promise<Index> | undefined;
  const lookup = (): Promise<Index> => (index ??= indexFiles(files));
  const allocated: string[] = [];
  const imageIds = new Map<File, string>();

  function imageIdFor(file: File): string {
    let imageId = imageIds.get(file);
    if (imageId === undefined) {
      imageId = addLocalFile(file);
      imageIds.set(file, imageId);
      allocated.push(imageId);
    }
    return imageId;
  }

  async function seriesEntries(study: string, series: string): Promise<Entry[]> {
    assertDicomUid(study, 'StudyInstanceUID');
    assertDicomUid(series, 'SeriesInstanceUID');
    const found = (await lookup()).studies.get(study);
    if (found === undefined) throw notFound(`study ${study}`);
    const entries = found.get(series);
    if (entries === undefined) throw notFound(`series ${series}`);
    return entries;
  }

  return {
    capabilities: { instanceRetrieve: 'all' },
    frameRequests: undefined,
    async studyInstanceUIDs(): Promise<readonly string[]> {
      return [...(await lookup()).studies.keys()];
    },
    async skipped(): Promise<readonly SkippedFile[]> {
      return (await lookup()).skipped;
    },
    async getStudy(studyInstanceUID): Promise<StudyData> {
      assertDicomUid(studyInstanceUID, 'StudyInstanceUID');
      const found = (await lookup()).studies.get(studyInstanceUID);
      if (found === undefined) throw notFound(`study ${studyInstanceUID}`);
      const series = [...found.entries()].map(([seriesInstanceUID, entries]): SeriesSummary => {
        const [first] = entries;
        return {
          seriesInstanceUID,
          modality: (first && optionalString(first.metadata, '00080060')) ?? 'OT',
          description: first && optionalString(first.metadata, '0008103E'),
          seriesNumber: first && firstNumber(first.metadata, '00200011'),
          instanceCount: entries.length,
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
      const entries = await seriesEntries(studyInstanceUID, seriesInstanceUID);
      const byMetadata = new Map(entries.map((entry) => [entry.metadata, entry.file]));
      return buildSeries({
        studyInstanceUID,
        seriesInstanceUID,
        metadata: entries.map((entry) => entry.metadata),
        imageIdFor: (_sop, metadata) => {
          const file = byMetadata.get(metadata);
          if (file === undefined) throw new DataSourceError('Instance metadata lost its file.');
          return imageIdFor(file);
        },
      });
    },
    async getInstanceBytes(
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
    ): Promise<ArrayBuffer> {
      assertDicomUid(sopInstanceUID, 'SOPInstanceUID');
      const entries = await seriesEntries(studyInstanceUID, seriesInstanceUID);
      const entry = entries.find((candidate) => candidate.sopInstanceUID === sopInstanceUID);
      if (entry === undefined) throw notFound(`instance ${sopInstanceUID}`);
      return entry.file.arrayBuffer();
    },
    dispose(): void {
      for (const imageId of allocated.splice(0)) removeLocalFile(imageId);
      imageIds.clear();
    },
  };
}
