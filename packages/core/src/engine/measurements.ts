import { eventTarget } from '@cornerstonejs/core';
import {
  AngleTool,
  annotation as annotationApi,
  BidirectionalTool,
  EllipticalROITool,
  Enums,
  LengthTool,
  ProbeTool,
  RectangleROITool,
  type Types,
} from '@cornerstonejs/tools';
import type { EngineMeasurement, MeasurementChange } from '../rendering-port';
import type { MeasurementType, Point3 } from '../measurements/model';
import { MEASUREMENT_OF_TOOL } from './tools';

type Annotation = Types.Annotation;

/** What `hydrate` of every tool wants: where, which image, and the id to keep. */
interface HydrateOptions {
  readonly annotationUID: string;
  readonly referencedImageId: string;
}

type Hydrate = (viewportId: string, points: Point3[], options: HydrateOptions) => unknown;

function mutable([x, y, z]: Point3): [number, number, number] {
  return [x, y, z];
}

function copy(points: readonly Point3[]): [number, number, number][] {
  return points.map(mutable);
}

/** Tools that take their handles as they are draw them: a list of points. */
const POINT_HYDRATORS: Readonly<Record<Exclude<MeasurementType, 'bidirectional'>, Hydrate>> = {
  length: (viewportId, points, options) => LengthTool.hydrate(viewportId, copy(points), options),
  ellipse: (viewportId, points, options) =>
    EllipticalROITool.hydrate(viewportId, copy(points), options),
  rectangle: (viewportId, points, options) =>
    RectangleROITool.hydrate(viewportId, copy(points), options),
  probe: (viewportId, points, options) => ProbeTool.hydrate(viewportId, copy(points), options),
  angle: (viewportId, points, options) => AngleTool.hydrate(viewportId, copy(points), options),
};

/** The number of handles each shape has once it is complete. */
const HANDLE_COUNT: Readonly<Record<MeasurementType, number>> = {
  length: 2,
  bidirectional: 4,
  ellipse: 4,
  rectangle: 4,
  probe: 1,
  angle: 3,
};

/** Cornerstone's types say a lookup always finds something. It does not. */
function lookup(id: string): Annotation | undefined {
  return annotationApi.state.getAnnotation(id);
}

function isPoint(value: unknown): value is Point3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

export interface StackMeasurements {
  add(measurement: EngineMeasurement): void;
  update(measurement: EngineMeasurement): void;
  remove(id: string): void;
  select(id: string | undefined): void;
  onChange(listener: (change: MeasurementChange) => void): () => void;
  /** Takes every shape of this stack out of Cornerstone, and stops listening. */
  destroy(): void;
}

/**
 * The shapes drawn on one stack, as the rest of the library sees them. Cornerstone keeps its
 * annotations in one place for the page, so this keeps to those whose image is in `imageIds`,
 * turns them into plain data, and does not report what the viewer itself asked for.
 */
