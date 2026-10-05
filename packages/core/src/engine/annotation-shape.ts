// What Cornerstone keeps for a shape, and what it is given, as plain data. No Cornerstone import
// here (only types, which are erased), so the conversions are unit tested without an engine.
import type { MeasurementType, Point3 } from '../measurements/model';
import type { EngineMeasurement } from '../rendering-port';

/** The parts of a Cornerstone annotation the viewer reads. */
export interface AnnotationLike {
  readonly annotationUID?: string | undefined;
  readonly metadata?:
    | { readonly toolName?: string | undefined; readonly referencedImageId?: string | undefined }
    | undefined;
  readonly data: { readonly handles?: { readonly points?: unknown } | undefined };
}

/** The number of handles each shape has once it is complete. */
export const HANDLE_COUNT: Readonly<Record<MeasurementType, number>> = {
  length: 2,
  bidirectional: 4,
  ellipse: 4,
  rectangle: 4,
  probe: 1,
  angle: 3,
};

function isPoint(value: unknown): value is Point3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

/**
 * The shape an annotation is, as plain data: a copy of its handles, so what Cornerstone changes
 * later does not change this. `undefined` if it is not on one of `imageIds`, is not a tool the
 * viewer draws, or is not complete (an angle has two points until the third is placed).
 */
export function shapeOfAnnotation(
  annotation: AnnotationLike,
  imageIds: ReadonlyMap<string, number>,
  typeOfTool: ReadonlyMap<string, MeasurementType>,
): EngineMeasurement | undefined {
  const imageId = annotation.metadata?.referencedImageId;
  const toolName = annotation.metadata?.toolName;
  const id = annotation.annotationUID;
  if (imageId === undefined || toolName === undefined || id === undefined) return undefined;
  const imageIndex = imageIds.get(imageId);
  const type = typeOfTool.get(toolName);
  if (imageIndex === undefined || type === undefined) return undefined;
  const handles = annotation.data.handles?.points;
  if (!Array.isArray(handles) || !handles.every(isPoint)) return undefined;
  if (handles.length !== HANDLE_COUNT[type]) return undefined;
  return { id, type, imageIndex, points: handles.map(([x, y, z]): Point3 => [x, y, z]) };
}

type Mutable = [number, number, number];

const mutable = ([x, y, z]: Point3): Mutable => [x, y, z];

/** What a tool's `hydrate` is given. A bidirectional measurement takes its two axes, the others their handles. */
export type HydrateInput =
  | { readonly kind: 'handles'; readonly points: Mutable[] }
  | { readonly kind: 'axes'; readonly axes: [[Mutable, Mutable], [Mutable, Mutable]] };

/** `undefined` for a shape with the wrong number of points. The points are copies. */
export function hydrateInputOf(shape: EngineMeasurement): HydrateInput | undefined {
  if (shape.points.length !== HANDLE_COUNT[shape.type]) return undefined;
  if (shape.type === 'bidirectional') {
    const [a, b, c, d] = shape.points;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
    return {
      kind: 'axes',
      axes: [
        [mutable(a), mutable(b)],
        [mutable(c), mutable(d)],
      ],
    };
  }
  return { kind: 'handles', points: shape.points.map(mutable) };
}
