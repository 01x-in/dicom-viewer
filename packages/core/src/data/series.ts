import { DataSourceError } from './errors';
import { firstNumber, numbers, optionalString, requiredString } from './dicom-json';
import type {
  DicomJsonInstance,
  LoadedSeriesData,
  NotReconstructable,
  Reconstructability,
  SeriesInstance,
  SeriesStack,
} from './types';

type Vec3 = readonly [number, number, number];

/** Slices closer than this along the normal are the same position (DS values carry ~6 digits). */
const SAME_POSITION_MM = 0.01;
/** Spacing may wobble by this fraction of the mean before a stack is called non-uniform. */
const SPACING_TOLERANCE = 0.01;
/** A stack whose slices run more than this far off the normal has a gantry tilt. */
const TILT_COS = Math.cos((1 * Math.PI) / 180);
/** Series that hold no pixel images to scroll through. */
const NON_IMAGE_MODALITIES: ReadonlySet<string> = new Set(['SEG', 'SR']);

function triple(values: number[], offset: number): Vec3 | undefined {
  const [x, y, z] = values.slice(offset, offset + 3);
  return x === undefined || y === undefined || z === undefined ? undefined : [x, y, z];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

interface Located {
  readonly instance: SeriesInstance;
  readonly position: Vec3;
  /** Distance along the slice normal. */
  readonly along: number;
}

export interface BuildSeriesInput {
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
  /** DICOM JSON of every instance, in any order. */
  readonly metadata: readonly DicomJsonInstance[];
  readonly imageIdFor: (sopInstanceUID: string, metadata: DicomJsonInstance) => string;
}

function toInstance(
  metadata: DicomJsonInstance,
  imageIdFor: BuildSeriesInput['imageIdFor'],
): SeriesInstance {
  const sopInstanceUID = requiredString(metadata, '00080018');
  return {
    sopInstanceUID,
    instanceNumber: firstNumber(metadata, '00200013'),
    imageId: imageIdFor(sopInstanceUID, metadata),
    metadata,
  };
}

function isDisplayable(metadata: DicomJsonInstance, modality: string): boolean {
  return (
    !NON_IMAGE_MODALITIES.has(modality) &&
    firstNumber(metadata, '00280010') !== undefined &&
    firstNumber(metadata, '00280011') !== undefined
  );
}

function orientationOf(instance: SeriesInstance): { row: Vec3; column: Vec3 } | undefined {
  const values = numbers(instance.metadata, '00200037');
  const row = triple(values, 0);
  const column = triple(values, 3);
  return row === undefined || column === undefined ? undefined : { row, column };
}

function orientationKey(orientation: { row: Vec3; column: Vec3 }): string {
  return [...orientation.row, ...orientation.column].map((value) => value.toFixed(3)).join(',');
}

function byInstanceNumber(a: SeriesInstance, b: SeriesInstance): number {
  return (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0);
}

function sameSize(a: DicomJsonInstance, b: DicomJsonInstance): boolean {
  return ['00280010', '00280011', '00280030'].every((tag) => {
    const left = numbers(a, tag);
    const right = numbers(b, tag);
    return (
      left.length === right.length &&
      left.every((value, i) => Math.abs(value - (right[i] ?? Number.NaN)) < 1e-3)
    );
  });
}

function reconstructability(slices: readonly Located[], normal: Vec3): Reconstructability {
  const [first] = slices;
  const last = slices.at(-1);
  if (first === undefined || last === undefined || slices.length < 3) {
    return { ok: false, reason: 'too-few-slices' };
  }
  const fail = (reason: NotReconstructable): Reconstructability => ({ ok: false, reason });
  if (!slices.every((slice) => sameSize(first.instance.metadata, slice.instance.metadata))) {
    return fail('inconsistent-image-size');
  }
  const travel: Vec3 = [
    last.position[0] - first.position[0],
    last.position[1] - first.position[1],
    last.position[2] - first.position[2],
  ];
  if (Math.abs(dot(travel, normal)) / length(travel) < TILT_COS) return fail('tilted');
  const steps = slices.slice(1).map((slice, index) => slice.along - (slices[index]?.along ?? 0));
  const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
  const tolerance = Math.max(SAME_POSITION_MM, Math.abs(mean) * SPACING_TOLERANCE);
  if (steps.some((step) => Math.abs(step - mean) > tolerance)) return fail('non-uniform-spacing');
  return { ok: true, spacingMm: Math.abs(mean) };
}

interface DraftStack {
  readonly instances: readonly SeriesInstance[];
  readonly reconstructable: Reconstructability;
}

/** One orientation: sorted along the normal, then dealt into layers where positions repeat. */
function stacksForOrientation(
  instances: readonly SeriesInstance[],
  orientation: { row: Vec3; column: Vec3 },
): { drafts: DraftStack[]; leftovers: SeriesInstance[] } {
  const raw = cross(orientation.row, orientation.column);
  const unit = length(raw);
  const normal: Vec3 = [raw[0] / unit, raw[1] / unit, raw[2] / unit];
  const located: Located[] = [];
  const leftovers: SeriesInstance[] = [];
  for (const instance of instances) {
    const position = triple(numbers(instance.metadata, '00200032'), 0);
    if (position === undefined) leftovers.push(instance);
    else located.push({ instance, position, along: dot(position, normal) });
  }
  located.sort((a, b) => a.along - b.along);

  const layers: Located[][] = [];
  let clusterStart = Number.NEGATIVE_INFINITY;
  let layer = 0;
  for (const slice of located) {
    if (slice.along - clusterStart <= SAME_POSITION_MM) {
      layer += 1;
    } else {
      clusterStart = slice.along;
      layer = 0;
    }
    (layers[layer] ??= []).push(slice);
  }
  return {
    drafts: layers.map((slices) => ({
      instances: slices.map((slice) => slice.instance),
      reconstructable: reconstructability(slices, normal),
    })),
    leftovers,
  };
}

/** Splits displayable instances into stacks. Instances without usable geometry end up in stacks of their own. */
function buildStacks(instances: readonly SeriesInstance[]): SeriesStack[] {
  const byOrientation = new Map<
    string,
    { orientation: { row: Vec3; column: Vec3 }; members: SeriesInstance[] }
  >();
  const withoutGeometry: SeriesInstance[] = [];
  for (const instance of instances) {
    const orientation = orientationOf(instance);
    if (orientation === undefined) {
      withoutGeometry.push(instance);
      continue;
    }
    const key = orientationKey(orientation);
    const group = byOrientation.get(key) ?? { orientation, members: [] };
    group.members.push(instance);
    byOrientation.set(key, group);
  }

  const drafts: DraftStack[] = [];
  for (const { orientation, members } of byOrientation.values()) {
    const result = stacksForOrientation(members, orientation);
    drafts.push(...result.drafts);
    withoutGeometry.push(...result.leftovers);
  }
  if (withoutGeometry.length > 0) {
    drafts.push({
      instances: [...withoutGeometry].sort(byInstanceNumber),
      reconstructable: { ok: false, reason: 'missing-geometry' },
    });
  }
  // Largest first, so the default stack is the most complete one. Array.sort is stable.
  return drafts
    .sort((a, b) => b.instances.length - a.instances.length)
    .map((draft, index) => ({
      index,
      instances: draft.instances,
      imageIds: draft.instances.map((instance) => instance.imageId),
      reconstructable: draft.reconstructable,
    }));
}

/**
 * Turns the metadata of one series into stacks. Slices are ordered by their position along the
 * slice normal, because instance numbers are frequently wrong or missing.
 */
export function buildSeries(input: BuildSeriesInput): LoadedSeriesData {
  const [first] = input.metadata;
  if (first === undefined) throw new DataSourceError('The series has no instances.');
  const modality = optionalString(first, '00080060') ?? 'OT';
  const instances = input.metadata
    .map((metadata) => toInstance(metadata, input.imageIdFor))
    .sort(byInstanceNumber);

  const displayable = instances.filter((instance) => isDisplayable(instance.metadata, modality));
  if (displayable.some((instance) => (firstNumber(instance.metadata, '00280008') ?? 1) > 1)) {
    throw new DataSourceError(
      'Multi-frame image series are not supported yet. Convert the series to single-frame instances.',
    );
  }

  return {
    studyInstanceUID: input.studyInstanceUID,
    seriesInstanceUID: input.seriesInstanceUID,
    modality,
    description: optionalString(first, '0008103E'),
    instances,
    stacks: buildStacks(displayable),
  };
}
