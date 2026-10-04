/**
 * In `inline` asset mode the decode worker runs from a blob: URL with its WASM embedded.
 * Cornerstone builds every WASM URL from `wasmBasePath`, so the engine points it here and the
 * worker's fetch shim (workers/wasm-shim.ts) answers requests under it from memory.
 * The `.invalid` TLD never resolves, so a missing shim fails loudly instead of hitting a real host.
 */
export const INLINE_WASM_BASE = 'https://dicom-viewer.invalid/wasm/';
