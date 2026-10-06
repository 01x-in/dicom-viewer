import { type DataSet, type Element, parseDicom } from 'dicom-parser';
import {
  cielabToRgb,
  type FrameHeader,
  parseSegmentationHeader,
  type SegmentHeader,
  type SegmentationHeader,
} from '../segmentations/header';

// Tags, as dicom-parser spells them: `x` and eight lower-case hex digits.
const SEGMENT_SEQUENCE = 'x00620002';
const SEGMENT_NUMBER = 'x00620004';
const SEGMENT_LABEL = 'x00620005';
const SEGMENT_DESCRIPTION = 'x00620006';
const SEGMENT_CIELAB = 'x0062000d';
const SHARED_GROUPS = 'x52009229';
const PER_FRAME_GROUPS = 'x52009230';
const PLANE_ORIENTATION = 'x00209116';
const PLANE_POSITION = 'x00209113';
const PIXEL_MEASURES = 'x00289110';
const SEGMENT_IDENTIFICATION = 'x0062000a';
const REFERENCED_SEGMENT_NUMBER = 'x0062000b';
const DERIVATION_IMAGE = 'x00089124';
const SOURCE_IMAGE = 'x00082112';
const REFERENCED_SERIES = 'x00081115';
const REFERENCED_INSTANCE = 'x0008114a';
const REFERENCED_SOP_INSTANCE_UID = 'x00081155';
const IMAGE_POSITION = 'x00200032';
const IMAGE_ORIENTATION = 'x00200037';
const PIXEL_SPACING = 'x00280030';
const SEGMENTATION_TYPE = 'x00620001';
const BITS_ALLOCATED = 'x00280100';
const PIXEL_DATA = 'x7fe00010';
const SEGMENTATION_TYPES = ['BINARY', 'FRACTIONAL', 'LABELMAP'];

function text(dataSet: DataSet, tag: string): string | undefined {
  const value = dataSet.string(tag);
  return value === undefined || value === '' ? undefined : value;
}

/** The data sets of the items of a sequence. */
function items(dataSet: DataSet, tag: string): DataSet[] {
  return (dataSet.elements[tag]?.items ?? []).flatMap((item) =>
    item.dataSet === undefined ? [] : [item.dataSet],
  );
}

function numbersOf(dataSet: DataSet, tag: string, count: number): number[] | undefined {
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = dataSet.floatString(tag, index);
    if (value === undefined || !Number.isFinite(value)) return undefined;
    values.push(value);
  }
  return values;
}

function segmentOf(dataSet: DataSet): SegmentHeader | undefined {
  const number = dataSet.uint16(SEGMENT_NUMBER);
  if (number === undefined) return undefined;
  const lab = [0, 1, 2].flatMap((index) => {
    const value = dataSet.uint16(SEGMENT_CIELAB, index);
    return value === undefined ? [] : [value];
  });
  return {
    number,
    label: text(dataSet, SEGMENT_LABEL) ?? `Segment ${number.toString()}`,
    color: cielabToRgb(lab),
    description: text(dataSet, SEGMENT_DESCRIPTION),
  };
}

/**
 * Where the pixels are in the file, if they are native: encapsulated (compressed) pixel data has no
 * length to read as bits, and is left to the adapters.
 */
export function pixelDataHeader(
  element: Pick<Element, 'dataOffset' | 'length' | 'hadUndefinedLength'> | undefined,
  bitsAllocated: number | undefined,
): { offset: number; length: number; bitsAllocated: number } | undefined {
  if (element === undefined || bitsAllocated === undefined || element.hadUndefinedLength === true) {
    return undefined;
  }
  return { offset: element.dataOffset, length: element.length, bitsAllocated };
}

