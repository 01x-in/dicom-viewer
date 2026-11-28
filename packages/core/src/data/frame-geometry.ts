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
  readonly attributes: readonly {
    readonly tag: string;
    readonly vr: string;
    /** How many values it must have, when that is fixed. */
    readonly count?: number;
  }[];
}

/** Exported so the local-file reader reads exactly what this module uses, and no more. */
export const HOISTED: readonly Hoisted[] = [
  { sequence: '00209113', attributes: [{ tag: '00200032', vr: 'DS', count: 3 }] },
  { sequence: '00209116', attributes: [{ tag: '00200037', vr: 'DS', count: 6 }] },
  {
    sequence: '00289110',
    attributes: [
      { tag: '00280030', vr: 'DS', count: 2 },
      { tag: '00180050', vr: 'DS' },
      { tag: '00180088', vr: 'DS' },
    ],
  },
  {
    sequence: '00289145',
    attributes: [
      { tag: '00281052', vr: 'DS' },
      { tag: '00281053', vr: 'DS' },
      { tag: '00281054', vr: 'LO' },
    ],
  },
  {
    sequence: '00289132',
    attributes: [
      { tag: '00281050', vr: 'DS' },
      { tag: '00281051', vr: 'DS' },
    ],
  },
];

/** Attributes whose values must all be numbers. The others (the rescale type, say) are text. */
const NUMERIC: ReadonlySet<string> = new Set(
  HOISTED.flatMap(({ attributes }) =>
    attributes.filter(({ vr }) => vr === 'DS' || vr === 'IS').map(({ tag }) => tag),
  ),
);

/** One DICOM JSON element. Only the ones this module reads are checked, so a frame costs little. */
const element = z.object({
  vr: z.string().optional(),
  Value: z.array(z.unknown()).optional(),
});
/** An item: a record of elements. Its elements are checked only when they are read. */
const item = z.record(z.string(), z.unknown());

type Element = z.infer<typeof element>;

export interface FrameSet {
  /** One for each frame, in frame order: the instance's metadata with this frame's geometry at the top level. */
  readonly frames: readonly DicomJsonInstance[];
  /** How many frames had no item of their own in the per-frame sequence. */
  readonly withoutGroup: number;
}

function formatTag(tag: string): string {
  return `(${tag.slice(0, 4)},${tag.slice(4)})`;
}

/** The most frames of one instance that the viewer makes images for: a count past it is a corrupt or hostile value. */
export const MAX_FRAMES = 100_000;

/**
 * The number of frames the instance says it has: 1 when `NumberOfFrames` is missing. Throws a
 * `DataSourceError` for one that is there and is not a whole number from 1 to `MAX_FRAMES`.
 */
export function frameCountOf(metadata: DicomJsonInstance): number {
  const found = metadata[NUMBER_OF_FRAMES];
  // The tag missing means one frame; the tag there with nothing in it is a malformed instance.
  if (found === undefined) return 1;
  const values = found.Value ?? [];
  const [count] = numbers(metadata, NUMBER_OF_FRAMES);
  if (count === undefined || !Number.isInteger(count) || count < 1) {
    throw new DataSourceError(
      `NumberOfFrames (0028,0008) must be a whole number from 1, not ${JSON.stringify(values[0])}.`,
    );
  }
  if (count > MAX_FRAMES) {
    throw new DataSourceError(
      `NumberOfFrames (0028,0008) is ${count.toString()}, more than the ${MAX_FRAMES.toString()} frames of one instance that the viewer makes slices for.`,
    );
  }
  return count;
}

/** The first item of a sequence that is in an item, checked. `undefined` when it is not there. */
function firstItemOf(
  group: Record<string, unknown>,
  sequence: string,
  frame: number,
): Record<string, unknown> | undefined {
  const raw = group[sequence];
  if (raw === undefined) return undefined;
  const found = element.safeParse(raw);
  const first = found.success ? found.data.Value?.[0] : undefined;
  const parsed = item.safeParse(first);
  if (
    !found.success ||
    (found.data.vr !== undefined && found.data.vr !== 'SQ') ||
    (first !== undefined && !parsed.success)
  ) {
    throw new DataSourceError(
      `Frame ${frame.toString()}: ${formatTag(sequence)} is not a sequence of items.`,
    );
  }
  return parsed.success ? parsed.data : undefined;
}

/** Copies what one group says about a frame, into `target`, after checking it. */
function hoist(
  group: Record<string, unknown>,
  frame: number,
  target: Record<string, Element>,
): void {
  for (const { sequence, attributes } of HOISTED) {
    const first = firstItemOf(group, sequence, frame);
    if (first === undefined) continue;
    for (const { tag, count } of attributes) {
      const raw = first[tag];
      if (raw === undefined) continue;
      const parsed = element.safeParse(raw);
      if (!parsed.success) {
        throw new DataSourceError(
          `Frame ${frame.toString()}: ${formatTag(tag)} is not a DICOM JSON element.`,
        );
      }
      const value = parsed.data;
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
): Record<string, unknown> | undefined {
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

  const shared: Record<string, Element> = {};
  const sharedGroup = groupOf(sharedSequence, 0, 1);
  if (sharedGroup !== undefined) hoist(sharedGroup, 1, shared);

  let withoutGroup = 0;
  const frames: DicomJsonInstance[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const own: Record<string, Element> = {};
    const group = groupOf(perFrameSequence, index, index + 1);
    if (group === undefined) withoutGroup += 1;
    else hoist(group, index + 1, own);
    frames.push({ ...base, ...shared, ...own });
  }
  return { frames, withoutGroup };
}
