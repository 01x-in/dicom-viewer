import { INLINE_WASM_BASE } from './inline-base';

/**
 * Where the decode worker and codec WASM come from.
 * - `inline` (default): embedded in the package, run from a Blob URL. Needs `worker-src blob:` and
 *   `'wasm-unsafe-eval'` in the CSP.
 * - `url`: files copied with `npx viewer-assets copy <dir>` and served from `baseUrl`.
 */
export type AssetsConfig = { mode: 'inline' } | { mode: 'url'; baseUrl: string };

export interface DecodeWorkerSetup {
  readonly createWorker: () => Worker;
  readonly wasmBasePath: string;
  /** Releases the Blob URL, if any. */
  readonly dispose: () => void;
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export async function prepareDecodeWorker(assets: AssetsConfig): Promise<DecodeWorkerSetup> {
  if (assets.mode === 'inline') {
    // A dynamic import keeps the ~1.3 MB worker source out of the main chunk of url-mode hosts.
    const { inlineDecodeWorkerSource } = await import('../generated/inline-assets');
    const blobUrl = URL.createObjectURL(
      new Blob([inlineDecodeWorkerSource], { type: 'text/javascript' }),
    );
    return {
      createWorker: () => new Worker(blobUrl, { type: 'module' }),
      wasmBasePath: INLINE_WASM_BASE,
      dispose: () => {
        URL.revokeObjectURL(blobUrl);
      },
    };
  }
  const base = new URL(withTrailingSlash(assets.baseUrl), document.baseURI);
  const workerUrl = new URL('decode.worker.js', base);
  return {
    createWorker: () => new Worker(workerUrl, { type: 'module' }),
    wasmBasePath: new URL('wasm/', base).href,
    dispose: () => undefined,
  };
}
