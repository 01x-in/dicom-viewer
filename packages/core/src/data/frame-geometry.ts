import { z } from 'zod';
import { numbers } from './dicom-json';
import { DataSourceError } from './errors';
import type { DicomJsonInstance } from './types';

const NUMBER_OF_FRAMES = '00280008';
const SHARED_GROUPS = '52009229';
const PER_FRAME_GROUPS = '52009230';

/**
 * What a functional group says about one frame, and where a single-frame instance keeps the same
 * thing. A frame is made to look like a single-frame instance by putting these at the top level.
 */
interface Hoisted {
  /** The sequence that holds one item with the attributes. */
  readonly sequence: string;
  readonly attributes: readonly { readonly tag: string; readonly count?: number }[];
}

const HOISTED: readonly Hoisted[] = [
  { sequence: '00209113', attributes: [{ tag: '00200032', count: 3 }] },
  { sequence: '00209116', attributes: [{ tag: '00200037', count: 6 }] },
  {
    sequence: '00289110',
    attributes: [{ tag: '00280030', count: 2 }, { tag: '00180050' }, { tag: '00180088' }],
  },
  {
    sequence: '00289145',
    attributes: [{ tag: '00281052' }, { tag: '00281053' }, { tag: '00281054' }],
  },
  { sequence: '00289132', attributes: [{ tag: '00281050' }, { tag: '00281051' }] },
];

/** Attributes whose values must all be numbers. The others (the rescale type, say) are text. */
const NUMERIC: ReadonlySet<string> = new Set([
  '00200032',
  '00200037',
  '00280030',
  '00180050',
  '00180088',
  '00281052',
  '00281053',
  '00281050',
  '00281051',
]);

const element = z.object({
  vr: z.string().optional(),
  Value: z.array(z.unknown()).optional(),
});
const item = z.record(z.string(), element);

export interface FrameSet {
  /** One for each frame, in frame order: the instance's metadata with this frame's geometry at the top level. */
  readonly frames: readonly DicomJsonInstance[];
  /** How many frames had no item of their own in the per-frame sequence. */
  readonly withoutGroup: number;
}

function formatTag(tag: string): string {
  return `(${tag.slice(0, 4)},${tag.slice(4)})`;
}

/**
 * The number of frames the instance says it has: 1 when `NumberOfFrames` is missing. Throws a
 * `DataSourceError` for a value that is not a whole number from 1.
 */
export function frameCountOf(metadata: DicomJsonInstance): number {
  const values = metadata[NUMBER_OF_FRAMES]?.Value ?? [];
  if (values.length === 0) return 1;
  const [count] = numbers(metadata, NUMBER_OF_FRAMES);
  if (count === undefined || !Number.isInteger(count) || count < 1) {
    throw new DataSourceError(
      `NumberOfFrames (0028,0008) must be a whole number from 1, not ${JSON.stringify(values[0])}.`,
    );
  }
  return count;
}

/** The items of a sequence that is in an item, checked. `undefined` when it is not there. */
function itemsOf(
  group: z.infer<typeof item>,
  sequence: string,
  frame: number,
): z.infer<typeof item>[] | undefined {
  const found = group[sequence];
  if (found === undefined) return undefined;
  const parsed = z.array(item).safeParse(found.Value ?? []);
  if (!parsed.success || (found.vr !== undefined && found.vr !== 'SQ')) {
    throw new DataSourceError(
      `Frame ${frame.toString()}: ${formatTag(sequence)} is not a sequence of items.`,
    );
  }
  return parsed.data;
}

/** Copies what one group says about a frame, into `target`, after checking it. */
function hoist(
  group: z.infer<typeof item>,
  frame: number,
  target: Record<string, { vr?: string | undefined; Value?: unknown[] | undefined }>,
): void {
  for (const { sequence, attributes } of HOISTED) {
    const [first] = itemsOf(group, sequence, frame) ?? [];
    if (first === undefined) continue;
    for (const { tag, count } of attributes) {
      const value = first[tag];
      if (value === undefined) continue;
      const values = value.Value ?? [];
      if (NUMERIC.has(tag) && numbers({ [tag]: value }, tag).length !== values.length) {
        throw new DataSourceError(
          `Frame ${frame.toString()}: ${formatTag(tag)} has a value that is not a number.`,
        );
      }
      if (count !== undefined && values.length !== count) {
        throw new DataSourceError(
          `Frame ${frame.toString()}: ${formatTag(tag)} must have ${count.toString()} values, not ${values.length.toString()}.`,
        );
      }
      target[tag] = value;
    }
  }
}

function groupOf(
  sequence: DicomJsonInstance[string] | undefined,
  index: number,
  frame: number,
): z.infer<typeof item> | undefined {
  const raw = sequence?.Value?.[index];
  if (raw === undefined) return undefined;
  const parsed = item.safeParse(raw);
  if (!parsed.success) {
    throw new DataSourceError(
      `Frame ${frame.toString()}: an item of a functional group sequence is not DICOM JSON.`,
    );
  }
  return parsed.data;
}

/**
 * Splits a multi-frame instance into one metadata record for each frame, or `undefined` for an
 * instance of one frame. The two functional group sequences are not copied into the records (a
 * thousand frames must not hold a thousand copies of a thousand-item sequence); what they say about
 * a frame is put at the top level under the tags a single-frame instance uses, the frame's own
 * value over the shared one. A frame with no item of its own keeps what is shared.
 */
export function readFrames(metadata: DicomJsonInstance): FrameSet | undefined {
  const frameCount = frameCountOf(metadata);
  if (frameCount === 1) return undefined;
  const {
    [SHARED_GROUPS]: sharedSequence,
    [PER_FRAME_GROUPS]: perFrameSequence,
    ...base
  } = metadata;

  const shared: Record<string, { vr?: string | undefined; Value?: unknown[] | undefined }> = {};
  const sharedGroup = groupOf(sharedSequence, 0, 1);
  if (sharedGroup !== undefined) hoist(sharedGroup, 1, shared);

  let withoutGroup = 0;
  const frames: DicomJsonInstance[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const own: Record<string, { vr?: string | undefined; Value?: unknown[] | undefined }> = {};
    const group = groupOf(perFrameSequence, index, index + 1);
    if (group === undefined) withoutGroup += 1;
    else hoist(group, index + 1, own);
    frames.push({ ...base, ...shared, ...own });
  }
  return { frames, withoutGroup };
}
