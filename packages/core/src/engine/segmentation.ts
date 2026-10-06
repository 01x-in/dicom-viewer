import { adaptersSEG } from '@cornerstonejs/adapters';
import {
  cache,
  getShouldUseCPURendering,
  getWebWorkerManager,
  imageLoader,
  type Types,
  metaData,
} from '@cornerstonejs/core';
import { Enums as ToolsEnums, segmentation } from '@cornerstonejs/tools';
import { z } from 'zod';
import type { SegmentationHandle } from '../rendering-port';
import type { SegmentationDisplay } from '../segmentations/display';
import {
  decodeBinarySegmentation,
  type DecodeBinaryInput,
  type DecodeBinaryResult,
} from '../segmentations/decode-binary';
import type { SegmentationHeader } from '../segmentations/header';
import { planBinaryDecode, type BinaryPlan } from '../segmentations/plan';
import {
  buildSegmentIndex as buildSegmentIndexOnThisThread,
  type SegmentIndexInput,
  type SegmentIndexResult,
} from '../segmentations/segment-index';

const COMPUTE_WORKER_NAME = 'compute';

/**
 * The SEG adapters look an image's SOP instance up in `generalImageModule`, where Cornerstone's
 * metadata no longer has it (it is in `sopCommonModule`). Without this, no frame is matched to its
 * image by SOP instance: each falls back to matching by position, with a warning for every frame,
 * and a SEG whose planes are off finds none.
 */
const adapterMetadata = {
  get(type: string, imageId: string): unknown {
    const module: unknown = metaData.get(type, imageId);
    if (type !== 'generalImageModule' || typeof module !== 'object' || module === null) {
      return module;
    }
    const common: unknown = metaData.get('sopCommonModule', imageId);
    const sopInstanceUID =
      typeof common === 'object' && common !== null && 'sopInstanceUID' in common
        ? common.sopInstanceUID
        : undefined;
    return { ...module, sopInstanceUID };
  },
};

/**
 * The adapters return `any`-typed results, so everything this module relies on is checked here.
 * `labelMapImages[layer][n]` is the labelmap for referenced image n. A SEG whose segments do not
 * overlap has one layer.
 */
const adapterResultSchema = z.object({
  labelMapImages: z.array(z.array(z.unknown())),
});

interface LabelmapImage {
  readonly imageId: string;
  readonly referencedImageId: string;
  readonly columns: number;
  readonly rows: number;
  readonly scalars: ArrayLike<number>;
}

function isLabelmapImage(value: unknown): value is Types.IImage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'imageId' in value &&
    'columns' in value &&
    'voxelManager' in value
  );
}

function labelmapImage(image: Types.IImage): LabelmapImage {
  const scalars = image.voxelManager?.getScalarData();
  if (scalars === undefined) throw new Error('A labelmap image has no pixel data.');
  return {
    imageId: image.imageId,
    referencedImageId: image.referencedImageId ?? '',
    columns: image.columns,
    rows: image.rows,
    scalars,
  };
}

/** One labelmap layer that Cornerstone knows as a segmentation of its own. */
interface Layer {
  readonly segmentationId: string;
  /**
   * A second segmentation over the same labelmap images, drawn as outlines only. A labelmap
   * outlines all of its segments or none, so outlining some takes a labelmap of its own.
   */
  readonly outlineSegmentationId: string;
  /** The labelmap images of this layer, one for each image of the stack that has one. */
  readonly imageIds: readonly string[];
  /** The segments that have pixels on this layer. */
  readonly segments: readonly { readonly number: number; readonly label: string }[];
}

interface Loaded {
  readonly layers: readonly Layer[];
  readonly referencedImageIds: readonly string[];
  disposed: boolean;
}

/** What the engine keeps for each handle it gave out. The handle itself is plain data and methods. */
const loadedByHandle = new WeakMap<SegmentationHandle, Loaded>();
let segmentationCount = 0;

/** How many Cornerstone segmentations the engine holds, for the leak check. */
export function segmentationsHeld(): number {
  return segmentation.state.getSegmentations().length;
}

