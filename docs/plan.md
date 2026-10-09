# Plan: standalone DICOM viewer library (Cornerstone3D, OHIF-level tools)

## Context

OncoTrace runs OHIF v3.10.2 as a separate app in an iframe, with a postMessage bridge (`apps/viewer/extensions/oncotrace-bridge`). The user wants a viewer that installs as an npm package into React (Vite), Next.js, and Vue/Nuxt, with OHIF-level tools rather than the bare Cornerstone3D viewport.

Fixed decisions:
- **New separate repo** from day one. OncoTrace keeps OHIF for now, so this plan makes no OncoTrace changes.
- **v1 scope** is all four tool groups: navigation, measurements, SEG overlays with a segment panel, and MPR with layouts.
- **UI** ships as a styled OHIF-like default plus a headless core.

Findings that shape the design:
- **Cornerstone3D is on v5** (5.11.4 as of 2026-10-02).
  - A breaking major has shipped every 4–10 months.
  - Sibling packages exact-pin each other.
- **Workers and WASM codecs are the main packaging problem.**
  - `dicom-image-loader` starts its workers with `new URL(..., import.meta.url)` and finds codec WASM by bare package specifiers. Vite pre-bundling and Next break this.
  - Escape hatches exist: `getWebWorkerManager().registerWorker(..., {overwrite:true})`, `wasmBasePath`, and the codec-free `/wadors` entry.
- **The OncoTrace proxy is the first real data source to support.** Constraints:
  - QIDO needs a StudyInstanceUID filter.
  - CT is served as WADO-RS frames only, with at most 16 per request.
  - A whole SEG instance can be retrieved.
  - Whole-study and whole-series retrieval returns 403.
  - CT uses JPEG 2000 lossless or EVRLE (no HTJ2K yet).
- **OncoTrace SEG files are binary highdicom.** Each study has two series (organs and tumors). Tumor segments are per tumor type, not per lesion.

## Architecture

**Recommended stack:** a headless TS core, a styled UI built as Lit web components, and thin React and Vue adapters.
- One UI codebase serves React 19, Vue 3, Next, Nuxt, and vanilla.
- Viewports stay in light DOM. Only the UI chrome uses shadow DOM, to avoid Cornerstone input and resize issues (verified in M1).

```
dicom-viewer/ (MIT, pnpm workspaces, changesets fixed versioning)
  packages/core      @scope/viewer-core      engine/ (only Cornerstone importer, RenderingPort), data/, services/, state/, workers/, bin/viewer-assets
  packages/elements  @scope/viewer-elements  Lit: <dv-viewer>, toolbar, viewport grid, series/segments/measurements panels, styles.css, /define
  packages/react     @scope/viewer-react     'use client' <DicomViewer>, <ViewerViewport>, useViewer, useViewerState
  packages/vue       @scope/viewer-vue       <DicomViewer>, provideViewer/useViewer (shallowRef + markRaw), plugin
  tools/phantom      Python: deterministic synthetic CT/MR/SEG (no licensed data)
  tools/dicomweb-mock  Node server; "oncotrace-proxy" mode reproduces the 403 and 16-frame rules
  examples/          vite-react, next-app (Turbopack + webpack), vite-vue, nuxt, vanilla, oncotrace-like
  docs/              VitePress + TypeDoc + ADRs
```