/** `sharedSegment` is the segment the SEG names once for all its frames, which a SEG of one segment does. */
function frameOf(dataSet: DataSet, sharedSegment: number | undefined): FrameHeader {
  const [position] = items(dataSet, PLANE_POSITION);
  const [identification] = items(dataSet, SEGMENT_IDENTIFICATION);
  const [derivation] = items(dataSet, DERIVATION_IMAGE);
  const [source] = derivation === undefined ? [] : items(derivation, SOURCE_IMAGE);
  const [x, y, z] =
    (position === undefined ? undefined : numbersOf(position, IMAGE_POSITION, 3)) ?? [];
  return {
    segmentNumber: identification?.uint16(REFERENCED_SEGMENT_NUMBER) ?? sharedSegment,
    referencedSopInstanceUID:
      source === undefined ? undefined : text(source, REFERENCED_SOP_INSTANCE_UID),
    position: x === undefined || y === undefined || z === undefined ? undefined : [x, y, z],
  };
}

/**
 * Reads what a SEG says about itself, from the bytes of the Part 10 file, without reading its
 * pixels. Throws an `Error` for a file that is not a readable SEG.
 */
export function readSegmentationHeader(bytes: ArrayBuffer): SegmentationHeader {
  let dataSet: DataSet;
  try {
    dataSet = parseDicom(new Uint8Array(bytes), { untilTag: 'x7fe00010' });
  } catch (error) {
    throw new Error(
      `The SEG is not a readable DICOM file: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const [shared] = items(dataSet, SHARED_GROUPS);
  const [sharedIdentification] = shared === undefined ? [] : items(shared, SEGMENT_IDENTIFICATION);
  const sharedSegment = sharedIdentification?.uint16(REFERENCED_SEGMENT_NUMBER);
  const [sharedOrientation] = shared === undefined ? [] : items(shared, PLANE_ORIENTATION);
  const [sharedMeasures] = shared === undefined ? [] : items(shared, PIXEL_MEASURES);
  const orientation =
    sharedOrientation === undefined
      ? undefined
      : numbersOf(sharedOrientation, IMAGE_ORIENTATION, 6);
  const pixelSpacing =
    sharedMeasures === undefined ? undefined : numbersOf(sharedMeasures, PIXEL_SPACING, 2);
  const segmentationType = text(dataSet, SEGMENTATION_TYPE);
  const bitsAllocated = dataSet.uint16(BITS_ALLOCATED);
  const pixelElement = dataSet.elements[PIXEL_DATA];
  const [referencedSeries] = items(dataSet, REFERENCED_SERIES);
  const referencedInstances =
    referencedSeries === undefined ? [] : items(referencedSeries, REFERENCED_INSTANCE);

  return parseSegmentationHeader({
    sopInstanceUID: text(dataSet, 'x00080018'),
    seriesInstanceUID: text(dataSet, 'x0020000e'),
    studyInstanceUID: text(dataSet, 'x0020000d'),
    seriesDescription: text(dataSet, 'x0008103e'),
    frameOfReferenceUID: text(dataSet, 'x00200052'),
    rows: dataSet.uint16('x00280010'),
    columns: dataSet.uint16('x00280011'),
    segmentationType:
      segmentationType !== undefined && SEGMENTATION_TYPES.includes(segmentationType)
        ? segmentationType
        : undefined,
    pixelData:
      // Encapsulated pixel data has no length to read as bits: the adapters take those.
      pixelDataHeader(pixelElement, bitsAllocated),
    segments: items(dataSet, SEGMENT_SEQUENCE).flatMap((item) => {
      const segment = segmentOf(item);
      return segment === undefined ? [] : [segment];
    }),
    referencedSeriesInstanceUID:
      referencedSeries === undefined ? undefined : text(referencedSeries, 'x0020000e'),
    referencedSopInstanceUIDs: referencedInstances.flatMap((item) => {
      const sop = text(item, REFERENCED_SOP_INSTANCE_UID);
      return sop === undefined ? [] : [sop];
    }),
    frames: items(dataSet, PER_FRAME_GROUPS).map((frame) => frameOf(frame, sharedSegment)),
    orientation,
    pixelSpacing,
  });
}