/** Runs a method of the compute worker, or the same function here if the worker cannot be had. */
async function onWorker<I extends object, O>(
  method: string,
  input: I,
  here: (input: I) => O,
): Promise<O> {
  try {
    return await getWebWorkerManager().executeTask(COMPUTE_WORKER_NAME, method, input);
  } catch (error) {
    // The worker is the way to do it without freezing the page, but a missing worker is no reason
    // to lose the SEG: say so, and do it here.
    console.warn(`The compute worker could not run ${method}; running it on the page.`, error);
    return here(input);
  }
}

const computeIndex = (input: SegmentIndexInput): Promise<SegmentIndexResult> =>
  onWorker('segmentIndex', input, buildSegmentIndexOnThisThread);

const computeDecode = (input: DecodeBinaryInput): Promise<DecodeBinaryResult> =>
  onWorker('decodeSegmentation', input, decodeBinarySegmentation);

/** The labelmaps of a SEG once they are in Cornerstone's cache: what both ways of reading one end in. */
interface Decoded {
  /** One entry for each layer. */
  readonly layers: readonly {
    /** The labelmap images of the layer, in the cache. */
    readonly imageIds: readonly string[];
    /** The pixels of the layer's image for each image of the stack, `undefined` where it has none. */
    readonly frames: readonly (ArrayLike<number> | undefined)[];
  }[];
  readonly index: SegmentIndexResult;
}

function sopInstanceOf(imageId: string): string | undefined {
  const common: unknown = metaData.get('sopCommonModule', imageId);
  return typeof common === 'object' &&
    common !== null &&
    'sopInstanceUID' in common &&
    typeof common.sopInstanceUID === 'string'
    ? common.sopInstanceUID
    : undefined;
}

function removeFromCache(imageIds: readonly string[]): void {
  for (const imageId of imageIds) {
    if (cache.getImage(imageId) !== undefined) cache.removeImageLoadObject(imageId);
  }
}

/** Reads a binary SEG on the compute worker, and makes Cornerstone's labelmap images from what it finds. */
async function decodeOnWorker(
  imageIds: readonly string[],
  bytes: ArrayBuffer,
  header: SegmentationHeader,
  plan: BinaryPlan,
): Promise<Decoded> {
  const { pixelData, rows, columns } = header;
  if (pixelData === undefined) throw new Error('The SEG has no pixel data.');
  const decoded = await computeDecode({
    pixelData: new Uint8Array(bytes, pixelData.offset, pixelData.length),
    rows,
    columns,
    imageCount: imageIds.length,
    frames: plan.frames,
  });
  const created: string[] = [];
  try {
    const layers = decoded.layers.map((buffer, layerIndex) => {
      const pixels = rows * columns;
      const here = new Set(
        decoded.index.segments
          .filter((segment) => segment.layer === layerIndex)
          .flatMap((segment) => segment.imageIndices),
      );
      const frames: (ArrayLike<number> | undefined)[] = [];
      const layerImageIds: string[] = [];
      // An image for every image of the stack, empty ones too: where there is none, Cornerstone
      // goes on drawing the labelmap of the last image that had one.
      for (const [stackIndex, referenced] of imageIds.entries()) {
        // Segment numbers above 255 need 16 bits, which the labelmap helper does not make.
        const image =
          buffer instanceof Uint16Array
            ? imageLoader.createAndCacheDerivedImage(referenced, {
                targetBuffer: { type: 'Uint16Array' },
              })
            : imageLoader.createAndCacheDerivedLabelmapImage(referenced);
        created.push(image.imageId);
        layerImageIds.push(image.imageId);
        if (!here.has(stackIndex)) continue;
        const target = image.voxelManager?.getWritableScalarData();
        if (target === undefined) throw new Error('A labelmap image has no pixel data.');
        if (target.length !== pixels) {
          throw new Error(
            `The SEG is ${rows.toString()} by ${columns.toString()} pixels, but its images are not.`,
          );
        }
        target.set(buffer.subarray(stackIndex * pixels, (stackIndex + 1) * pixels));
        frames[stackIndex] = target;
      }
      return { imageIds: layerImageIds, frames };
    });
    return { layers, index: decoded.index };
  } catch (error) {
    removeFromCache(created);
    throw error;
  }
}

