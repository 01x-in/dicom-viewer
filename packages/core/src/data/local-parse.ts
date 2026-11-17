import { parseDicom, type DataSet } from 'dicom-parser';
import { HOISTED } from './frame-geometry';
import type { DicomJsonInstance } from './types';

type Kind = 'string' | 'numbers' | 'uint16';

/** The attributes the series model reads. Everything else stays in the file. */
const ATTRIBUTES: readonly { tag: string; vr: string; kind: Kind }[] = [
  { tag: '0020000D', vr: 'UI', kind: 'string' },
  { tag: '0020000E', vr: 'UI', kind: 'string' },
  { tag: '00080018', vr: 'UI', kind: 'string' },
  { tag: '00080060', vr: 'CS', kind: 'string' },
  { tag: '0008103E', vr: 'LO', kind: 'string' },
  { tag: '00200011', vr: 'IS', kind: 'numbers' },
  { tag: '00200013', vr: 'IS', kind: 'numbers' },
  { tag: '00200032', vr: 'DS', kind: 'numbers' },
  { tag: '00200037', vr: 'DS', kind: 'numbers' },
  { tag: '00280008', vr: 'IS', kind: 'numbers' },
  { tag: '00280010', vr: 'US', kind: 'uint16' },
  { tag: '00280011', vr: 'US', kind: 'uint16' },
  { tag: '00280030', vr: 'DS', kind: 'numbers' },
];

const SHARED_GROUPS = 'x52009229';
const PER_FRAME_GROUPS = 'x52009230';

/**
 * One item of a functional group sequence, as DICOM JSON: only what `readFrames` uses (the position,
 * the orientation, the pixel measures, the rescale, and the window), each in the sequence it is in.
 */
function readGroup(item: DataSet): DicomJsonInstance {
  const group: DicomJsonInstance = {};
  for (const { sequence, attributes } of HOISTED) {
    const inner = item.elements[`x${sequence}`]?.items?.[0]?.dataSet;
    if (inner === undefined) continue;
    const values: DicomJsonInstance = {};
    for (const { tag, vr } of attributes) {
      const text = inner.string(`x${tag}`);
      if (text === undefined || text === '') continue;
      values[tag] = { vr, Value: text.split('\\').map((part) => part.trim()) };
    }
    if (Object.keys(values).length > 0) group[sequence] = { vr: 'SQ', Value: [values] };
  }
  return group;
}

function readGroups(dataSet: DataSet, key: string): DicomJsonInstance[string] | undefined {
  const items = dataSet.elements[key]?.items;
  if (items === undefined) return undefined;
  return {
    vr: 'SQ',
    Value: items.map((item) => (item.dataSet === undefined ? {} : readGroup(item.dataSet))),
  };
}

/** Reads the header of one Part 10 file (everything before the pixel data) as DICOM JSON. */
export function parseLocalInstance(bytes: Uint8Array): DicomJsonInstance {
  const dataSet = parseDicom(bytes, { untilTag: 'x7fe00010' });
  const instance: DicomJsonInstance = {};
  for (const { tag, vr, kind } of ATTRIBUTES) {
    const key = `x${tag.toLowerCase()}`;
    if (kind === 'uint16') {
      const value = dataSet.uint16(key);
      if (value !== undefined) instance[tag] = { vr, Value: [value] };
      continue;
    }
    const text = dataSet.string(key);
    if (text === undefined || text === '') continue;
    instance[tag] = {
      vr,
      // Multi-valued strings are backslash-separated.
      Value: kind === 'string' ? [text] : text.split('\\').map((part) => part.trim()),
    };
  }
  // The groups of an Enhanced instance, which hold the position of each frame.
  const shared = readGroups(dataSet, SHARED_GROUPS);
  if (shared !== undefined) instance['52009229'] = shared;
  const perFrame = readGroups(dataSet, PER_FRAME_GROUPS);
  if (perFrame !== undefined) instance['52009230'] = perFrame;
  return instance;
}
