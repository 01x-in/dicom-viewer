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
import { register as registerWadorsLoader } from '@cornerstonejs/dicom-image-loader/wadors';
import { utilities as metadataUtilities } from '@cornerstonejs/metadata';
import type { LoadedSeriesData } from '../data/types';
import { type AssetsConfig, prepareWorkers } from './assets';
import { parseSegmentation, type SegmentationHandle } from './segmentation';
import { attachStackTools, registerTools } from './tools';

const DECODE_WORKER_NAME = 'dicomImageLoader';
/** The name @cornerstonejs/tools looks up for segmentation statistics and contours. */
const COMPUTE_WORKER_NAME = 'compute';

export interface EngineOptions {
  readonly assets: AssetsConfig;
  /** Render without WebGL. Slower, but deterministic and works where no GPU is available. */
  readonly cpuRendering?: boolean;
}

export interface StackHandle {
  readonly imageCount: number;
  getImageIndex(): number;
  setImageIndex(index: number): Promise<void>;
  /** Decodes one slice and returns the Hounsfield value of one pixel. */
  sampleHu(imageIndex: number, row: number, column: number): Promise<number>;
  destroy(): void;
}

export type { SegmentationHandle };

export interface Engine {
  renderStack(element: HTMLElement, series: LoadedSeriesData): Promise<StackHandle>;
  loadSegmentation(series: LoadedSeriesData, bytes: ArrayBuffer): Promise<SegmentationHandle>;
  destroy(): void;
}

let engineCount = 0;

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

export async function createEngine(options: EngineOptions): Promise<Engine> {
  await ensureRuntime(options);

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

  async function setUpStack(element: HTMLElement, series: LoadedSeriesData): Promise<StackHandle> {
    assertNotDestroyed();
    await Promise.all(
      series.instances.map((instance) =>
        metadataUtilities.addDicomWebInstance(instance.imageId, instance.metadata),
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
    const middle = Math.floor(series.imageIds.length / 2);
    await viewport.setStack([...series.imageIds], middle);
    if (destroyed) {
      renderingEngine.disableElement(viewportId);
      throw new Error('The engine was destroyed while the viewport was being set up.');
    }
    viewport.render();
    const detachTools = attachStackTools(renderingEngineId, viewportId);

    return {
      imageCount: series.imageIds.length,
      getImageIndex: () => viewport.getCurrentImageIdIndex(),
      async setImageIndex(index): Promise<void> {
        await viewport.setImageIdIndex(index);
      },
      async sampleHu(imageIndex, row, column): Promise<number> {
        const imageId = series.imageIds[imageIndex];
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
    renderStack(element, series): Promise<StackHandle> {
      const render = setUpStack(element, series);
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
          renderingEngine.destroy();
        },
        () => undefined,
      );
    },
  };
}
