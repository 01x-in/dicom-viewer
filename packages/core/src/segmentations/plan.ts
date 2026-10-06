import type { BinaryFrame } from './decode-binary';
import type { SegmentationHeader } from './header';

export interface BinaryPlan {
  /** One for each frame of the SEG, in file order. `imageIndex` is -1 for a frame on no image of the stack. */
  readonly frames: readonly BinaryFrame[];
  /** How many frames are on an image the stack does not have. */
  readonly skipped: number;
}

/**
 * Says which image of the stack each frame of a SEG is on, by the instance the frame names. Gives
 * `undefined` when the SEG is not one the viewer decodes itself (it is not binary, or its frames do
 * not all say which segment and which instance they are), and the Cornerstone adapters read it.
 */
export function planBinaryDecode(
  header: SegmentationHeader,
  imageSopInstanceUIDs: readonly string[],
): BinaryPlan | undefined {
  const { pixelData, segmentationType, rows, columns } = header;
  if (segmentationType !== 'BINARY' || pixelData?.bitsAllocated !== 1) return undefined;
  if (header.frames.length === 0) return undefined;
  if (header.frames.length * rows * columns > pixelData.length * 8) return undefined;

  const imageOf = new Map(imageSopInstanceUIDs.map((sop, imageIndex) => [sop, imageIndex]));
  const frames: BinaryFrame[] = [];
  let skipped = 0;
  for (const frame of header.frames) {
    if (frame.segmentNumber === undefined || frame.referencedSopInstanceUID === undefined) {
      return undefined;
    }
    const imageIndex = imageOf.get(frame.referencedSopInstanceUID) ?? -1;
    if (imageIndex < 0) skipped += 1;
    frames.push({ segmentNumber: frame.segmentNumber, imageIndex });
  }
  return { frames, skipped };
}
