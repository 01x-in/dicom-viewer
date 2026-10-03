import { INLINE_WASM_BASE } from './inline-base';

/**
 * Where the decode worker and codec WASM come from.
 * - `inline` (default): embedded in the package, run from a Blob URL. Needs `worker-src blob:` and
 *   `'wasm-unsafe-eval'` in the CSP.
 * - `url`: files copied with `npx viewer-assets copy <dir>` and served from `baseUrl`.
 */
export type AssetsConfig = { mode: 'inline' } | { mode: 'url'; baseUrl: string };

export interface WorkerSetup {
  readonly createDecodeWorker: () => Worker;
  readonly createComputeWorker: () => Worker;
  readonly wasmBasePath: string;
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export async function prepareWorkers(assets: AssetsConfig): Promise<WorkerSetup> {
  if (assets.mode === 'inline') {
    // A dynamic import keeps the worker sources (~1.5 MB with the WASM) out of url-mode hosts.
    const { inlineDecodeWorkerSource, inlineComputeWorkerSource } = await import(
      '../generated/inline-assets'
    );
    const blobUrl = (source: string): string =>
      URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const decodeUrl = blobUrl(inlineDecodeWorkerSource);
    const computeUrl = blobUrl(inlineComputeWorkerSource);
    return {
      createDecodeWorker: () => new Worker(decodeUrl, { type: 'module' }),
      createComputeWorker: () => new Worker(computeUrl, { type: 'module', name: 'compute' }),
      wasmBasePath: INLINE_WASM_BASE,
    };
  }
  const base = new URL(withTrailingSlash(assets.baseUrl), document.baseURI);
  const decodeUrl = new URL('decode.worker.js', base);
  const computeUrl = new URL('compute.worker.js', base);
  return {
    createDecodeWorker: () => new Worker(decodeUrl, { type: 'module' }),
    createComputeWorker: () => new Worker(computeUrl, { type: 'module', name: 'compute' }),
    wasmBasePath: new URL('wasm/', base).href,
  };
}
