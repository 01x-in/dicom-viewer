// Entry of the prebuilt decode worker. `scripts/build-workers.ts` bundles it twice:
// `inline` (WASM embedded, fetch shim active) and `url` (WASM fetched from `wasmBasePath`).
import './wasm-shim.ts';
// Resolved by the build script to dicom-image-loader's own worker, which `expose()`s the decoders.
import 'dv-upstream-decode-worker';
