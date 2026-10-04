// The only module family that may import Cornerstone (see eslint.config.js and docs/plan.md).
import {
  cache,
  Enums,
  getRenderingEngines,
  getWebWorkerManager,
  imageLoader,
  RenderingEngine,
  StackViewport,
} from '@cornerstonejs/core';
import {
  Enums as MetadataEnums,
  metaData,
  utilities as metadataUtilities,
} from '@cornerstonejs/metadata';
import type { FrameRequestPolicy, SeriesStack } from '../data/types';
import { provideEngineDiagnostics } from '../diagnostics';
import type { RenderingPort, RenderStackOptions, StackPort } from '../rendering-port';
import { isLocalFileImageId, registerLocalFile } from './local-files';
import { acquireRuntime, activeViewers, frameRequests, releaseRuntime } from './runtime';
import type { RuntimeOptions } from './runtime';
import { parseSegmentation } from './segmentation';
import { attachStackTools } from './tools';

export interface EngineOptions extends RuntimeOptions {
  /** Applies the host's headers and token refresh to the frames the loader fetches. */
  readonly frameRequests?: FrameRequestPolicy | undefined;
}

let engineCount = 0;

/**
 * How many live stacks use each image id. Stacks of different viewers may show the same series,
 * so an image is dropped from the cache, and its metadata forgotten, only with the last of them.
 */
const imageUsers = new Map<string, number>();

function claimImages(imageIds: readonly string[]): void {
  for (const imageId of imageIds) imageUsers.set(imageId, (imageUsers.get(imageId) ?? 0) + 1);
}

function releaseImages(imageIds: readonly string[]): void {
  for (const imageId of imageIds) {
    const users = (imageUsers.get(imageId) ?? 1) - 1;
    if (users > 0) {
      imageUsers.set(imageId, users);
      continue;
    }
    imageUsers.delete(imageId);
    // Only slices that were actually loaded are in the cache; removing any other throws.
    if (cache.getImageLoadObject(imageId) !== undefined) cache.removeImageLoadObject(imageId);
    metaData.clearQuery(MetadataEnums.MetadataModules.NATURALIZED, imageId);
  }
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
    let detachTools: (() => void) | undefined;
    try {
      await Promise.all(
        stack.instances.map((instance) =>
          isLocalFileImageId(instance.imageId)
            ? registerLocalFile(instance.imageId)
            : metadataUtilities.addDicomWebInstance(instance.imageId, instance.metadata),
        ),
      );

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
      detachTools = attachStackTools(renderingEngineId, viewportId);

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
        async sampleHu(imageIndex, row, column): Promise<number> {
          const imageId = stack.imageIds[imageIndex];
          if (imageId === undefined)
            throw new RangeError(`No image at index ${imageIndex.toString()}.`);
          const image = await imageLoader.loadAndCacheImage(imageId);
          // Check each axis, not the flattened offset: column -1 or `columns` would otherwise land on a
          // neighbouring row and return a wrong pixel instead of failing.
          if (
            !Number.isInteger(row) ||
            !Number.isInteger(column) ||
            row < 0 ||
            row >= image.rows ||
            column < 0 ||
            column >= image.columns
          ) {
            throw new RangeError(
              `Pixel (${row.toString()}, ${column.toString()}) is outside the ${image.rows.toString()}x${image.columns.toString()} image.`,
            );
          }
          const stored = image.voxelManager?.getScalarData()[row * image.columns + column];
          if (stored === undefined) throw new Error('The image has no scalar data.');
          // With pre-scaling on (the default) the loader has already applied slope and intercept.
          return image.preScale?.scaled === true ? stored : stored * image.slope + image.intercept;
        },
        destroy(): void {
          if (stackDestroyed) return;
          stackDestroyed = true;
          detachTools?.();
          renderingEngine.disableElement(enabledViewportId);
          releaseImages(stack.imageIds);
        },
      };
    } catch (error) {
      // A stack that failed to come up must not keep what it claimed.
      detachTools?.();
      if (viewportId !== undefined) renderingEngine.disableElement(viewportId);
      releaseImages(stack.imageIds);
      throw error;
    }
  }

  return {
    renderStack(element, stack, renderOptions = {}): Promise<StackPort> {
      const render = setUpStack(element, stack, renderOptions);
      pending.add(render);
      const done = (): void => {
        pending.delete(render);
      };
      render.then(done, done);
      return render;
    },
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