/** Reads a SEG through the Cornerstone adapters, which take any kind but read the frames on the page. */
async function decodeWithAdapters(
  imageIds: readonly string[],
  bytes: ArrayBuffer,
): Promise<Decoded> {
  const result: unknown = await adaptersSEG.Cornerstone3D.Segmentation.createFromDICOMSegBuffer(
    [...imageIds],
    bytes,
    { metadataProvider: adapterMetadata },
  );
  const { labelMapImages } = adapterResultSchema.parse(result);
  const layers = labelMapImages.map((layer) => layer.filter(isLabelmapImage).map(labelmapImage));
  const created = layers.flatMap((layer) => layer.map((image) => image.imageId));
  const positionOf = new Map(imageIds.map((imageId, position) => [imageId, position]));
  const [first] = layers.flatMap((layer) => layer.slice(0, 1));
  try {
    if (first === undefined) throw new Error('The SEG produced no labelmap images.');
    const framesOf = layers.map((layer) => {
      const frames: (ArrayLike<number> | undefined)[] = [];
      for (const image of layer) {
        const position = positionOf.get(image.referencedImageId);
        if (position !== undefined) frames[position] = image.scalars;
      }
      return frames;
    });
    const index = await computeIndex({
      rows: first.rows,
      columns: first.columns,
      layers: framesOf,
    });
    return {
      layers: layers.map((layer, layerIndex) => ({
        imageIds: layer.map((image) => image.imageId),
        frames: framesOf[layerIndex] ?? [],
      })),
      index,
    };
  } catch (error) {
    removeFromCache(created);
    throw error;
  }
}

function addLabelmapSegmentation(
  segmentationId: string,
  imageIds: readonly string[],
  referencedImageIds: readonly string[],
  segments: Layer['segments'],
): void {
  segmentation.addSegmentations([
    {
      segmentationId,
      representation: {
        type: ToolsEnums.SegmentationRepresentations.Labelmap,
        data: { imageIds: [...imageIds], referencedImageIds: [...referencedImageIds] },
      },
      config: {
        segments: Object.fromEntries(
          segments.map(({ number, label }) => [
            number,
            { segmentIndex: number, label, locked: true, active: false },
          ]),
        ),
      },
    },
  ]);
}

/**
 * Reads a DICOM SEG against the images it segments, finds where each segment is, and registers what
 * it made with Cornerstone. A binary SEG whose frames name their images is decoded on the compute
 * worker; any other is read by the Cornerstone adapters. The result holds what it made until `dispose()`.
 */
export async function parseSegmentation(
  imageIds: readonly string[],
  bytes: ArrayBuffer,
  header: SegmentationHeader,
): Promise<SegmentationHandle> {
  const labels = new Map(header.segments.map((segment) => [segment.number, segment.label]));
  const plan = planBinaryDecode(
    header,
    imageIds.map((imageId) => sopInstanceOf(imageId) ?? ''),
  );
  const decoded =
    plan === undefined
      ? await decodeWithAdapters(imageIds, bytes)
      : await decodeOnWorker(imageIds, bytes, header, plan);
  const { index } = decoded;
  const allImageIds = decoded.layers.flatMap((layer) => layer.imageIds);
  const registered: Layer[] = [];
  try {
    segmentationCount += 1;
    const handleId = `dv-seg-${segmentationCount.toString()}`;
    decoded.layers.forEach((layer, layerIndex) => {
      const entry: Layer = {
        segmentationId: `${handleId}-layer-${layerIndex.toString()}`,
        outlineSegmentationId: `${handleId}-layer-${layerIndex.toString()}-outline`,
        imageIds: layer.imageIds,
        segments: index.segments
          .filter((segment) => segment.layer === layerIndex)
          .map((segment) => ({
            number: segment.number,
            label: labels.get(segment.number) ?? `Segment ${segment.number.toString()}`,
          })),
      };
      addLabelmapSegmentation(entry.segmentationId, entry.imageIds, imageIds, entry.segments);
      registered.push(entry);
      addLabelmapSegmentation(
        entry.outlineSegmentationId,
        entry.imageIds,
        imageIds,
        entry.segments,
      );
    });

    const columns = header.columns;
    const sampleAll = (stackIndex: number, row: number, column: number): number[] =>
      decoded.layers.flatMap((layer) => {
        const value = layer.frames[stackIndex]?.[row * columns + column] ?? 0;
        return value === 0 ? [] : [value];
      });

    const loaded: Loaded = {
      layers: registered,
      referencedImageIds: [...imageIds],
      disposed: false,
    };
    const handle: SegmentationHandle = {
      referencedImageIds: [...imageIds],
      layerCount: decoded.layers.length,
      labelmapFrameCount: decoded.layers[0]?.imageIds.length ?? 0,
      index,
      sample: (stackIndex, row, column) => sampleAll(stackIndex, row, column)[0] ?? 0,
      sampleAll,
      dispose(): void {
        if (loaded.disposed) return;
        loaded.disposed = true;
        for (const layer of loaded.layers) {
          segmentation.removeSegmentation(layer.segmentationId);
          segmentation.removeSegmentation(layer.outlineSegmentationId);
        }
        removeFromCache(allImageIds);
      },
    };
    loadedByHandle.set(handle, loaded);
    return handle;
  } catch (error) {
    for (const layer of registered) {
      segmentation.removeSegmentation(layer.segmentationId);
      segmentation.removeSegmentation(layer.outlineSegmentationId);
    }
    removeFromCache(allImageIds);
    throw error;
  }
}

