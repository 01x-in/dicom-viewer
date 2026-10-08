import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { data, type DicomJson } from 'dcmjs';

const PIXEL_DATA = '7FE00010';
const TRANSFER_SYNTAX_UID = '00020010';

export interface InstanceRecord {
  readonly studyUid: string;
  readonly seriesUid: string;
  readonly sopUid: string;
  readonly modality: string;
  readonly transferSyntax: string;
  readonly instanceNumber: number;
  /** DICOMweb JSON metadata: no bulk data, but with the transfer syntax from the file meta. */
  readonly metadata: DicomJson;
  /** Encoded bytes of each frame, exactly as they are stored in the file. */
  readonly frames: readonly Uint8Array[];
  /** The whole Part 10 file, for whole-instance retrieval. */
  readonly file: Uint8Array;
}

export interface SeriesRecord {
  readonly studyUid: string;
  readonly seriesUid: string;
  readonly modality: string;
  readonly description: string;
  readonly instances: readonly InstanceRecord[];
}

export interface FixtureStore {
  readonly studyUids: readonly string[];
  readonly series: readonly SeriesRecord[];
  findSeries(studyUid: string, seriesUid: string): SeriesRecord | undefined;
}

function stringValue(json: DicomJson, tag: string): string {
  const value = json[tag]?.Value?.[0];
  if (typeof value !== 'string') throw new Error(`DICOM tag ${tag} is missing or not a string`);
  return value;
}

function numberValue(json: DicomJson, tag: string): number {
  const value = json[tag]?.Value?.[0];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  throw new Error(`DICOM tag ${tag} is missing or not numeric`);
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function toMetadata(dict: DicomJson, transferSyntax: string): DicomJson {
  const metadata: DicomJson = {};
  for (const [tag, element] of Object.entries(dict)) {
    if (tag === PIXEL_DATA) continue;
    if (element.Value?.some(isArrayBuffer) === true) continue;
    metadata[tag] = element;
  }
  metadata[TRANSFER_SYNTAX_UID] = { vr: 'UI', Value: [transferSyntax] };
  return metadata;
}

function splitFrames(dict: DicomJson, numberOfFrames: number, encapsulated: boolean): Uint8Array[] {
  const fragments = (dict[PIXEL_DATA]?.Value ?? []).filter(isArrayBuffer);
  if (fragments.length === 0) throw new Error('instance has no pixel data');
  if (encapsulated) {
    if (fragments.length === numberOfFrames) {
      return fragments.map((fragment) => new Uint8Array(fragment));
    }
    if (numberOfFrames === 1) {
      const total = fragments.reduce((sum, fragment) => sum + fragment.byteLength, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const fragment of fragments) {
        joined.set(new Uint8Array(fragment), offset);
        offset += fragment.byteLength;
      }
      return [joined];
    }
    throw new Error('encapsulated multi-frame instances need one fragment per frame');
  }
  const [whole] = fragments;
  if (whole === undefined) throw new Error('unreachable');
  const frameLength = whole.byteLength / numberOfFrames;
  return Array.from(
    { length: numberOfFrames },
    (_, index) => new Uint8Array(whole, index * frameLength, frameLength),
  );
}

async function loadInstance(path: string): Promise<InstanceRecord> {
  const bytes = await readFile(path);
  const file = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const { meta, dict } = data.DicomMessage.readFile(arrayBuffer);
  const transferSyntax = stringValue(meta, TRANSFER_SYNTAX_UID);
  const numberOfFrames = dict['00280008'] === undefined ? 1 : numberValue(dict, '00280008');
  const encapsulated = !/^1\.2\.840\.10008\.1\.2(\.[12](\.99)?)?$/.test(transferSyntax);
  return {
    studyUid: stringValue(dict, '0020000D'),
    seriesUid: stringValue(dict, '0020000E'),
    sopUid: stringValue(dict, '00080018'),
    modality: stringValue(dict, '00080060'),
    transferSyntax,
    instanceNumber: numberValue(dict, '00200013'),
    metadata: toMetadata(dict, transferSyntax),
    frames: splitFrames(dict, numberOfFrames, encapsulated),
    file,
  };
}

/** Loads every `<dir>/<series>/*.dcm` and groups the instances by series. */
export async function loadFixtures(dir: string): Promise<FixtureStore> {
  // `readdir` has no order on most file systems, and the first study of the store is the main one
  // for every consumer: read the directories by name.
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const series: SeriesRecord[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const names = (await readdir(join(dir, entry.name))).filter((name) => name.endsWith('.dcm'));
    const instances = await Promise.all(
      names.sort().map((name) => loadInstance(join(dir, entry.name, name))),
    );
    instances.sort((a, b) => a.instanceNumber - b.instanceNumber);
    const first = instances[0];
    if (first === undefined) continue;
    series.push({
      studyUid: first.studyUid,
      seriesUid: first.seriesUid,
      modality: first.modality,
      // The series directory name stands in for SeriesDescription, which the phantom also sets.
      description: first.metadata['0008103E']?.Value?.[0]?.toString() ?? entry.name,
      instances,
    });
  }
  return {
    studyUids: [...new Set(series.map((item) => item.studyUid))],
    series,
    findSeries: (studyUid, seriesUid) =>
      series.find((item) => item.studyUid === studyUid && item.seriesUid === seriesUid),
  };
}
