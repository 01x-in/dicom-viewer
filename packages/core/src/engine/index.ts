// The only module family that may import Cornerstone (see eslint.config.js and docs/plan.md).
import {
  cache,
  Enums,
  getRenderingEngines,
  imageLoadPoolManager,
  imageRetrievalPoolManager,
  getWebWorkerManager,
  imageLoader,
  RenderingEngine,
  StackViewport,
  utilities as coreUtilities,
} from '@cornerstonejs/core';
import {
  Enums as MetadataEnums,
  metaData,
  utilities as metadataUtilities,
} from '@cornerstonejs/metadata';
import type { FrameRequestPolicy, SeriesInstance, SeriesStack } from '../data/types';
import { provideEngineDiagnostics } from '../diagnostics';
import type {
  PixelSlice,
  RenderingPort,
  RenderStackOptions,
  StackPort,
  ViewSnapshot,
  WindowLevel,
} from '../rendering-port';
import { isLocalFileImageId, registerLocalFile } from './local-files';
import { annotation as annotationApi, utilities as toolsUtilities } from '@cornerstonejs/tools';
import { acquireRuntime, activeViewers, frameRequests, releaseRuntime } from './runtime';
import type { RuntimeOptions } from './runtime';
import {
  parseSegmentation,
  segmentationsHeld,
  trackSegmentations,
  type StackSegmentations,
} from './segmentation';
import { readSegmentationHeader } from './segmentation-header';
import { trackMeasurements, type StackMeasurements } from './measurements';
import { attachStackTools, type StackTools } from './tools';

export interface EngineOptions extends RuntimeOptions {
  /** Applies the host's headers and token refresh to the frames the loader fetches. */
  readonly frameRequests?: FrameRequestPolicy | undefined;
}

let engineCount = 0;

/** Tells Cornerstone what the instance's headers say, so its image can be loaded and drawn. */
function registerInstance(instance: SeriesInstance): Promise<void> {
  return isLocalFileImageId(instance.imageId)
    ? registerLocalFile(instance.imageId)
    : metadataUtilities.addDicomWebInstance(instance.imageId, instance.metadata);
}

