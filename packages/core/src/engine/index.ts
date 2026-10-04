// The only module family that may import Cornerstone (see eslint.config.js and docs/plan.md).
import {
  Enums,
  getWebWorkerManager,
  imageLoader,
  init as initCornerstone,
  RenderingEngine,
  StackViewport,
  utilities,
} from '@cornerstonejs/core';
import {
  loadImage as loadWadorsImage,
  register as registerWadorsLoader,
} from '@cornerstonejs/dicom-image-loader/wadors';
import { utilities as metadataUtilities } from '@cornerstonejs/metadata';
import { setOptions as setLoaderOptions } from 'dv-loader-options';
import type { FrameRequestPolicy, SeriesStack } from '../data/types';
import type { RenderingPort, RenderStackOptions, StackPort } from '../rendering-port';
import { type AssetsConfig, prepareWorkers } from './assets';
import { createFrameRequests } from './frame-policy';
import {
  isLocalFileImageId,
  LOCAL_FILE_SCHEME,
  loadLocalFileImage,
  registerLocalFile,
} from './local-files';
import { parseSegmentation } from './segmentation';
import { attachStackTools, registerTools } from './tools';

const DECODE_WORKER_NAME = 'dicomImageLoader';
/** The name @cornerstonejs/tools looks up for segmentation statistics and contours. */
const COMPUTE_WORKER_NAME = 'compute';

export interface EngineOptions {
  readonly assets: AssetsConfig;
  /** Render without WebGL. Slower, but deterministic and works where no GPU is available. */
  readonly cpuRendering?: boolean;
  /** Applies the host's headers and token refresh to the frames the loader fetches. */
  readonly frameRequests?: FrameRequestPolicy | undefined;
}

let engineCount = 0;

const frameRequests = createFrameRequests();

/**
 * Cornerstone, the loader, and the worker pool are process-wide singletons, so they are set up once
 * per page. M1 spike: the first viewer's asset settings win and the worker is never released.
 * M2 owns the real lifecycle ("20 mount/unmount cycles leak nothing").
 */
let runtime: { readonly key: string; readonly ready: Promise<void> } | undefined;

function ensureRuntime(options: EngineOptions): Promise<void> {
  const key = JSON.stringify([options.assets, options.cpuRendering === true]);
  if (runtime !== undefined) {
    if (runtime.key !== key) {
      throw new Error(
        'A viewer is already running with different asset or rendering settings. Use one configuration per page.',
      );
    }
    return runtime.ready;
  }
  const ready = (async (): Promise<void> => {
    const workers = await prepareWorkers(options.assets);
    initCornerstone({
      debug: {},
      ...(options.cpuRendering === true ? { rendering: { useCPURendering: true } } : {}),
    });
    registerWadorsLoader({});
    setLoaderOptions({
      beforeSend: (_xhr, imageId, defaultHeaders) =>
        frameRequests.headersFor(imageId, defaultHeaders),
    });
    // After registerWadorsLoader, which registers the plain loader: this one retries a frame once
    // after a 401 refresh.
    imageLoader.registerImageLoader('wadors', frameRequests.wrap(loadWadorsImage));
    imageLoader.registerImageLoader(LOCAL_FILE_SCHEME, loadLocalFileImage);
    registerTools();
    utilities.setWasmBasePath(workers.wasmBasePath);
    const workerManager = getWebWorkerManager();
    workerManager.registerWorker(DECODE_WORKER_NAME, workers.createDecodeWorker, {
      maxWorkerInstances: Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)),
    });
    // Same options as tools' own registerComputeWorker, which the engine build replaces.
    workerManager.registerWorker(COMPUTE_WORKER_NAME, workers.createComputeWorker, {
      maxWorkerInstances: 1,
      autoTerminateOnIdle: { enabled: true, idleTimeThreshold: 2000 },
    });
  })();
  runtime = { key, ready };
  return ready;
}

export async function createEngine(options: EngineOptions): Promise<RenderingPort> {
  await ensureRuntime(options);

  const unregisterFrameRequests =
    options.frameRequests === undefined ? undefined : frameRequests.register(options.frameRequests);
  engineCount += 1;
  const renderingEngineId = `dv-engine-${engineCount.toString()}`;
  const renderingEngine = new RenderingEngine(renderingEngineId);
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
    await Promise.all(
      stack.instances.map((instance) =>
        isLocalFileImageId(instance.imageId)
          ? registerLocalFile(instance.imageId)
          : metadataUtilities.addDicomWebInstance(instance.imageId, instance.metadata),
      ),
    );

    assertNotDestroyed();
    viewportCount += 1;
    const viewportId = `${renderingEngineId}-vp-${viewportCount.toString()}`;
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
    if (destroyed) {
      renderingEngine.disableElement(viewportId);
      throw new Error('The engine was destroyed while the viewport was being set up.');
    }
    viewport.render();
    const detachTools = attachStackTools(renderingEngineId, viewportId);

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
        detachTools();
        renderingEngine.disableElement(viewportId);
      },
    };
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
      destroyed = true;
      Promise.allSettled([...pending]).then(
        () => {
          unregisterFrameRequests?.();
          renderingEngine.destroy();
        },
        () => undefined,
      );
    },
  };
}