/** What is asked of one segment in one representation. */
interface SegmentLook {
  readonly color: readonly [number, number, number, number];
  readonly visible: boolean;
}

/** One representation of a labelmap in one viewport, and what was last applied to it. */
interface Representation {
  readonly segmentationId: string;
  readonly colorLUTIndex: number;
  readonly applied: Map<number, SegmentLook>;
}

interface DrawnLayer {
  readonly layer: Layer;
  readonly fill: Representation;
  /** Added the first time a segment of this layer is outlined. */
  outline: Representation | undefined;
}

const { SegmentationRepresentations } = ToolsEnums;
const LABELMAP = SegmentationRepresentations.Labelmap;

/** A plain fill, the same whether or not Cornerstone counts the labelmap as its active one. */
const FILL_STYLE = {
  renderFill: true,
  renderFillInactive: true,
  fillAlpha: 1,
  fillAlphaInactive: 1,
  renderOutline: false,
  renderOutlineInactive: false,
} as const;

/** Outlines and nothing else. */
const OUTLINE_STYLE = {
  renderFill: false,
  renderFillInactive: false,
  renderOutline: true,
  renderOutlineInactive: true,
  outlineWidth: 3,
  outlineWidthInactive: 3,
  outlineOpacity: 1,
  outlineOpacityInactive: 1,
} as const;

function sameImages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((imageId, position) => imageId === b[position]);
}

function lookOf(
  color: readonly [number, number, number],
  alpha: number,
  visible: boolean,
): SegmentLook {
  return { color: [color[0], color[1], color[2], Math.round(alpha * 255)], visible };
}

export interface StackSegmentations {
  /**
   * Draws a SEG over this stack, or changes how it is drawn. Returns `false` for a SEG that was
   * made for other images, which is not drawn.
   */
  draw(handle: SegmentationHandle, display: SegmentationDisplay): boolean;
  hide(handle: SegmentationHandle): void;
  /** Takes every SEG off this stack. */
  destroy(): void;
}

