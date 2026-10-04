# ADR 0001: Workers and WASM ship prebuilt, in two modes

Status: accepted (M1). Evidence: [m1-bundle-sizes.md](../m1-bundle-sizes.md) and the installability matrix (`pnpm matrix`).

## Context

`@cornerstonejs/dicom-image-loader` starts its decode worker with `new Worker(new URL('./decodeImageFrameWorker.js', import.meta.url))`, and each codec finds its `.wasm` through a bare-specifier `new URL(...)`. Vite pre-bundling, Next.js, and Nuxt each handle those expressions differently, so a host that simply imports the loader needs bundler configuration. `@cornerstonejs/tools` has the same pattern for its compute worker. The goal is zero host configuration.

## Decision

1. Core imports `dicom-image-loader/wadors` only. It never imports the package root or calls `init()`, because both pull in the `new URL` worker registration.
2. `scripts/build-workers.ts` bundles two workers with rolldown at build time: `decode` (the loader's own worker, JPEG XL stubbed out) and `compute` (tools' worker). Both are self-contained ES modules.
3. The engine registers both workers itself (`registerWorker`) before the first image load, and replaces tools' `registerComputeWorker` at build time so no `new URL(..., import.meta.url)` is left in what hosts bundle (see ADR 0003).
4. `AssetsConfig` has two modes:
   - **`inline` (default).** The worker sources, with the codec WASM embedded as base64, are strings inside a lazily imported chunk. The engine starts them from Blob URLs. Needs `worker-src blob:` and `'wasm-unsafe-eval'` in the CSP.
   - **`url`.** `npx viewer-assets copy <dir>` copies `decode.worker.js`, `compute.worker.js`, and `wasm/*.wasm`; the host serves them and passes `baseUrl`. For strict-CSP hosts and long-lived caching.

## How inline mode works (the parts that were not obvious)

- Cornerstone builds every WASM URL from `wasmBasePath`. A Blob worker has no useful base URL, so the engine sets `wasmBasePath` to `https://dicom-viewer.invalid/wasm/` and the worker bundle overrides `self.fetch` for that origin to answer from the embedded bytes (`workers/wasm-shim.ts`). The `.invalid` TLD never resolves, so a broken shim fails loudly.
- Codec modules evaluate `new URL('<bare specifier>', import.meta.url)` at load. In a `blob:` worker, `import.meta.url` is a blob URL, which cannot be a base, so the worker throws before it starts. The inline build therefore replaces `import.meta.url` with a fixed `https://dicom-viewer.invalid/...` value.
- The package declares `sideEffects: false`; the shim exists only for its side effect, so the build marks it explicitly.

## Alternatives rejected

- **Let the host bundle the upstream workers.** Fails or needs per-bundler config, which is the problem being solved.
- **Embed WASM in the main entry.** Adds about 1.1 MB (base64) to every page, even in `url` mode.
- **Bundler plugins (Vite plugin, `withDicomViewer`, Nuxt module).** Kept as a fallback in docs/plan.md; not needed, since the matrix passes without them.

## Consequences

- The inline chunk (`inline-assets-*.js`, about 4.2 MB raw) is part of every host build, even for hosts that choose `url` mode. It is never fetched in that mode, so this costs deploy size, not page weight. A separate subpath for it would remove that; not done in M1.
- The compute worker is 2.8 MB raw, because it bundles vtk.js filters. That is large for what it does; trimming it is an M6 task.
- JPEG XL decoding is not supported (a stub rejects with a clear error). It is outside the v1 scope.
- Only Chromium has run the matrix so far. Safari and Firefox are untested.