export function trackMeasurements(options: {
  readonly viewportId: string;
  readonly imageIds: readonly string[];
}): StackMeasurements {
  const { viewportId } = options;
  const indexOf = new Map(options.imageIds.map((imageId, index) => [imageId, index]));
  const listeners = new Set<(change: MeasurementChange) => void>();
  // Above zero while the viewer is changing Cornerstone's state: those changes are not news.
  let quiet = 0;
  let destroyed = false;

  const quietly = (change: () => void): void => {
    quiet += 1;
    try {
      change();
    } finally {
      quiet -= 1;
    }
  };

  const emit = (change: MeasurementChange): void => {
    for (const listener of [...listeners]) listener(change);
  };

  /** The shape as plain data, or `undefined` if it is not on this stack or is not a shape we know. */
  function describe(annotation: Annotation): EngineMeasurement | undefined {
    const imageId = annotation.metadata?.referencedImageId;
    const toolName = annotation.metadata?.toolName;
    const id = annotation.annotationUID;
    if (imageId === undefined || toolName === undefined || id === undefined) return undefined;
    const imageIndex = indexOf.get(imageId);
    const type = MEASUREMENT_OF_TOOL.get(toolName);
    if (imageIndex === undefined || type === undefined) return undefined;
    const handles: unknown = annotation.data.handles?.points;
    if (!Array.isArray(handles) || !handles.every(isPoint)) return undefined;
    // An angle has two points until the third is placed: not a measurement yet.
    if (handles.length !== HANDLE_COUNT[type]) return undefined;
    return { id, type, imageIndex, points: handles.map(([x, y, z]): Point3 => [x, y, z]) };
  }

  const detail = (event: Event): Annotation | undefined => {
    const { annotation } = (event as CustomEvent<{ annotation?: Annotation }>).detail;
    return annotation;
  };

  const onCompleted = (event: Event): void => {
    if (quiet > 0) return;
    const annotation = detail(event);
    const measurement = annotation === undefined ? undefined : describe(annotation);
    if (measurement !== undefined) emit({ kind: 'completed', measurement });
  };
  const onModified = (event: Event): void => {
    if (quiet > 0) return;
    const annotation = detail(event);
    const measurement = annotation === undefined ? undefined : describe(annotation);
    if (measurement !== undefined) emit({ kind: 'modified', measurement });
  };
  const onRemoved = (event: Event): void => {
    if (quiet > 0) return;
    const annotation = detail(event);
    const imageId = annotation?.metadata?.referencedImageId;
    const id = annotation?.annotationUID;
    if (imageId !== undefined && id !== undefined && indexOf.has(imageId)) {
      emit({ kind: 'removed', id });
    }
  };
  const onSelection = (event: Event): void => {
    if (quiet > 0) return;
    const { selection } = (event as CustomEvent<{ selection: string[] }>).detail;
    const mine = selection.find((id) => {
      const annotation = lookup(id);
      const imageId = annotation?.metadata?.referencedImageId;
      return imageId !== undefined && indexOf.has(imageId);
    });
    if (mine !== undefined || selection.length === 0) emit({ kind: 'selected', id: mine });
  };

  eventTarget.addEventListener(Enums.Events.ANNOTATION_COMPLETED, onCompleted);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_MODIFIED, onModified);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_REMOVED, onRemoved);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_SELECTION_CHANGE, onSelection);

  const mine = (id: string): Annotation | undefined => {
    const found = lookup(id);
    const imageId = found?.metadata?.referencedImageId;
    return imageId !== undefined && indexOf.has(imageId) ? found : undefined;
  };

  return {
    add(measurement): void {
      if (destroyed || mine(measurement.id) !== undefined) return;
      const imageId = options.imageIds[measurement.imageIndex];
      if (imageId === undefined || measurement.points.length !== HANDLE_COUNT[measurement.type]) {
        return;
      }
      const hydrateOptions: HydrateOptions = {
        annotationUID: measurement.id,
        referencedImageId: imageId,
      };
      quietly(() => {
        if (measurement.type === 'bidirectional') {
          const [a, b, c, d] = measurement.points;
          if (a === undefined || b === undefined || c === undefined || d === undefined) return;
          BidirectionalTool.hydrate(
            viewportId,
            [
              [mutable(a), mutable(b)],
              [mutable(c), mutable(d)],
            ],
            hydrateOptions,
          );
        } else {
          POINT_HYDRATORS[measurement.type](viewportId, [...measurement.points], hydrateOptions);
        }
        // Not every tool's `hydrate` makes the place its statistics go, and drawing needs it.
        const created = lookup(measurement.id);
        if (created !== undefined) created.data.cachedStats ??= {};
      });
    },
    update(measurement): void {
      const found = mine(measurement.id);
      const handles = found?.data.handles;
      if (found === undefined || handles === undefined) return;
      if (measurement.points.length !== HANDLE_COUNT[measurement.type]) return;
      quietly(() => {
        handles.points = copy(measurement.points);
        // Its numbers are worked out again the next time it is drawn.
        annotationApi.state.invalidateAnnotation(found);
      });
    },
    remove(id): void {
      if (mine(id) === undefined) return;
      quietly(() => {
        annotationApi.state.removeAnnotation(id);
      });
    },
    select(id): void {
      quietly(() => {
        for (const selected of annotationApi.selection.getAnnotationsSelected()) {
          if (selected !== id && mine(selected) !== undefined) {
            annotationApi.selection.deselectAnnotation(selected);
          }
        }
        if (id !== undefined && mine(id) !== undefined) {
          annotationApi.selection.setAnnotationSelected(id, true);
        }
      });
    },
    onChange(listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_COMPLETED, onCompleted);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_MODIFIED, onModified);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_REMOVED, onRemoved);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_SELECTION_CHANGE, onSelection);
      listeners.clear();
      quietly(() => {
        for (const found of annotationApi.state.getAllAnnotations()) {
          const imageId = found.metadata?.referencedImageId;
          if (imageId !== undefined && indexOf.has(imageId) && found.annotationUID !== undefined) {
            annotationApi.state.removeAnnotation(found.annotationUID);
          }
        }
      });
    },
  };
}
