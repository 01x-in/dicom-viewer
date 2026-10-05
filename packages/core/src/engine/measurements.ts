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
import type { MeasurementType } from '../measurements/model';
import type { EngineMeasurement, MeasurementChange } from '../rendering-port';
import { HANDLE_COUNT, hydrateInputOf, shapeOfAnnotation } from './annotation-shape';
import { MEASUREMENT_OF_TOOL } from './tools';

type Annotation = Types.Annotation;
type Handles = [number, number, number][];

/** What `hydrate` of every tool wants besides the handles: which image, and the id to keep. */
interface HydrateOptions {
  readonly annotationUID: string;
  readonly referencedImageId: string;
}

/** Tools that take their handles as a list of points. A bidirectional measurement takes two axes. */
const HANDLE_HYDRATORS: Readonly<
  Record<Exclude<MeasurementType, 'bidirectional'>, (...args: HydrateArguments) => unknown>
> = {
  length: (viewportId, points, options) => LengthTool.hydrate(viewportId, points, options),
  ellipse: (viewportId, points, options) => EllipticalROITool.hydrate(viewportId, points, options),
  rectangle: (viewportId, points, options) => RectangleROITool.hydrate(viewportId, points, options),
  probe: (viewportId, points, options) => ProbeTool.hydrate(viewportId, points, options),
  angle: (viewportId, points, options) => AngleTool.hydrate(viewportId, points, options),
};

type HydrateArguments = [viewportId: string, points: Handles, options: HydrateOptions];

/** Cornerstone's types say a lookup always finds something. It does not. */
function lookup(id: string): Annotation | undefined {
  return annotationApi.state.getAnnotation(id);
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

  const describe = (annotation: Annotation): EngineMeasurement | undefined =>
    shapeOfAnnotation(annotation, indexOf, MEASUREMENT_OF_TOOL);

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

  const mine = (id: string): Annotation | undefined => {
    const found = lookup(id);
    const imageId = found?.metadata?.referencedImageId;
    return imageId !== undefined && indexOf.has(imageId) ? found : undefined;
  };

  const onSelection = (event: Event): void => {
    if (quiet > 0) return;
    const { selection } = (event as CustomEvent<{ selection: string[] }>).detail;
    const picked = selection.find((id) => mine(id) !== undefined);
    if (picked !== undefined || selection.length === 0) emit({ kind: 'selected', id: picked });
  };

  eventTarget.addEventListener(Enums.Events.ANNOTATION_COMPLETED, onCompleted);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_MODIFIED, onModified);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_REMOVED, onRemoved);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_SELECTION_CHANGE, onSelection);

  return {
    add(measurement): void {
      if (destroyed || mine(measurement.id) !== undefined) return;
      const imageId = options.imageIds[measurement.imageIndex];
      const input = hydrateInputOf(measurement);
      if (imageId === undefined || input === undefined) return;
      const hydrateOptions: HydrateOptions = {
        annotationUID: measurement.id,
        referencedImageId: imageId,
      };
      quietly(() => {
        if (input.kind === 'axes') {
          BidirectionalTool.hydrate(viewportId, input.axes, hydrateOptions);
        } else if (measurement.type !== 'bidirectional') {
          HANDLE_HYDRATORS[measurement.type](viewportId, input.points, hydrateOptions);
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
        handles.points = measurement.points.map(([x, y, z]): [number, number, number] => [x, y, z]);
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
