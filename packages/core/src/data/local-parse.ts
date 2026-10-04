import { parseDicom } from 'dicom-parser';
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
  return instance;
}
