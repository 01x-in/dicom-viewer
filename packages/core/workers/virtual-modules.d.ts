// Provided by the rolldown plugin in scripts/build-workers.ts.
declare module 'dv-inline-wasm' {
  /** WASM file name to base64 contents. Empty in the `url` build. */
  export const wasmFiles: Record<string, string>;
}
declare module 'dv-upstream-decode-worker';
declare module 'dv-upstream-compute-worker';
// The real comlink, which workers/comlink-expose.ts wraps. Only `expose` is used by name.
declare module 'dv-real-comlink' {
  export function expose(api: unknown, endpoint?: unknown, allowedOrigins?: unknown): void;
}
