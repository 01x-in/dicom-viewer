import type { BinaryFrame } from './decode-binary';
import type { SegmentationHeader } from './header';

export interface BinaryPlan {
  /** One for each frame of the SEG, in file order. `imageIndex` is -1 for a frame on no image of the stack. */
  readonly frames: readonly BinaryFrame[];
  /** How many frames are on an image the stack does not have. */
  readonly skipped: number;
}

/** An image of the stack: a frame of an instance. */
export interface PlanImage {
  readonly sopInstanceUID: string;
  /** From 1. */
  readonly frameNumber: number;
  /** How many frames the instance has. */
  readonly frameCount: number;
}

const keyOf = (sopInstanceUID: string, frameNumber: number): string =>
  `${sopInstanceUID}:${frameNumber.toString()}`;

/**
 * Says which image of the stack each frame of a SEG is on, by the instance the frame names and, for
 * an instance of many frames, the frame of it. A bare UID is an image of one frame. A frame that
 * names no frame is on the only frame of an image of one frame; on an instance of many it is on no
 * image, because the first frame would be a guess. Gives `undefined` when the SEG is not one the
 * viewer decodes itself (it is not binary, or its frames do not all say which segment and which
 * instance they are), and the Cornerstone adapters read it.
 */
export function planBinaryDecode(
  header: SegmentationHeader,
  images: readonly (string | PlanImage)[],
): BinaryPlan | undefined {
  const { pixelData, segmentationType, rows, columns } = header;
  if (segmentationType !== 'BINARY' || pixelData?.bitsAllocated !== 1) return undefined;
  if (header.frames.length === 0) return undefined;
  if (header.frames.length * rows * columns > pixelData.length * 8) return undefined;

  const imageOf = new Map<string, number>();
  const frameCountOf = new Map<string, number>();
  for (const [imageIndex, image] of images.entries()) {
    const { sopInstanceUID, frameNumber, frameCount } =
      typeof image === 'string' ? { sopInstanceUID: image, frameNumber: 1, frameCount: 1 } : image;
    imageOf.set(keyOf(sopInstanceUID, frameNumber), imageIndex);
    frameCountOf.set(sopInstanceUID, frameCount);
  }
  const frames: BinaryFrame[] = [];
  let skipped = 0;
  for (const frame of header.frames) {
    if (frame.segmentNumber === undefined || frame.referencedSopInstanceUID === undefined) {
      return undefined;
    }
    const sop = frame.referencedSopInstanceUID;
    const named = frame.referencedFrameNumber ?? ((frameCountOf.get(sop) ?? 1) === 1 ? 1 : 0);
    const imageIndex = named === 0 ? -1 : (imageOf.get(keyOf(sop, named)) ?? -1);
    if (imageIndex < 0) skipped += 1;
    frames.push({ segmentNumber: frame.segmentNumber, imageIndex });
  }
  return { frames, skipped };
}
