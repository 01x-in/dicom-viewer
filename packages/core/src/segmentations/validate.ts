import { numbers, optionalString } from '../data/dicom-json';
import type { SeriesStack } from '../data/types';
import { distance } from '../measurements/geometry';
import type { Point3 } from '../measurements/model';
import type { SegmentationHeader } from './header';
import type { SegmentIndexResult } from './segment-index';

export type SegmentationWarningCode =
  | 'frame-of-reference'
  | 'image-size'
  | 'plane-orientation'
  | 'pixel-spacing'
  | 'plane-position'
  | 'missing-references'
  | 'overlapping-segments'
  | 'empty-segment'
  | 'not-drawn';

/** Something about a SEG that makes it unsafe to trust where it is drawn. It is still drawn. */
export interface SegmentationWarning {
  readonly code: SegmentationWarningCode;
  readonly message: string;
}

/** How far a frame's plane may be from its image's before it is a warning. A tenth of a millimetre is far below a voxel. */
export const POSITION_TOLERANCE_MM = 0.1;
/** How far two direction cosines, or two spacings in a ratio, may differ. */
const DIRECTION_TOLERANCE = 1e-3;
/** How many pairs of overlapping segments are named in a message. */
const NAMED_OVERLAPS = 3;

function maxDifference(a: readonly number[], b: readonly number[]): number {
  return a.reduce((most, value, index) => Math.max(most, Math.abs(value - (b[index] ?? 0))), 0);
}

function mm(value: number): string {
  return `${value.toFixed(1)} mm`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toString()} ${count === 1 ? one : many}`;
}

/**
 * What is wrong, or doubtful, about a SEG laid over the stack it names. Nothing here stops the SEG
 * being drawn: Cornerstone puts a frame on the image the SEG names, whatever the plane says, so a
 * mismatch would otherwise go unseen.
 */
export function checkSegmentation(input: {
  readonly header: SegmentationHeader;
  readonly stack: SeriesStack;
  readonly index: SegmentIndexResult;
}): SegmentationWarning[] {
  const { header, stack, index } = input;
  const warnings: SegmentationWarning[] = [];
  const [first] = stack.instances;
  const labelOf = new Map(header.segments.map((segment) => [segment.number, segment.label]));
  const nameOf = (number: number): string => labelOf.get(number) ?? `segment ${number.toString()}`;

  if (first !== undefined) {
    const metadata = first.metadata;
    const imageFrame = optionalString(metadata, '00200052');
    if (
      header.frameOfReferenceUID !== undefined &&
      imageFrame !== undefined &&
      header.frameOfReferenceUID !== imageFrame
    ) {
      warnings.push({
        code: 'frame-of-reference',
        message:
          'The SEG is in another frame of reference than the images, so it may not be where it is drawn.',
      });
    }

    const rows = numbers(metadata, '00280010')[0];
    const columns = numbers(metadata, '00280011')[0];
    if (
      rows !== undefined &&
      columns !== undefined &&
      (rows !== header.rows || columns !== header.columns)
    ) {
      warnings.push({
        code: 'image-size',
        message: `The SEG is ${header.rows.toString()} by ${header.columns.toString()} pixels and the images are ${rows.toString()} by ${columns.toString()}.`,
      });
    }

    const orientation = numbers(metadata, '00200037');
    if (
      header.orientation !== undefined &&
      orientation.length === 6 &&
      maxDifference(header.orientation, orientation) > DIRECTION_TOLERANCE
    ) {
      warnings.push({
        code: 'plane-orientation',
        message: 'The SEG lies in a different direction than the images.',
      });
    }

    const spacing = numbers(metadata, '00280030');
    if (
      header.pixelSpacing !== undefined &&
      spacing.length === 2 &&
      header.pixelSpacing.some(
        (value, at) => Math.abs(value / (spacing[at] ?? value) - 1) > DIRECTION_TOLERANCE,
      )
    ) {
      warnings.push({
        code: 'pixel-spacing',
        message: `The SEG has pixels of ${header.pixelSpacing.map((value) => mm(value)).join(' by ')} and the images have ${spacing.map((value) => mm(value)).join(' by ')}.`,
      });
    }
  }

  const imageOf = new Map(stack.instances.map((instance) => [instance.sopInstanceUID, instance]));
  const missing = header.referencedSopInstanceUIDs.filter((sop) => !imageOf.has(sop));
  if (missing.length > 0) {
    warnings.push({
      code: 'missing-references',
      message: `The SEG names ${plural(missing.length, 'image')} that ${missing.length === 1 ? 'is' : 'are'} not in the series on screen.`,
    });
  }

  let offFrames = 0;
  let farthest = 0;
  for (const frame of header.frames) {
    const instance =
      frame.referencedSopInstanceUID === undefined
        ? undefined
        : imageOf.get(frame.referencedSopInstanceUID);
    const [x, y, z] = numbers(instance?.metadata ?? {}, '00200032');
    if (frame.position === undefined || x === undefined || y === undefined || z === undefined) {
      continue;
    }
    const imagePosition: Point3 = [x, y, z];
    const off = distance(frame.position, imagePosition);
    if (off > POSITION_TOLERANCE_MM) {
      offFrames += 1;
      farthest = Math.max(farthest, off);
    }
  }
  if (offFrames > 0) {
    warnings.push({
      code: 'plane-position',
      message: `${plural(offFrames, 'frame')} of the SEG ${offFrames === 1 ? 'is' : 'are'} not on the plane of the image ${offFrames === 1 ? 'it names' : 'they name'}, by up to ${mm(farthest)}.`,
    });
  }

  if (index.overlaps.length > 0) {
    const named = index.overlaps
      .slice(0, NAMED_OVERLAPS)
      .map(({ a, b }) => `${nameOf(a)} and ${nameOf(b)}`);
    const more = index.overlaps.length - named.length;
    warnings.push({
      code: 'overlapping-segments',
      message: `Segments share pixels: ${named.join(', ')}${more > 0 ? `, and ${plural(more, 'other pair')}` : ''}.`,
    });
  }

  const present = new Set(index.segments.map((segment) => segment.number));
  const empty = header.segments.filter((segment) => !present.has(segment.number));
  for (const segment of empty) {
    warnings.push({
      code: 'empty-segment',
      message: `The segment ${segment.label} has no pixels.`,
    });
  }
  return warnings;
}
