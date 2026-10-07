import type { SeriesStack } from './data/types';
import type { MeasurementType, Point3 } from './measurements/model';
import type { PixelSlice } from './measurements/stats';
import type { SegmentationDisplay } from './segmentations/display';
import type { SegmentationHeader } from './segmentations/header';
import type { SegmentIndexResult } from './segmentations/segment-index';
import type { Unsubscribe } from './state/events';
import type { WindowLevel } from './state/viewer-state';
import type { PrimaryTool } from './tools';

export type { PixelSlice, WindowLevel };

/** A measurement as the engine draws it: a shape on one slice of the stack, in patient millimetres. */
export interface EngineMeasurement {
  /** The engine's own id for the shape, which the viewer keeps as the measurement's id. */
  readonly id: string;
  readonly type: MeasurementType;
  /** Position in the stack of the slice it is on. */
  readonly imageIndex: number;
  /** The handles, in the order the engine keeps them. */
  readonly points: readonly Point3[];
}

/** Something that happened to a shape drawn on a stack. Changes the viewer asked for are not reported. */
export type MeasurementChange =
  /** The person finished drawing a new shape. */
  | { readonly kind: 'completed'; readonly measurement: EngineMeasurement }
  /** A shape's handles moved, by the person's mouse. Arrives for every step of a drag. */
  | { readonly kind: 'modified'; readonly measurement: EngineMeasurement }
  | { readonly kind: 'removed'; readonly id: string }
  /** The person picked a shape, or `undefined` when none is picked any more. */
  | { readonly kind: 'selected'; readonly id: string | undefined };

/** How a stack looks now: the window, whether it is inverted, and how far it is zoomed. */
export interface ViewSnapshot {
  readonly window: WindowLevel;
  /** The window the images asked for. Taken when the stack was first shown. */
  readonly defaultWindow: WindowLevel;
  readonly invert: boolean;
  /** 1 fits the image to the viewport. */
  readonly zoom: number;
}

/**
 * A SEG parsed against the images it segments, and registered with the engine. It holds memory
 * (the labelmap images) until `dispose()`.
 */
export interface SegmentationHandle {
  /** The image ids it was parsed against, which a stack must have, in this order, to draw it. */
  readonly referencedImageIds: readonly string[];
  /** Number of labelmap layers; SEGs with overlapping segments have more than one. */
  readonly layerCount: number;
  /** Number of referenced images that received a labelmap frame (one per CT slice). */
  readonly labelmapFrameCount: number;
  /** Where each segment is, worked out on the compute worker. */
  readonly index: SegmentIndexResult;
  /** Segment number at one pixel of one image of the stack (the lowest layer that has one), or 0. */
  sample(imageIndex: number, row: number, column: number): number;
  /** Every segment number at one pixel, one per layer that has one. More than one means overlap. */
  sampleAll(imageIndex: number, row: number, column: number): number[];
  /** Gives back the labelmap images and what the engine holds for them. Stacks must have stopped drawing it. */
  dispose(): void;
}

/** One stack of slices drawn into one element. */
export interface StackPort {
  readonly imageCount: number;
  getImageIndex(): number;
  setImageIndex(index: number): Promise<void>;
  /** Called whenever the displayed slice changes: by the host, or by the user's mouse wheel. */
  onImageChange(listener: (imageIndex: number) => void): Unsubscribe;
  getView(): ViewSnapshot;
  setWindow(window: WindowLevel): void;
  setInvert(invert: boolean): void;
  /** Zooms about the middle of the viewport. The caller keeps `zoom` within the supported range. */
  setZoom(zoom: number): void;
  /** Back to the default window, no inversion, fit to the viewport, and centred. */
  resetView(): void;
  /** Which tool the left mouse button drives. The other buttons and the wheel keep their bindings. */
  setPrimaryTool(tool: PrimaryTool): void;
  /** Called whenever the view changes: by the host, or by the user's mouse. */
  onViewChange(listener: (view: ViewSnapshot) => void): Unsubscribe;
  /** Decodes one slice and returns the Hounsfield value of one pixel. */
  sampleHu(imageIndex: number, row: number, column: number): Promise<number>;
  /** Decodes one slice, so a shape's pixels can be read. */
  readSlice(imageIndex: number): Promise<PixelSlice>;
  /** Draws a shape. One for a slice this stack does not have, or one with an id already drawn, is ignored. */
  addMeasurement(measurement: EngineMeasurement): void;
  /** Moves the handles of a shape that is drawn. */
  updateMeasurement(measurement: EngineMeasurement): void;
  removeMeasurement(id: string): void;
  /** Picks one shape, or none. */
  selectMeasurement(id: string | undefined): void;
  /** Called when the person draws, moves, picks, or removes a shape. */
  onMeasurementChange(listener: (change: MeasurementChange) => void): Unsubscribe;
  /**
   * Draws a SEG over this stack, or changes how it is drawn if it already is. Resolves to `false`
   * for a SEG that was made for other images, which is not drawn.
   */
  drawSegmentation(handle: SegmentationHandle, display: SegmentationDisplay): boolean;
  /** Stops drawing a SEG over this stack. */
  hideSegmentation(handle: SegmentationHandle): void;
  /** Removes every shape and every SEG this stack draws, and stops reporting. */
  destroy(): void;
}

export interface RenderStackOptions {
  /** The slice to show first. Default: the middle one. Out-of-range values are clamped. */
  readonly imageIndex?: number | undefined;
  /**
   * After the first slice, load this many slices either side of the one on screen, nearest first,
   * and keep doing so as it moves. 0: only the slices that are asked for.
   */
  readonly prefetchRadius?: number | undefined;
}

/**
 * Everything the viewer needs from the rendering engine. Only `engine/` implements it, so nothing
 * above it touches Cornerstone and the public API never exposes Cornerstone types.
 */
export interface RenderingPort {
  renderStack(
    element: HTMLElement,
    stack: SeriesStack,
    options?: RenderStackOptions,
  ): Promise<StackPort>;
  /**
   * Draws one slice of a stack as a `size` by `size` picture (the image fitted, on black) without
   * WebGL, and returns it as an image data URL. It runs at the lowest priority, and does not keep
   * the slice in the image cache.
   */
  renderThumbnail(stack: SeriesStack, imageIndex: number, size: number): Promise<string>;
  /** Reads what a SEG says about itself from its bytes, without its pixels. Throws for a file that is not a readable SEG. */
  readSegmentationHeader(bytes: ArrayBuffer): SegmentationHeader;
  /**
   * Parses a SEG against the stack it segments, finds where its segments are, and registers it
   * with the engine. The header is the one `readSegmentationHeader` made. The stack need not be on
   * screen: the engine learns what it needs about its images, and lets go of them with the handle.
   */
  loadSegmentation(
    stack: SeriesStack,
    bytes: ArrayBuffer,
    header: SegmentationHeader,
  ): Promise<SegmentationHandle>;
  destroy(): void;
}
