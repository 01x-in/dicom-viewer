import type { SeriesStack } from './data/types';
import type { Unsubscribe } from './state/events';
import type { WindowLevel } from './state/viewer-state';
import type { PrimaryTool } from './tools';

export type { WindowLevel };

/** How a stack looks now: the window, whether it is inverted, and how far it is zoomed. */
export interface ViewSnapshot {
  readonly window: WindowLevel;
  /** The window the images asked for. Taken when the stack was first shown. */
  readonly defaultWindow: WindowLevel;
  readonly invert: boolean;
  /** 1 fits the image to the viewport. */
  readonly zoom: number;
}

export interface SegmentInfo {
  readonly number: number;
  readonly label: string;
}

export interface SegmentationHandle {
  readonly segments: readonly SegmentInfo[];
  /** Number of referenced images that received a labelmap frame (one per CT slice). */
  readonly labelmapFrameCount: number;
  /** Number of labelmap layers; SEGs with overlapping segments have more than one. */
  readonly layerCount: number;
  /** Segment number at one pixel of one CT slice (the lowest layer that has one), or 0. */
  sample(sliceIndex: number, row: number, column: number): number;
  /** Every segment number at one pixel, one per layer that has one. More than one means overlap. */
  sampleAll(sliceIndex: number, row: number, column: number): number[];
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
  destroy(): void;
}

export interface RenderStackOptions {
  /** The slice to show first. Default: the middle one. Out-of-range values are clamped. */
  readonly imageIndex?: number | undefined;
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
  /** Parses a SEG against the images it segments (a stack's image ids). */
  loadSegmentation(imageIds: readonly string[], bytes: ArrayBuffer): Promise<SegmentationHandle>;
  destroy(): void;
}
