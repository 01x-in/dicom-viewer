# M1 report: packaging spike

**Verdict: go.** `pnpm pack` tarballs render the J2K phantom stack from `dicomweb-mock` in proxy mode with no bundler configuration, in all six examples and both asset modes, in production builds and under each dev server. Numbers in [m1-bundle-sizes.md](m1-bundle-sizes.md); decisions in [ADR 0001](adr/0001-asset-strategy.md), [0002](adr/0002-dom-strategy.md), and [0003](adr/0003-prebundled-engine.md).

## What was checked

`pnpm matrix` packs the four packages, copies each example into `.matrix/`, installs it from the tarballs, builds it, serves it, and drives headless Chromium (SwiftShader WebGL) against `dicomweb-mock --mode oncotrace-proxy`. `pnpm matrix --dev` does the same against each framework's dev server.

| Example | Bundler | Production | Dev server |
|---|---|---|---|
| vanilla (`<dv-viewer>`, Lit) | Vite 8 | pass | pass |
| vite-react (StrictMode) | Vite 8 | pass | pass |
| vite-vue | Vite 8 | pass | pass |
| next-app | Next 16, Turbopack | pass | pass |
| next-app | Next 16, webpack | pass | pass |
| nuxt | Nuxt 4 (Vite) | pass | pass |

Each cell covers `inline` and `url` asset mode. Every run asserts:
- the decode worker started from `blob:` (inline) or `/viewer-assets/decode.worker.js` (url);
- 64 images, and exact Hounsfield values from the **J2K** series at seven probe points (outside the body, body, left marker, and the air, water, fat, and bone inserts), so the WASM decoder ran in the worker and is lossless;
- the SEG loads through `createFromDICOMSegBuffer` after a whole-instance retrieval, with segments `1:Body` and `2:Bone insert`, 64 labelmap frames, and the right segment number at four pixels;
- scrolling by API and by real mouse wheel moves the stack (tools are registered and a tool group is attached);
- the canvas is not blank;
- no console error, uncaught error, failed request, or HTTP status of 400 or above, including from the mock, which would answer 403 for any whole-study, whole-series, or CT instance retrieval and 400 for more than 16 frames;
- for Next and Nuxt in production, the server's stderr stays clean. Next pages render on every request (`force-dynamic`), so the client module code also runs on the server.

Also checked: unit tests for the DICOMweb source (slice sort along the normal, 403 not retried, multipart parsing, whole-instance retrieval), the mock server in both modes, the `viewer-assets` copy command, and `<dv-viewer>` rendering into the light DOM; Python tests for the phantom, including a byte-for-byte reproducible SEG.

## v5 adapters SEG API

Confirmed against real data. In 5.11.4:
- `adaptersSEG.Cornerstone3D.Segmentation` exposes `createFromDICOMSegBuffer`, `createFromDicomSegImageId` (per-frame retrieval, for servers that serve SEG as frames), `createLabelmapsFromDICOMBuffer`, `createLabelmapsFromSegImageIds`, `generateToolState`, `generateSegmentation`, and `generateLabelMaps2DFrom3D`.
- `createFromDICOMSegBuffer(referencedImageIds, arrayBuffer, { metadataProvider, tolerance })` resolves to `{ labelMapImages, segMetadata, segmentsOnFrame, centroids, overlappingSegments }`. `labelMapImages` is an array of layers, each an array with one derived labelmap image per referenced image; `centroids` is a map by segment, which M6's `jumpToSegment` can use.
- Everything is typed `any`, so `engine/segmentation.ts` validates the result with Zod before using it.
- Oblique SEGs throw ("not yet supported"). That matches the plan's geometry-warning phantom, which M6 should add.
- The whole-SEG path is the one the OncoTrace proxy allows (SEG and SR whole-instance retrieval only).

## Problems found, and what fixed them

| Problem | Where | Fix |
|---|---|---|
| `Class extends value undefined` | vtk.js → xmlbuilder2 imports Node `events`; Vite stubs built-ins | prebundle the engine with an `events` polyfill (ADR 0003) |
| `Cannot resolve entry module .../computeWorker.js` | tools registers a worker with `new URL(..., import.meta.url)` | prebuilt compute worker, tools' registration replaced (ADR 0001, 0003) |
| unresolved `@babel/runtime/helpers/*` | adapters imports it without declaring it | alias to a pinned copy in the engine build |
| Blob worker dies at load | `new URL(bare, import.meta.url)` with a `blob:` base | fixed fake `import.meta.url` in the inline build |
| WASM URL cannot be built in a Blob worker | Cornerstone derives it from `wasmBasePath` | fake `.invalid` base plus a worker-side `fetch` shim |
| Shim silently missing from the worker | `sideEffects: false` in core's package.json | mark the shim as having side effects in the build |
| HU off by exactly 1024 in the test helper | pre-scaled pixels plus a second rescale | `sampleHu` honors `image.preScale.scaled` |

## Not done, or not proven

- **Browsers:** Chromium only (headless shell 151 locally). Safari, Firefox, and iPad are untested.
- **WebGL:** SwiftShader only. The deterministic CPU-rendering job from docs/plan.md is not set up; `cpuRendering: true` exists but the matrix does not use it.
- **Lifecycle:** the Cornerstone runtime and workers are once-per-page singletons that are never released, and the first viewer's asset settings win. M2 owns "20 mount/unmount cycles leak nothing".
- **Shadow DOM:** the claim that it breaks Cornerstone is the plan's, not reproduced (ADR 0002).
- **Weekly run against latest versions:** the matrix runs per PR in CI, but examples use pinned versions, so there is no weekly latest-versions job yet.
- **Size follow-ups:** the inline chunk is in every host build even in `url` mode, and the compute worker is 2.8 MB. Neither blocks M2.
- **API surface:** `createViewer`, `LoadedSeries`, `<DicomViewer>`, and `<dv-viewer>` are spike shapes, explicitly unstable until M2 and M4.
