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
  // Cornerstone keeps every annotation of the page in one store, keyed by frame of reference, so
  // another viewer showing the same images sees these shapes too. Only the ones created here, by
  // the person's mouse in this viewport or by the viewer's own calls, are this stack's.
  const owned = new Set<string>();
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

  const isOurs = (annotation: Annotation | undefined): annotation is Annotation =>
    annotation?.annotationUID !== undefined && owned.has(annotation.annotationUID);

  // Told when a shape is created, with the viewport it was created in: the one moment ownership is known.
  const onAdded = (event: Event): void => {
    const { annotation, viewportId: from } = (
      event as CustomEvent<{ annotation?: Annotation; viewportId?: string }>
    ).detail;
    const imageId = annotation?.metadata?.referencedImageId;
    const toolName = annotation?.metadata?.toolName;
    const id = annotation?.annotationUID;
    if (
      from === viewportId &&
      id !== undefined &&
      imageId !== undefined &&
      toolName !== undefined &&
      indexOf.has(imageId) &&
      MEASUREMENT_OF_TOOL.has(toolName)
    ) {
      owned.add(id);
    }
  };
  const onCompleted = (event: Event): void => {
    if (quiet > 0) return;
    const annotation = detail(event);
    const measurement = isOurs(annotation) ? describe(annotation) : undefined;
    if (measurement !== undefined) emit({ kind: 'completed', measurement });
  };
  const onModified = (event: Event): void => {
    if (quiet > 0) return;
    const annotation = detail(event);
    const measurement = isOurs(annotation) ? describe(annotation) : undefined;
    if (measurement !== undefined) emit({ kind: 'modified', measurement });
  };
  const onRemoved = (event: Event): void => {
    const id = detail(event)?.annotationUID;
    if (id === undefined) return;
    // Gone from Cornerstone, whoever did it: no longer ours.
    const wasOurs = owned.delete(id);
    if (quiet === 0 && wasOurs) emit({ kind: 'removed', id });
  };

  const mine = (id: string): Annotation | undefined => (owned.has(id) ? lookup(id) : undefined);

  const onSelection = (event: Event): void => {
    if (quiet > 0) return;
    const { selection } = (event as CustomEvent<{ selection: string[] }>).detail;
    const picked = selection.find((id) => owned.has(id));
    if (picked !== undefined || selection.length === 0) emit({ kind: 'selected', id: picked });
  };

  eventTarget.addEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_COMPLETED, onCompleted);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_MODIFIED, onModified);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_REMOVED, onRemoved);
  eventTarget.addEventListener(Enums.Events.ANNOTATION_SELECTION_CHANGE, onSelection);

  return {
    add(measurement): void {
      // An id Cornerstone already has, here or for another viewer, is not drawn a second time.
      if (destroyed || lookup(measurement.id) !== undefined) return;
      const imageId = options.imageIds[measurement.imageIndex];
      const input = hydrateInputOf(measurement);
      if (imageId === undefined || input === undefined) return;
      const hydrateOptions: HydrateOptions = {
        annotationUID: measurement.id,
        referencedImageId: imageId,
      };
      owned.add(measurement.id);
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
      if (mine(id) === undefined) {
        owned.delete(id);
        return;
      }
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
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_ADDED, onAdded);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_COMPLETED, onCompleted);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_MODIFIED, onModified);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_REMOVED, onRemoved);
      eventTarget.removeEventListener(Enums.Events.ANNOTATION_SELECTION_CHANGE, onSelection);
      listeners.clear();
      quietly(() => {
        for (const id of owned) annotationApi.state.removeAnnotation(id);
        owned.clear();
      });
    },
  };
}
