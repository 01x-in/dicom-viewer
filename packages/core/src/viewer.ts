import type { AssetsConfig } from './engine/assets';
import { assertBrowserEnvironment } from './environment';
import type { RenderingPort } from './rendering-port';
import { createViewerCore, type Viewer, type ViewerCoreOptions } from './viewer-core';

export interface ViewerOptions extends ViewerCoreOptions {
  /** Where the decode worker and codec WASM come from. Default: embedded in the package (`inline`). */
  readonly assets?: AssetsConfig;
  /** Render without WebGL. Slower, but deterministic and works where no GPU is available. */
  readonly cpuRendering?: boolean;
}

/** Browser only. Import this from a client component or an effect, never during SSR. */
export function createViewer(options: ViewerOptions): Viewer {
  assertBrowserEnvironment('createViewer');
  const assets: AssetsConfig = options.assets ?? { mode: 'inline' };
  const { dataSource } = options;

  // Cornerstone is imported lazily so that importing this package on a server stays side-effect free.
  const loadEngine = (): Promise<RenderingPort> =>
    import('./engine/index').then(({ createEngine }) =>
      createEngine({
        assets,
        frameRequests: dataSource.frameRequests,
        ...(options.cpuRendering === undefined ? {} : { cpuRendering: options.cpuRendering }),
      }),
    );
  return createViewerCore(
    {
      dataSource,
      ...(options.initialState === undefined ? {} : { initialState: options.initialState }),
    },
    loadEngine,
  );
}
