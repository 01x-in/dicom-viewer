import type { DataSource } from './data/types';
import { assertBrowserEnvironment } from './environment';
import type { AssetsConfig } from './engine/assets';
import type { Engine, StackHandle } from './engine/index';

/**
 * M1 spike surface: just enough to prove packaging. The real API (docs/plan.md, "Public API")
 * replaces this in M2, so nothing here is stable.
 */
export interface ViewerOptions {
  readonly dataSource: DataSource;
  readonly assets?: AssetsConfig;
  readonly cpuRendering?: boolean;
}

export interface Viewer {
  /** Resolves once the engine and decode worker are ready. Rejects if they cannot start. */
  readonly ready: Promise<void>;
  loadSeries(
    element: HTMLElement,
    studyInstanceUID: string,
    seriesInstanceUID: string,
  ): Promise<LoadedSeries>;
  destroy(): void;
}

export interface LoadedSeries {
  readonly imageCount: number;
  getImageIndex(): number;
  setImageIndex(index: number): Promise<void>;
  sampleHu(imageIndex: number, row: number, column: number): Promise<number>;
}

/** Browser only. Import this from a client component or an effect, never during SSR. */
export function createViewer(options: ViewerOptions): Viewer {
  assertBrowserEnvironment('createViewer');
  const assets: AssetsConfig = options.assets ?? { mode: 'inline' };

  // Cornerstone is imported lazily so that importing this package on a server stays side-effect free.
  const enginePromise: Promise<Engine> = import('./engine/index').then(({ createEngine }) =>
    createEngine({
      assets,
      ...(options.cpuRendering === undefined ? {} : { cpuRendering: options.cpuRendering }),
    }),
  );
  const handles: StackHandle[] = [];
  let destroyed = false;

  function assertAlive(): void {
    // React StrictMode and fast route changes destroy a viewer while it is still loading.
    // Stopping here keeps a dead viewer from claiming an element a newer viewer needs.
    if (destroyed) throw new Error('The viewer was destroyed before the series finished loading.');
  }

  return {
    ready: enginePromise.then(() => undefined),
    async loadSeries(element, studyInstanceUID, seriesInstanceUID): Promise<LoadedSeries> {
      const engine = await enginePromise;
      assertAlive();
      const series = await options.dataSource.getSeries(studyInstanceUID, seriesInstanceUID);
      assertAlive();
      const handle = await engine.renderStack(element, series);
      handles.push(handle);
      return handle;
    },
    destroy(): void {
      destroyed = true;
      for (const handle of handles) handle.destroy();
      void enginePromise.then((engine) => {
        engine.destroy();
      });
    },
  };
}