/** The picture on a black square, with the image fitted inside it. */
function fitOnSquare(source: HTMLCanvasElement, size: number): string {
  const square = document.createElement('canvas');
  square.width = size;
  square.height = size;
  const context = square.getContext('2d');
  if (context === null) throw new Error('A 2D canvas is not available.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / source.width, size / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  return square.toDataURL('image/jpeg', 0.8);
}

/**
 * How many live stacks use each image id. Stacks of different viewers may show the same series,
 * so an image is dropped from the cache, and its metadata forgotten, only with the last of them.
 */
const imageUsers = new Map<string, number>();

function claimImages(imageIds: readonly string[]): void {
  for (const imageId of imageIds) imageUsers.set(imageId, (imageUsers.get(imageId) ?? 0) + 1);
}

function releaseImages(imageIds: readonly string[]): void {
  const dropped = new Set<string>();
  for (const imageId of imageIds) {
    const users = (imageUsers.get(imageId) ?? 1) - 1;
    if (users > 0) {
      imageUsers.set(imageId, users);
      continue;
    }
    imageUsers.delete(imageId);
    dropped.add(imageId);
    // Only slices that were actually loaded are in the cache; removing any other throws.
    if (cache.getImageLoadObject(imageId) !== undefined) cache.removeImageLoadObject(imageId);
    metaData.clearQuery(MetadataEnums.MetadataModules.NATURALIZED, imageId);
  }
  if (dropped.size === 0) return;
  // Slices of this stack still waiting to be fetched or decoded are of no use to anyone now. Those
  // already being fetched cannot be called back, and finish into a cache that no longer has them.
  const stillWanted = ({ additionalDetails }: { additionalDetails: unknown }): boolean => {
    const id =
      typeof additionalDetails === 'object' &&
      additionalDetails !== null &&
      'imageId' in additionalDetails
        ? additionalDetails.imageId
        : undefined;
    return typeof id !== 'string' || !dropped.has(id);
  };
  imageLoadPoolManager.filterRequests(stillWanted);
  imageRetrievalPoolManager.filterRequests(stillWanted);
}

provideEngineDiagnostics(() => {
  const engines = getRenderingEngines() ?? [];
  const registry = getWebWorkerManager().workerRegistry;
  return {
    renderingEngines: engines.length,
    viewports: engines.reduce((sum, engine) => sum + engine.getViewports().length, 0),
    cacheBytes: cache.getCacheSize(),
    workers: Object.values(registry).reduce(
      (sum, worker) =>
        sum + worker.instances.filter((instance: unknown) => instance !== null).length,
      0,
    ),
    activeEngines: activeViewers(),
    imagesInUse: imageUsers.size,
    annotations: annotationApi.state.getAllAnnotations().length,
    segmentations: segmentationsHeld(),
  };
});

export async function createEngine(options: EngineOptions): Promise<RenderingPort> {
  await acquireRuntime(options);
  // From here the runtime counts this engine, so everything below must end in a release.
  let renderingEngine: RenderingEngine;
  let unregisterFrameRequests: (() => void) | undefined;
  try {
    unregisterFrameRequests =
      options.frameRequests === undefined
        ? undefined
        : frameRequests.register(options.frameRequests);
    engineCount += 1;
    renderingEngine = new RenderingEngine(`dv-engine-${engineCount.toString()}`);
  } catch (error) {
    unregisterFrameRequests?.();
    releaseRuntime();
    throw error;
  }
  const renderingEngineId = renderingEngine.id;
  let viewportCount = 0;
  let destroyed = false;
  // Renders still being set up. destroy() waits for them, so a viewport is never half-built on a disposed engine.
  const pending = new Set<Promise<unknown>>();

  function assertNotDestroyed(): void {
    if (destroyed) throw new Error('The engine was destroyed.');
  }

  async function setUpStack(
    element: HTMLElement,
    stack: SeriesStack,
    renderOptions: RenderStackOptions,
  ): Promise<StackPort> {
    assertNotDestroyed();
    claimImages(stack.imageIds);
    let viewportId: string | undefined;
    let tools: StackTools | undefined;
    let measurements: StackMeasurements | undefined;
    let segmentations: StackSegmentations | undefined;
    let stopContextMenu: (() => void) | undefined;
    let stopPrefetch: (() => void) | undefined;
    try {
      await Promise.all(stack.instances.map(registerInstance));

      assertNotDestroyed();
      viewportCount += 1;
      viewportId = `${renderingEngineId}-vp-${viewportCount.toString()}`;
      renderingEngine.enableElement({
        viewportId,
        type: Enums.ViewportType.STACK,
        element: element as HTMLDivElement,
      });
      const viewport = renderingEngine.getViewport(viewportId);
      if (!(viewport instanceof StackViewport)) {
        throw new Error(`Expected a stack viewport for ${viewportId}.`);
      }
      const last = stack.imageIds.length - 1;
      const first =
        renderOptions.imageIndex === undefined
          ? Math.floor(stack.imageIds.length / 2)
          : Math.min(Math.max(0, Math.trunc(renderOptions.imageIndex)), last);
      await viewport.setStack([...stack.imageIds], first);
      assertNotDestroyed();
      viewport.render();
      tools = attachStackTools(renderingEngineId, viewportId);
      measurements = trackMeasurements({ viewportId, imageIds: stack.imageIds });
      segmentations = trackSegmentations({ viewportId, imageIds: stack.imageIds });
      // The right button zooms, so the browser's menu must not open over the drag.
      const blockMenu = (event: Event): void => {
        event.preventDefault();
      };
      element.addEventListener('contextmenu', blockMenu);
      stopContextMenu = (): void => {
        element.removeEventListener('contextmenu', blockMenu);
      };

      const radius = renderOptions.prefetchRadius ?? 0;
      if (radius > 0) {
        // The first slice is already loading as part of setStack, at interaction priority. Prefetch
        // runs below that and follows the slice on screen. Cornerstone keeps this setting once per page.
        const { stackPrefetch } = toolsUtilities;
        stackPrefetch.setConfiguration({
          ...stackPrefetch.getConfiguration(),
          maxImagesToPrefetch: radius,
        });
        stackPrefetch.enable(element);
        stopPrefetch = (): void => {
          stackPrefetch.disable(element);
        };
      }

      const readWindow = (): WindowLevel => {
        const range = viewport.getProperties().voiRange;
        if (range !== undefined) {
          return {
            center: (range.upper + range.lower) / 2,
            width: Math.max(range.upper - range.lower, 1),
          };
        }
        // No window yet: show the whole range of the image.
        const image = viewport.getCornerstoneImage();
        const lower = image.minPixelValue * image.slope + image.intercept;
        const upper = image.maxPixelValue * image.slope + image.intercept;
        return { center: (upper + lower) / 2, width: Math.max(upper - lower, 1) };
      };
      const defaultWindow = readWindow();
      const getView = (): ViewSnapshot => ({
        window: readWindow(),
        defaultWindow,
        invert: viewport.getProperties().invert ?? false,
        zoom: viewport.getZoom(),
      });
      const setWindow = (window: WindowLevel): void => {
        viewport.setProperties({
          voiRange: {
            lower: window.center - window.width / 2,
            upper: window.center + window.width / 2,
          },
        });
        viewport.render();
      };

      const readSlice = async (imageIndex: number): Promise<PixelSlice> => {
        const imageId = stack.imageIds[imageIndex];
        if (imageId === undefined) {
          throw new RangeError(`No image at index ${imageIndex.toString()}.`);
        }
        const image = await imageLoader.loadAndCacheImage(imageId);
        const scalars = image.voxelManager?.getScalarData();
        if (scalars === undefined) throw new Error('The image has no scalar data.');
        // With pre-scaling on (the default) the loader has already applied slope and intercept.
        const scaled = image.preScale?.scaled === true;
        const { rows, columns, slope, intercept } = image;
        return {
          rows,
          columns,
          at(row, column): number {
            const stored = scalars[row * columns + column];
            if (stored === undefined) throw new RangeError('The pixel is outside the image.');
            return scaled ? stored : stored * slope + intercept;
          },
        };
      };

      const enabledViewportId = viewportId;
      let stackDestroyed = false;
      return {
        imageCount: stack.imageIds.length,
        getImageIndex: () => viewport.getCurrentImageIdIndex(),
        async setImageIndex(index): Promise<void> {
          await viewport.setImageIdIndex(index);
        },
        onImageChange(listener): () => void {
          // The event carries the new index. Ask the viewport instead and you get the old one: it
          // updates its own index after the event fires.
          const handler = (event: Event): void => {
            const index = (event as CustomEvent<{ imageIdIndex: number }>).detail.imageIdIndex;
            listener(index);
          };
          element.addEventListener(Enums.Events.STACK_NEW_IMAGE, handler);
          return (): void => {
            element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, handler);
          };
        },
        getView,
        setWindow,
        setPrimaryTool(tool): void {
          tools?.setPrimary(tool);
        },
        setInvert(invert): void {
          viewport.setProperties({ invert });
          viewport.render();
        },
        setZoom(zoom): void {
          viewport.setZoom(zoom);
          viewport.render();
        },
        resetView(): void {
          // The window goes back to the one the first image asked for, not to the current image's
          // own, so a reset after scrolling looks the same as one before.
          viewport.setProperties({
            voiRange: {
              lower: defaultWindow.center - defaultWindow.width / 2,
              upper: defaultWindow.center + defaultWindow.width / 2,
            },
            invert: false,
          });
          viewport.resetCamera({ resetPan: true, resetZoom: true });
          viewport.render();
        },
        onViewChange(listener): () => void {
          const handler = (): void => {
            listener(getView());
          };
          element.addEventListener(Enums.Events.VOI_MODIFIED, handler);
          element.addEventListener(Enums.Events.CAMERA_MODIFIED, handler);
          return (): void => {
            element.removeEventListener(Enums.Events.VOI_MODIFIED, handler);
            element.removeEventListener(Enums.Events.CAMERA_MODIFIED, handler);
          };
        },
        async sampleHu(imageIndex, row, column): Promise<number> {
          const slice = await readSlice(imageIndex);
          // Check each axis, not the flattened offset: column -1 or `columns` would otherwise land on a
          // neighbouring row and return a wrong pixel instead of failing.
          if (
            !Number.isInteger(row) ||
            !Number.isInteger(column) ||
            row < 0 ||
            row >= slice.rows ||
            column < 0 ||
            column >= slice.columns
          ) {
            throw new RangeError(
              `Pixel (${row.toString()}, ${column.toString()}) is outside the ${slice.rows.toString()}x${slice.columns.toString()} image.`,
            );
          }
          return slice.at(row, column);
        },
        readSlice,
        addMeasurement: (measurement) => {
          measurements?.add(measurement);
        },
        updateMeasurement: (measurement) => {
          measurements?.update(measurement);
        },
        removeMeasurement: (id) => {
          measurements?.remove(id);
        },
        selectMeasurement: (id) => {
          measurements?.select(id);
        },
        onMeasurementChange: (listener) =>
          measurements?.onChange(listener) ?? ((): void => undefined),
        drawSegmentation: (handle, display) => segmentations?.draw(handle, display) ?? false,
        hideSegmentation: (handle) => {
          segmentations?.hide(handle);
        },
        destroy(): void {
          if (stackDestroyed) return;
          stackDestroyed = true;
          stopContextMenu?.();
          // While the element is still enabled: Cornerstone looks the viewport up from it.
          stopPrefetch?.();
          segmentations?.destroy();
          measurements?.destroy();
          tools?.detach();
          renderingEngine.disableElement(enabledViewportId);
          releaseImages(stack.imageIds);
        },
      };
    } catch (error) {
      // A stack that failed to come up must not keep what it claimed.
      stopContextMenu?.();
      stopPrefetch?.();
      segmentations?.destroy();
      measurements?.destroy();
      tools?.detach();
      if (viewportId !== undefined) renderingEngine.disableElement(viewportId);
      releaseImages(stack.imageIds);
      throw error;
    }
  }

  async function drawThumbnail(
    stack: SeriesStack,
    imageIndex: number,
    size: number,
  ): Promise<string> {
    assertNotDestroyed();
    const instance = stack.instances[imageIndex];
    if (instance === undefined) {
      throw new RangeError(`No image at index ${imageIndex.toString()}.`);
    }
    // Claimed like a stack's images: the same slice may be on screen, and then it stays cached.
    claimImages([instance.imageId]);
    try {
      await registerInstance(instance);
      assertNotDestroyed();
      const canvas = document.createElement('canvas');
      canvas.height = size;
      await coreUtilities.loadImageToCanvas({
        canvas,
        imageId: instance.imageId,
        useCPURendering: true,
        imageAspect: true,
      });
      assertNotDestroyed();
      return fitOnSquare(canvas, size);
    } finally {
      releaseImages([instance.imageId]);
    }
  }

  return {
    renderThumbnail(stack, imageIndex, size): Promise<string> {
      const drawn = drawThumbnail(stack, imageIndex, size);
      pending.add(drawn);
      const done = (): void => {
        pending.delete(drawn);
      };
      drawn.then(done, done);
      return drawn;
    },
    renderStack(element, stack, renderOptions = {}): Promise<StackPort> {
      const render = setUpStack(element, stack, renderOptions);
      pending.add(render);
      const done = (): void => {
        pending.delete(render);
      };
      render.then(done, done);
      return render;
    },
    readSegmentationHeader,
    loadSegmentation: parseSegmentation,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      Promise.allSettled([...pending]).then(
        () => {
          unregisterFrameRequests?.();
          renderingEngine.destroy();
          releaseRuntime();
        },
        () => undefined,
      );
    },
  };
}
