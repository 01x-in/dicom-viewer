import {
  cache,
  Enums,
  getWebWorkerManager,
  imageLoadPoolManager,
  imageLoader,
  imageRetrievalPoolManager,
  init as initCornerstone,
  setUseCPURendering,
  utilities,
} from '@cornerstonejs/core';
import {
  loadImage as loadWadorsImage,
  register as registerWadorsLoader,
} from '@cornerstonejs/dicom-image-loader/wadors';
import { setOptions as setLoaderOptions } from 'dv-loader-options';
import { type AssetsConfig, prepareWorkers, type WorkerSetup } from './assets';
import { createFrameRequests, type FrameRequests } from './frame-policy';
import { LOCAL_FILE_SCHEME, loadLocalFileImage } from './local-files';
import { registerTools } from './tools';

const DECODE_WORKER_NAME = 'dicomImageLoader';
/** The name @cornerstonejs/tools looks up for segmentation statistics and contours. */
const COMPUTE_WORKER_NAME = 'compute';

export interface RuntimeOptions {
  readonly assets: AssetsConfig;
  /** Render without WebGL. Slower, but deterministic and works where no GPU is available. */
  readonly cpuRendering?: boolean;
}

/** Headers and 401 refresh for the frames each viewer's data source serves. */
export const frameRequests: FrameRequests = createFrameRequests();

/**
 * Cornerstone, the loader, and the worker pool are process-wide singletons. They are set up once
 * per page, and shared by every viewer on it.
 *
 * - What stays for the life of the page, because it is small and fixed: Cornerstone's registrations
 *   and event listeners, the tool classes, and the worker factories (with, in `inline` mode, two
 *   Blob URLs).
 * - What goes when the last viewer is destroyed: the decode and compute worker threads, the decoded
 *   image cache, and requests still queued.
 * - What can change while no viewer is running: the assets mode and the rendering backend.
 */
let initialized = false;
let configured: { readonly key: string; readonly workers: Promise<WorkerSetup> } | undefined;
let active = 0;

export function activeViewers(): number {
  return active;
}

function configureWorkers(options: RuntimeOptions): Promise<WorkerSetup> {
  return prepareWorkers(options.assets).then((workers) => {
    utilities.setWasmBasePath(workers.wasmBasePath);
    const workerManager = getWebWorkerManager();
    // `overwrite`: a later viewer may run with other assets once the first one is gone.
    workerManager.registerWorker(DECODE_WORKER_NAME, workers.createDecodeWorker, {
      maxWorkerInstances: Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)),
      overwrite: true,
    });
    // Same options as tools' own registerComputeWorker, which the engine build replaces.
    workerManager.registerWorker(COMPUTE_WORKER_NAME, workers.createComputeWorker, {
      maxWorkerInstances: 1,
      autoTerminateOnIdle: { enabled: true, idleTimeThreshold: 2000 },
      overwrite: true,
    });
    return workers;
  });
}

function initializeOnce(options: RuntimeOptions): void {
  if (initialized) {
    setUseCPURendering(options.cpuRendering === true);
    return;
  }
  initialized = true;
  initCornerstone({
    debug: {},
    // One viewer per page and at most four viewports in v1: one WebGL context is enough. The
    // default pool of seven costs seven contexts per viewer, and browsers allow about sixteen.
    rendering: {
      webGlContextCount: 1,
      ...(options.cpuRendering === true ? { useCPURendering: true } : {}),
    },
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
}

function stopWorkers(): void {
  const workerManager = getWebWorkerManager();
  for (const name of [DECODE_WORKER_NAME, COMPUTE_WORKER_NAME]) {
    if (name in workerManager.workerRegistry) workerManager.terminate(name);
  }
}

/** Counts the caller as a viewer, and has the runtime ready. Pair with `releaseRuntime`. */
export async function acquireRuntime(options: RuntimeOptions): Promise<void> {
  active += 1;
  try {
    const key = JSON.stringify([options.assets, options.cpuRendering === true]);
    if (configured !== undefined && configured.key !== key) {
      if (active > 1) {
        throw new Error(
          'A viewer is already running with different asset or rendering settings. Use one configuration per page.',
        );
      }
      // Nobody else is using the runtime: switch to the new settings.
      const previous = configured;
      configured = undefined;
      stopWorkers();
      (await previous.workers).dispose();
    }
    initializeOnce(options);
    configured ??= { key, workers: configureWorkers(options) };
    await configured.workers;
  } catch (error) {
    releaseRuntime();
    throw error;
  }
}

/** Gives back what is expensive once the last viewer is gone. */
export function releaseRuntime(): void {
  active -= 1;
  if (active > 0) return;
  if (configured !== undefined) stopWorkers();
  // Frames still queued would be decoded for a viewer that no longer exists.
  for (const type of Object.values(Enums.RequestType)) {
    imageLoadPoolManager.clearRequestStack(type);
    imageRetrievalPoolManager.clearRequestStack(type);
  }
  cache.purgeCache();
}