/** The SEGs one stack shows, in one viewport. */
export function trackSegmentations(options: {
  readonly viewportId: string;
  readonly imageIds: readonly string[];
}): StackSegmentations {
  const { viewportId, imageIds } = options;
  const drawn = new Map<SegmentationHandle, DrawnLayer[]>();

  function addRepresentation(
    segmentationId: string,
    style: typeof FILL_STYLE | typeof OUTLINE_STYLE,
    looks: ReadonlyMap<number, SegmentLook>,
  ): Representation {
    const size = Math.max(0, ...looks.keys()) + 1;
    const lut: [number, number, number, number][] = Array.from({ length: size }, () => [
      0, 0, 0, 0,
    ]);
    for (const [number, look] of looks) lut[number] = [...look.color];
    segmentation.segmentationStyle.setStyle({ viewportId, segmentationId, type: LABELMAP }, style);
    segmentation.addLabelmapRepresentationToViewport(viewportId, [
      { segmentationId, config: { colorLUTOrIndex: lut } },
    ]);
    const added = segmentation.state.getSegmentationRepresentation(viewportId, {
      segmentationId,
      type: LABELMAP,
    });
    const applied = new Map<number, SegmentLook>();
    // The LUT already has the colours, but a hidden segment must still be hidden.
    const hidden = new Map<number, SegmentLook>();
    for (const [number, look] of looks) {
      applied.set(number, { color: look.color, visible: true });
      hidden.set(number, look);
    }
    const representation: Representation = {
      segmentationId,
      colorLUTIndex: added?.colorLUTIndex ?? -1,
      applied,
    };
    applyLooks(representation, hidden);
    return representation;
  }

  function applyLooks(
    representation: Representation,
    looks: ReadonlyMap<number, SegmentLook>,
  ): void {
    const { segmentationId, applied } = representation;
    for (const [number, look] of looks) {
      const before = applied.get(number);
      if (before === undefined || before.color.some((channel, at) => channel !== look.color[at])) {
        segmentation.config.color.setSegmentIndexColor(viewportId, segmentationId, number, [
          ...look.color,
        ]);
      }
      if (before?.visible !== look.visible) {
        segmentation.config.visibility.setSegmentIndexVisibility(
          viewportId,
          { segmentationId, type: LABELMAP },
          number,
          look.visible,
        );
      }
      applied.set(number, look);
    }
  }

  function release(representation: Representation): void {
    segmentation.removeSegmentationRepresentations(viewportId, {
      segmentationId: representation.segmentationId,
      type: LABELMAP,
    });
    if (representation.colorLUTIndex >= 0) {
      segmentation.state.removeColorLUT(representation.colorLUTIndex);
    }
  }

  function hide(handle: SegmentationHandle): void {
    const layers = drawn.get(handle);
    if (layers === undefined) return;
    drawn.delete(handle);
    for (const entry of layers) {
      release(entry.fill);
      if (entry.outline !== undefined) release(entry.outline);
    }
  }

  return {
    draw(handle, display): boolean {
      // Cornerstone draws a labelmap as a WebGL actor, and fails with an error on a CPU-rendered stack.
      if (getShouldUseCPURendering()) return false;
      const loaded = loadedByHandle.get(handle);
      if (loaded === undefined || loaded.disposed) return false;
      if (!sameImages(loaded.referencedImageIds, imageIds)) return false;
      const layers = drawn.get(handle) ?? [];
      const fresh = !drawn.has(handle);
      drawn.set(handle, layers);
      loaded.layers.forEach((layer, layerIndex) => {
        const mine = display.segments.filter((shown) =>
          layer.segments.some((segment) => segment.number === shown.number),
        );
        const fills = new Map(
          mine.map((shown) => [shown.number, lookOf(shown.color, shown.alpha, shown.visible)]),
        );
        const outlines = new Map(
          mine.map((shown) => [
            shown.number,
            lookOf(shown.color, 1, shown.visible && shown.outline),
          ]),
        );
        let entry = layers[layerIndex];
        if (entry === undefined || fresh) {
          entry = {
            layer,
            fill: addRepresentation(layer.segmentationId, FILL_STYLE, fills),
            outline: undefined,
          };
          layers[layerIndex] = entry;
        } else {
          applyLooks(entry.fill, fills);
        }
        const anyOutline = [...outlines.values()].some((look) => look.visible);
        if (entry.outline === undefined && anyOutline) {
          entry.outline = addRepresentation(layer.outlineSegmentationId, OUTLINE_STYLE, outlines);
        } else if (entry.outline !== undefined) {
          applyLooks(entry.outline, outlines);
        }
      });
      return true;
    },
    hide,
    destroy(): void {
      for (const handle of [...drawn.keys()]) hide(handle);
      segmentation.segmentationStyle.clearViewportStyle(viewportId);
    },
  };
}