Boundaries:
- Only `core/src/engine/*` imports `@cornerstonejs/*`. Services depend on a `RenderingPort` interface, so the public API never exposes Cornerstone types.
- `viewer.unsafe.cornerstone` is the escape hatch, explicitly outside semver.
- Hosts customize the styled shell through slots:
  - `banner` (for OncoTrace's disclaimer)
  - `toolbar-start` and `toolbar-end`
  - `panel-left` and `panel-right`
  - `viewport-overlay`
  - `empty-state`
- Panels are pluggable via `viewer.ui.registerPanel(...)`, React `panels={{...}}`, and Vue named slots.

## Public API (headless core, key signatures)

```ts
createViewer(options: ViewerOptions): Viewer            // browser-only
ViewerOptions = { dataSource, assets?: {mode:'inline'} | {mode:'url', baseUrl}, initialState?, hangingProtocols?,
                  tools?, windowLevelPresets?, overlay?, memory?: {maxCacheBytes?} }
Viewer = { ready, loadStudy(uid), setLayout('1x1'|'1x2'|'2x2'|'1+3'), setViewportSeries(id, seriesUid, {orientation?}),
           navigateTo(NavigateTarget): Promise<NavigateResult>, getState(): ViewerStateV1, setState(patch),
           subscribe(selector, listener), on(event, handler), viewports, tools, measurements, segmentations, ui, destroy() }
NavigateTarget = { seriesInstanceUID, sopInstanceUID, frameNumber?, viewportId?,
                   segmentations?: { seriesInstanceUID, visible, highlightSegments? }[] }
SegmentationsApi: load, list, setVisible, setSegmentVisible/Color/Opacity, setOpacity, highlight, jumpToSegment({strategy:'largestSlice'|'centroid'|'nearestTo'})
MeasurementsApi: list, add, update, remove, clear, select, exportJson, importJson (Zod), exportSr? (stretch)
createDicomWebDataSource({ wadoRoot, qidoRoot?, getRequestHeaders?(req) /* sync, per request */, onUnauthorized?(req) /* refresh then retry once */,
                           retry?, capabilities?: { studySearch?, instanceRetrieve?: 'all'|'seg-sr-only'|'none', maxFramesPerRequest? } })
createLocalFileDataSource(files)                         // subpath '/local'
Events: study:loaded, viewport:image, viewport:voi, tool:active, measurement:*, segmentation:loaded|visibility|warning, state:changed{origin}, error
ViewerStateV1 (Zod, serializable) + encodeViewerState/decodeViewerState for URL persistence
```

React adds `DicomViewer` props:
- `options`, `studyInstanceUID`
- `navigate` (declarative)
- `initialState`, or `state` + `onStateChange` (controlled for layout, segmentation, and measurements only)
- `toolbar`, `panels`, `banner`, `theme`, `viewerRef`

Vue mirrors these with emits and slots.

## Packaging strategy (goal: zero bundler config)

1. **Keep codecs out of the main thread.** Core imports only `dicom-image-loader/wadors` and never the root index or `init()`. Cornerstone itself is prebundled into one lazily loaded engine chunk, so hosts bundle neither it nor vtk.js.
2. **Prebuild the workers.** At library build time, rolldown bundles `decode.worker.js` and `compute.worker.js` as self-contained ESM files (both exist since M1: tools' own compute worker cannot be bundled by hosts, see [ADR 0001](adr/0001-asset-strategy.md)).
   - Bare WASM `new URL` references are rewritten to a configurable `locateFile`.
   - Codecs: J2K (required), JPEG baseline and lossless, JPEG-LS, RLE, HTJ2K, and the uncompressed syntaxes.
3. **Register the workers.** Use `registerWorker(..., {overwrite:true})` before the first image load.
4. **Two asset modes.**
   - `inline` (default): Blob-URL workers with base64 WASM. No host config; the CSP needs `worker-src blob:` and `'wasm-unsafe-eval'`.
   - `url`: assets copied with `npx viewer-assets copy public/viewer-assets`. For strict-CSP hosts and for caching.
5. **SSR safety.**
   - React components start with `'use client'` and import core dynamically in `useEffect`, so Next hosts don't need `ssr:false`.
   - Vue imports core in `onMounted`. Nuxt hosts use `<ClientOnly>`.
6. **No COOP/COEP needed.** The spike confirms Cornerstone v5 doesn't need SharedArrayBuffer.
7. **Fallbacks, in order:**
   - (a) Vendor the prebuilt codec JS and WASM behind a thin worker.
   - (b) Ship bundler helpers: a Vite plugin, `withDicomViewer(nextConfig)`, and a Nuxt module.
   - (c) Document manual config.
8. **Version pinning.** Cornerstone packages are exact-pinned **devDependencies** of core and are bundled into its engine chunk, never peers (changed in M1, see [ADR 0003](adr/0003-prebundled-engine.md)). Renovate groups the bumps, gated on the browser suite.

## Subsystem notes

- **Data**
  - In-house fetch client: QIDO is used only at series level, plus series metadata, `wadors:` frame image IDs, and whole-instance retrieval only for SEG/SR.
  - Retries with backoff on 5xx. On 401, refresh the token and retry once. Never retry 403 or 404.
  - Metadata is Zod-validated.
  - Series are sorted by `ImagePositionPatient` projected onto the slice normal, and split when orientation is mixed or positions repeat.
  - Each series gets a `reconstructable` reason.
  - The `navigateTo` slice loads first, then the rest prefetches outward from it.
  - Thumbnails are decoded on the CPU (no WebGL context).
- **Tools**
  - Two tool groups: stack and MPR.
  - Mouse: left = active tool, middle = pan, right = zoom, wheel = scroll.
  - Keyboard shortcuts are scoped to the viewer root.
  - Toolbar config items: tool, action, menu, separator, custom.
  - W/L presets: lung 1500/−600, soft tissue 400/40, bone 2500/480, brain 80/40, liver 150/30.
- **Measurements**
  - Supported: length, bidirectional, ellipse and rectangle ROI (HU stats), probe, angle.
  - Annotations map to a Zod `Measurement` union (world-mm coordinates plus references), with pure mappers in both directions.
  - Export format is `measurements/v1` JSON.
  - SR TID1500 is a stretch goal, in its own subpath.
- **Segmentation**
  - Each SEG series becomes its own Cornerstone segmentation, loaded through adapters as a labelmap.
  - The store owns visibility, color, and opacity, and a reconciler applies them to every viewport, including ones created later.
  - A segment index (slices, centroid, largest slice) is built in the compute worker.
  - `highlight` modes: `dim-others` and `outline`.
  - Geometry and overlap checks emit `segmentation:warning`.
  - Performance budget: 512×512×300 with 100 segments decodes in under 3 s.
- **MPR**
  - Volumes are streamed only when needed.
  - A memory pre-flight check runs first. Default `maxCacheBytes` is 1 GB, or 512 MB on low-memory devices, with LRU purge.
  - Series that are tilted, non-uniform, or over budget fall back to a stack view, and the UI shows the reason.
  - Crosshairs, plus VOI sync per series.
  - Layouts are CSS grid templates with stable `vp-0..3` IDs. Hanging protocols are scored per modality.
  - WebGL uses `ContextPool` mode. v1 supports one viewer per page.
- **Theming and accessibility**
  - `--dv-*` CSS tokens, dark by default, light theme via `[data-theme=light]`, plus `::part()`. A `palette` attribute picks the colours (`default`, `navy`, `graphite`), and a host can change any one token.
  - The toolbar is a roving-tabindex `role=toolbar`.
  - Viewports have `role=img` with a throttled live label.
  - axe checks run in Playwright.
  - The overlay hides patient-identifying fields by default.

## Milestones (solo part-time; focused dev days)

| # | Milestone | Done when | Days |
|---|---|---|---|
| M0 | Bootstrap | Packages build. Tooling: changesets, tsdown/rolldown, TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Biome + ESLint, Vitest, CI. Phantom v0 committed. | 2 |
| **M1** | **Packaging spike (go/no-go)** | `pnpm pack` tarballs render a J2K phantom stack from `dicomweb-mock` in proxy mode, with zero config, in vite-react, Next (Turbopack and webpack), vite-vue, nuxt, and vanilla. `url` mode works. No SSR errors. Cornerstone works in a Lit light-DOM element. The v5 adapters SEG API is confirmed. Bundle sizes are recorded. ADRs written for assets and DOM strategy. | 7 |
| M2 | Core foundation | A headless vanilla example loads a study by UID and scrolls. Includes the DICOMweb source (headers, 401 refresh, capabilities), metadata/sort/split, store, events, `ViewerStateV1`, URL codec, and the local-file source. 20 mount/unmount cycles leak nothing. | 6 |
| M3 | Navigation | Tool bindings, keyboard, W/L presets, zoom/pan/reset/invert, cine, overlay text, slice indicator, and `navigateTo` with prioritized load. `RenderingPort` fake + unit tests. | 5 |
| M4 | Styled shell + adapters | Lit toolbar, viewport grid, series browser with thumbnails, slots, and panel registry. React and Vue adapters. Light and dark themes. axe clean, and fully usable by keyboard. | 7 |
| M5 | Measurements | All 6 tools, with a list panel to rename, delete, and jump. Mappers tested in both directions. HU stats within ±0.5 HU on the phantom. JSON round-trip. | 6 |
| M6 | Segmentation | Two phantom SEGs, with per-segment visibility, color, opacity, jump, and highlight. Visibility stays in sync across viewports. Segment index runs in the worker. Geometry warnings fire. Performance budget met. | 7 |
| M6.5 | Shell polish | The toolbar has icons, tooltips with the key, and grouped tools. The Segments panel and the viewport overlays are redesigned from OHIF-style ideas (no OHIF code or icons). A host can change the look with tokens (palette, accent) with no code. A SEG whose series is not on screen loads, or says why it cannot. axe is still clean, keyboard use is unchanged, and the matrix passes. | 4 |
| M6.6 | Config layer | One serializable `ViewerConfigV1` (Zod, JSON Schema) sets the theme, palette, toolbar (by command name), keys, overlay items, and panels. Commands are a registry. Layers apply and revert. A config loads from an allowlisted URL, as data. Patient tags stay hidden unless asked for. Code options win over config. The same JSON file gives the same viewer in every framework, and with no config the viewer is as it was. See [ADR 0011](adr/0011-config-layer.md). | 4 |
| M7 | Layouts + MPR | All four layouts, series drag-and-drop into viewports, hanging protocols, streaming volume, memory policy, crosshairs, VOI sync, and SEG in MPR. Tilted and non-uniform phantoms fall back correctly. | 8 |
| M8 | Hardening + 1.0 | Visual regression suite, size-limit budgets, publint + attw, TypeDoc + guides, and `1.0.0` published with provenance. | 5 |
| M9 | OncoTrace readiness | `examples/oncotrace-like` covers the restricted mock proxy, a 10-minute token refresh, the banner slot, organ/tumor toggles, and navigate-by-SOP with segment highlight. A doc maps each bridge message to the API. No OncoTrace changes. | 2 |

**Total:** about 63 days, plus a 20% buffer, so roughly 76 days (about 7 months at 2.5 days a week). M6.5 and M6.6 were added after M6: the first look at the shell showed it was plain, and OHIF's configurable layer showed what ours lacks.
**Stretch:** SR TID1500 (4 days) and per-lesion connected components (3 days).

OncoTrace bridge mapping, for M9:

| OncoTrace message | Package API |
|---|---|
| `oncotrace:auth` | `getRequestHeaders` + `onUnauthorized` |
| `navigate` | `navigateTo` with `segmentations` |
| `set-overlay` | `segmentations.setVisible` |
| `overlay-state` | the `segmentation:visibility` event |
| `ready` | `viewer.ready` / `study:loaded` |

Reference files:
- `apps/viewer/extensions/oncotrace-bridge/src/protocol.ts` and `ohifAdapter.ts`
- `apps/web/src/components/ViewerFrame.tsx`
- `apps/web/src/viewer/useViewerChannel.ts`
- `apps/viewer/config/app-config.js.template`

## Verification

- **Unit tests** (Vitest)
  - Covers metadata, sorting and reconstructability, store and URL codec, mappers, keybindings, SEG index, and hanging protocols.
  - The DICOMweb client is tested with MSW: headers on every request, 401 refresh then retry once, 403 not retried, multipart parsing.
- **Real-browser tests**
  - Vitest browser mode with Playwright and Chromium, against `dicomweb-mock`.
  - Asserts decoded HU, measurement stats, segment index, and navigation results.
  - WebGL via `--use-angle=swiftshader --enable-unsafe-swiftshader`, plus a deterministic CPU-backend job.
- **Visual regression:** Playwright screenshots in the pinned Playwright Docker image.
- **Installability matrix**
  - Every PR (and weekly against the latest versions) builds each example from packed tarballs, starts the production build, and runs a smoke test.
  - The smoke test checks the canvas isn't blank, the worker loaded, J2K decoded, and there are no console errors.
- **Gates:** publint, `@arethetypeswrong/cli`, size-limit, and a check that only `engine/` imports Cornerstone.
- **End-to-end:** run `examples/oncotrace-like` against the mock proxy in its OncoTrace restricted mode and walk the M9 bridge mapping by hand.

## Key risks

| Risk | Mitigation |
|---|---|
| Cornerstone major churn | Exact pins; `RenderingPort` isolation; grouped upgrade PRs gated on the browser suite |
| Worker/WASM breaks in a bundler | Inline mode avoids `import.meta.url`; `url` mode and helpers as fallback; tarball matrix in CI |
| vtk.js touches `window` at import in Next | Dynamic import inside effects; both Next bundlers tested in CI |
| WebGL context limits | `ContextPool` mode; CPU thumbnails; one viewer per page |
| Volume memory | Pre-flight memory estimate; LRU purge; stack fallback |
| Vue reactivity proxying Cornerstone objects | `markRaw` + `shallowRef`; a test asserts no Proxy |
| SEG geometry mismatch | Validation, warnings, and a mismatch phantom |

## Open questions (resolve during M0/M1)

1. Package name and npm scope, and the element prefix (assumed `dv-`).
2. React 18 support, or `^19` only?
3. Is Nuxt required for v1 or best-effort?
4. Must Safari and iPad be supported? This affects memory defaults and touch support.
5. Should default bindings match OHIF exactly?

## M1 outcome

**Go.** The report is [m1-report.md](m1-report.md). Changes to this plan that came out of the spike:
- Cornerstone is bundled into core (ADR 0003) instead of being a transitive dependency of hosts. Vite fails on vtk.js's Node `events` import, and tools' compute worker cannot be resolved from a host build.
- Both workers are prebuilt, and the `inline` asset mode embeds them (ADR 0001).
- The phantom gained a binary SEG (`seg-body-bone`) earlier than M6, to test the adapters against real data.
- Still open: Safari and Firefox, React 18, the package name, and the `compute` worker size (2.8 MB).


## M2 outcome

**Done.** The report is [m2-report.md](m2-report.md); the decisions are in [ADR 0004](adr/0004-viewer-state-and-ordering.md) and [ADR 0005](adr/0005-engine-runtime-lifecycle.md). Changes to this plan that came out of the milestone:
- **`Viewer` so far** has `loadStudy`, `viewports` (`attach`, `detach`, `get`, `list`), `setViewportSeries`, `getState`, `setState`, `subscribe`, `on`, and `destroy`, plus `initialState` in the options. `setLayout`, `navigateTo`, `tools`, `measurements`, `segmentations`, and `ui` arrive with the milestones that own them. `ViewerStateV1.layout` is `'1x1'` until M7.
- **A series is a list of stacks.** `getSeries` splits by orientation and by repeated positions, and each stack carries its own `reconstructable` reason (the plan said per series). SEG and SR series have no stacks.
- **Capabilities** is `{ instanceRetrieve }` only. `studySearch` and `maxFramesPerRequest` return when something can act on them.
- **Local files:** `createLocalFileDataSource(files)` lives at `@scope/viewer-core/local` and adds `studyInstanceUIDs()`, `skipped()`, and `dispose()`. The host disposes it.
- **WebGL:** still ContextPool mode, with a pool of one context instead of Cornerstone's seven (ADR 0005). M7 revisits it for MPR.
- **Multi-frame image series** are refused with an error until a fixture and per-frame geometry exist.
- Still open: Safari and Firefox, React 18, the package name, the `compute` worker size, cancellation of superseded loads, and `<dv-viewer>` request headers (M4).

## M3 outcome

**Done**, in the headless example. The report is [m3-report.md](m3-report.md); the decisions are in [ADR 0006](adr/0006-view-state-and-input.md). Changes to this plan that came out of the milestone:
- **The view is part of the state.** `ViewportStateV1` has `window`, `invert`, and `zoom`, kept only when they differ from the default. Pan, the left-button tool, and cine are not in it.
- **`Viewer` so far** also has `navigateTo`, `tools`, and the options `tools`, `windowLevelPresets`, `keybindings`, `overlay`, and `prefetch`. `NavigateTarget` has no `segmentations` until M6.
- **Cine runs in the core**, not in Cornerstone's cine tool.
- **Prefetching** is Cornerstone's `stackPrefetch`, 64 slices either way by default; it has one setting per page.
- **Runtime release** waits for loads in flight before it stops the workers (ADR 0005).
- Still open: Safari and Firefox, React 18, the package name, touch input, cancellation of a started request, and whether the default keys should match OHIF exactly.

## M4 outcome

**Done**, with the limits in [m4-report.md](m4-report.md); the decisions are in [ADR 0007](adr/0007-styled-shell.md). Changes to this plan that came out of the milestone:
- **The shell is chrome in shadow DOM and viewports in light DOM, shown through slots.** The adapters wrap `<dv-viewer>`, so one UI codebase serves vanilla, React, and Vue.
- **`viewer.ui.registerPanel` lives in the core**, as data, so a headless host can use it. `viewer.thumbnails.get` draws on the CPU through the rendering port.
- **`@scope/viewer-core/testing`** is a real viewer on a fake engine, for tests of hosts and adapters.
- **The controlled `state` prop moves to M5 to M7**, with the state it controls. `Viewer.ui` has panels only; slots are the shell's.
- Still open: Safari and Firefox, React 18, the package name, touch input, and whether the default keys should match OHIF exactly.

## M5 outcome

**Done**, with the limits in [m5-report.md](m5-report.md); the decisions are in [ADR 0008](adr/0008-measurements.md). Changes to this plan that came out of the milestone:
- **Measurements are data in the core, and the engine draws a copy.** `viewer.measurements` keeps them whatever is on screen; Cornerstone's annotations are removed with the stack and drawn again when it returns. The model is `measurements/v1` in patient millimetres with a reference to the instance.
- **The statistics are the core's own**, from decoded pixels read through the queue (`RenderingPort.readSlice`), not Cornerstone's text. The conversions between a measurement, the engine's shape, and a Cornerstone annotation are pure functions with round-trip tests.
- **Measurements are not in `ViewerStateV1`.** A link should not carry a case's annotations. The controlled `state` prop stays deferred, now to M7, with layouts and segmentations.
- **The shell has a Measure menu and a built-in `measurements` panel** on the right; React and Vue have `hideMeasurementsPanel` and `useMeasurements`.
- Still open: Safari and Firefox, React 18, the package name, touch input, and whether the default keys should match OHIF exactly. M7 inherits one thing from here: two viewports of one series must count the users of a stack's shapes.

## M6 outcome

**Done**, with the limits in [m6-report.md](m6-report.md); the decisions are in [ADR 0009](adr/0009-segmentations.md). Changes to this plan that came out of the milestone:
- **A SEG is data in the core, and the engine draws it.** `viewer.segmentations` has `load`, `unload`, `list`, `get`, `setVisible`, `setSegmentVisible`, `setSegmentColor`, `setSegmentOpacity`, `setOpacity`, `highlight`, and `jumpToSegment(series, segment, { strategy, viewportId })`, each taking the SEG's series first (the plan's signatures left it out). `navigateTo` takes `segmentations`. A SEG goes with its study.
- **A binary SEG is decoded on the compute worker, by our own decoder**, because the Cornerstone adapters took 3.8 s on the main thread for the plan's 512 by 512 by 300 SEG with 100 segments. The decode and the segment index take 1.2 s on the worker, and the whole load, request included, about 2.1 s. The adapters stay as the way to read any other kind. The compute worker is still one worker: the build wraps its `comlink`.
- **The segment index** (pixels and images of each segment, its middle, the images it is on) is built in the same pass, and the three jump strategies (`largestSlice`, `centroid`, `nearestTo`) and the centre in patient millimetres are pure functions.
- **Geometry warnings** are checks of the SEG against the images it names (frame of reference, direction, pixel spacing, planes off their images, missing instances, shared pixels, empty segments). A SEG with warnings is drawn.
- **The phantom has five SEGs**, three more than the plan's two: `seg-body-bone`, `seg-inserts`, `seg-overlap` (two layers), `seg-mismatch` (another frame of reference and planes 12 mm off), and `seg-fractional` (read by the adapters). The SEG of the budget is generated, not committed.
- **The shell has a Segments panel** (second tab on the right), and React and Vue have `hideSegmentationsPanel` and `useSegmentations`.
- **SEG state is not in `ViewerStateV1`.** The controlled `state` prop stays deferred to M7.
- Still open: Safari and Firefox, React 18, the package name, touch input, and whether the default keys should match OHIF exactly. M7 inherits three things: SEG in MPR, the count of users of a stack's shapes and SEGs when two viewports show one series, and the controlled `state` prop.

## M6.5 outcome

**Done**, with the limits in [m6.5-report.md](m6.5-report.md); the decisions are in [ADR 0010](adr/0010-shell-polish.md). Changes to this plan that came out of the milestone:
- **The shell looks like a viewer.** An icon toolbar (our own icons) with tooltips that print the bound key, a Measure button that shows the chosen tool, a dock with icon tabs that folds to a strip, a Segments panel with an eye, a round swatch and icon buttons, and an overlay in the shell's font and tint. OHIF was a reference for ideas only: no code or icons were copied.
- **The colours are the host's choice.** `palette` is `default`, `navy`, or `graphite`, each tested for contrast in both themes, and any single colour is a `--dv-color-*` property. `labels="inline"` (`toolbar-labels`, `toolbarLabels`) puts names beside the pictures.
- **New core API:** `viewer.tools.shortcuts()`, so a toolbar prints the key that is bound. The port's `loadSegmentation` takes the stack.
- **A bug the first look found:** a SEG whose CT was not on screen failed to load (`reading 'rows'`). The engine now learns the images' headers and holds them with the SEG.
- Still open: Safari and Firefox, React 18, the package name, touch input, whether the default keys should match OHIF exactly, and a visual regression suite (M8). A host's panels can name one of the shell's icons but cannot add their own.

## M6.6 outcome

**Done**, with the limits in [m6.6-report.md](m6.6-report.md); the decisions are in [ADR 0011](adr/0011-config-layer.md). Changes to this plan that came out of the milestone:
- **One config, as data.** `ViewerConfigV1` (Zod, with a JSON Schema that ships) sets the theme, palette, toolbar, keys, overlay lines, panels, window presets, and the first tool. It goes in as `config` (the element, React, Vue, and `createViewer`), or is fetched with `config-url` from an origin the page lists. A setting made in code wins over it, and `viewer.config.apply(layer)` puts a layer on top and returns the function that takes it off.
- **Commands.** `viewer.commands` names what the viewer can do (`tool.set`, `view.zoomIn`, `preset.apply`, and the rest), so a toolbar button in a config runs a command, and a host adds its own with a namespace.
- **The overlay is items.** Each corner is a list of lines (its own, or a DICOM tag with a label and a format), merged by id. A tag that can identify a patient never shows unless `showPatientInfo` is on.
- **A bug the matrix found:** the engine did not report a change of invert alone, so the state, the overlay, and the toolbar's pressed state were stale. Fixed.
- Still open: Safari and Firefox, React 18, the package name, touch input, whether the default keys should match OHIF exactly, a visual regression suite (M8), and a host's own icons for panels and toolbar buttons. M7 can use `viewer.config.apply` for layouts, and M9 for the OncoTrace profile.

## M7 outcome

**Done**, with the limits in [m7-report.md](m7-report.md); the decisions are in [ADR 0012](adr/0012-layouts-and-mpr.md). Changes to this plan that came out of the milestone:
- **Four layouts, as data.** `1x1`, `1x2`, `2x2`, and `1+3` with stable `vp-0` to `vp-3`. `ViewerStateV1.layout` is one of them and `viewports` holds exactly the ids it shows. One viewport is *active*, and the toolbar, the commands, and the panels act on it.
- **Series by drag and drop, and hanging protocols.** A row of the series browser is dragged onto a viewport under one custom data type. A protocol is plain data scored per modality; the shell applies the best fit when nothing was asked for. The keyboard route is choosing a row, which fills the active viewport.
- **MPR as `renderVolume`.** A viewport asks for a plane (`orientation`) and the viewer decides in a pure function: the stack must be reconstructable and its volume must fit `memory.maxCacheBytes` (1 GiB, 512 MiB on small devices). Otherwise the viewport shows slices and says why, in one of eight reasons. The port returns a `StackPort`, so nothing above it knows a plane from a stack. Planes of one volume share a tool group (crosshairs), a window and an inversion (VOI sync), and a SEG is copied into a volume to be drawn over them.
- **Two phantom series that cannot be reformatted,** a tilted one and one with a missing slice, in a study of their own.
- **The controlled `state` prop** of React and Vue, deferred since M5, is in: the layout and every viewport; not the study, measurements, or SEGs.
- **Two things the matrix found in Cornerstone:** the images of a volume share its buffer and cannot be dropped one by one, and a volume given up before it has loaded leaves a listener per image that keeps the page's WebGL context alive. The engine works around both.
- Still open: Safari and Firefox, React 18, the package name, touch input, whether the default keys should match OHIF exactly, a visual regression suite (M8), a host's own icons for panels and toolbar buttons, measurements on planes, and jumping to a segment in a plane.

## M8 outcome

**Ready to release; not released.** The gates and the documentation are built and run in CI, and the `1.0.0` changeset is in place; publishing waits for a decision (the npm scope) and a token. See [m8-report.md](m8-report.md) and [guides/releasing.md](guides/releasing.md). Changes to this plan that came out of the milestone:
- **Four gates on what a consumer gets:** publint and are-the-types-wrong on the packed tarballs, brotli size budgets on every emitted chunk, an API reference that builds with warnings as errors, and a visual regression suite. All but the last pass in CI; the last needs its baselines made in the pinned Playwright image.
- **Docs are Markdown guides plus a generated API reference** (`pnpm docs:api` writes `.docs/api`), not a VitePress site. A site is a hosting decision for later.
- **A release is a changeset, a "Version Packages" pull request, and a publish with provenance,** all behind the repository variable `RELEASE_ENABLED`, because the package names are still the `@scope/` placeholder.
- Still open: the package name and npm scope, committing the visual baselines, Safari and Firefox, React 18, touch input, and (for M9) the OncoTrace-like example.
