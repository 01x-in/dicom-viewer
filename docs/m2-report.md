# M2 report: core foundation

**Done by the plan's criteria.** A headless example ([examples/headless](../examples/headless)) loads a study by UID, scrolls, restores a view from a link, refreshes an expired token, retries a failing server, reads local files, and survives 20 mount/unmount cycles without leaving anything behind. The data layer, store, events, `ViewerStateV1`, the URL codec, and the local-file source are in `@01x/dicom-viewer-core`, with 240 unit tests (48 at the end of M1).

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| Headless vanilla example loads a study by UID and scrolls | [examples/headless](../examples/headless) | `dicomweb` scenario: lists the study (QIDO, scoped to the study), picks and switches series, scrolls by API and by mouse wheel, J2K Hounsfield values exact at seven probe points |
| DICOMweb source: headers | [request.ts](../packages/core/src/data/request.ts) | `getRequestHeaders` is called synchronously for every request, for metadata, series lists, whole instances, **and the frames the loader fetches itself** (through the loader's `beforeSend`) |
| DICOMweb source: 401 refresh | same, [frame-policy.ts](../packages/core/src/engine/frame-policy.ts) | `auth` scenario against a mock that answers 401 until it has accepted a token: one refresh when a frame fails, one when a metadata request fails, each retried once; concurrent 401s share one refresh, and a 401 for a request sent before the last refresh does not trigger another |
| DICOMweb source: capabilities | [dicomweb.ts](../packages/core/src/data/dicomweb.ts) | `instanceRetrieve: 'all' \| 'seg-sr-only' \| 'none'`, enforced before any request. 403 and 404 are never retried; 5xx back off and retry (the `retry` scenario injects two 503s) |
| Metadata, sort, split | [series.ts](../packages/core/src/data/series.ts) | Slices sort along the slice normal. A series splits by orientation and by repeated positions (multi-phase, dual energy) into stacks, largest first. Each stack says whether it can become a volume, or why not: missing geometry, too few slices, missing pixel spacing, inconsistent size, tilted, non-uniform spacing |
| Store, events | [store.ts](../packages/core/src/state/store.ts), [events.ts](../packages/core/src/state/events.ts) | Selector subscriptions with equality, ordered nested updates, change origin; handler errors cannot break emitters |
| `ViewerStateV1`, URL codec | [viewer-state.ts](../packages/core/src/state/viewer-state.ts), [url.ts](../packages/core/src/state/url.ts) | Zod schema; base64url JSON; every UID validated. The example keeps its address in sync, and a reload restores the series and the slice |
| Local-file source | [local.ts](../packages/core/src/data/local.ts), subpath `@01x/dicom-viewer-core/local` | `local files` scenario: 64 J2K files plus a SEG plus a text file chosen through a real `<input type=file>`; exact HU values after decode, the SEG parses, the text file is reported as skipped, and no DICOMweb request is made |
| 20 mount/unmount cycles leak nothing | [runtime.ts](../packages/core/src/engine/runtime.ts), [ADR 0005](adr/0005-engine-runtime-lifecycle.md) | `lifecycle` scenario, below |

## The lifecycle check

Twenty viewers in a row in one page: mount, load the J2K series, scroll, destroy, remove the element. After every cycle `getEngineDiagnostics()` must report no rendering engines, viewports, cached bytes, or worker threads, and `page.workers()` must be empty at the end. After three warm-up cycles the DOM node count, event listener count, and (after forced garbage collection) heap size are compared with the end, and the page's WebGL contexts are tracked through weak references.

What the run saw, in both asset modes (Chromium, SwiftShader):

| | After 3 cycles | After 20 |
|---|---|---|
| DOM nodes | 53 | 40 |
| JS event listeners | 56 to 63 | 18 |
| JS heap | 9.5 to 9.8 MB | 10.5 to 10.7 MB |
| WebGL contexts alive after GC | | 0 (27 to 32 created in all) |

A separate scenario alternates `inline` and `url` assets between viewers, which the runtime allows once no viewer is running.

## Decisions

- [ADR 0004](adr/0004-viewer-state-and-ordering.md): the state says what to show, and every change is applied in order through one queue, so a failure belongs to the call that caused it.
- [ADR 0005](adr/0005-engine-runtime-lifecycle.md): the engine runtime is shared by viewers and released with the last one; one WebGL context instead of seven.
- Each DICOMweb source marks the image ids it hands out with a URL fragment (`#dv-source-N`, never sent to the server) and its frame policy claims only those. Two viewers with the same `wadoRoot` and different credentials therefore never share headers or a refresh hook, and never share cached pixels.
- `RenderingPort` is real now ([rendering-port.ts](../packages/core/src/rendering-port.ts)). The viewer's logic runs against a fake port in unit tests (47 tests of the queue, state, events, and teardown races).
- The frame loader's `setOptions` is not exported by `@cornerstonejs/dicom-image-loader`, and it is the only way to add headers to its requests. The engine build aliases `dv-loader-options` to the file the loader's own request code imports, so both share one module. This depends on the pinned version's internal layout and must be re-checked on every Cornerstone upgrade (like the other three workarounds in ADR 0003).

## Changes to the M1 spike API

`createViewer`, `LoadedSeries`, `loadSeries`, and `LoadedSegmentation` are gone. The element, the React component, the Vue component, and all examples now use `viewer.viewports.attach`, `viewer.setState`, and `ViewportApi`. `<dv-viewer>` fires `dv-ready` with `{ viewport }`, and the React and Vue `onReady`/`ready` give a `ViewportApi`. `viewport.loadSegmentation` stays as the M1 spike until M6.

## Problems found, and what fixed them

| Problem | Where | Fix |
|---|---|---|
| A failed render was reported to whichever queued call happened to run first, and `setState` resolved as if it had worked | first version of the viewer queue | state changes now happen inside the queued task, in call order (ADR 0004) |
| Browsers reported retried requests as `net::ERR_ABORTED` | error bodies were cancelled | read to the end instead, which also lets the connection be reused |
| `removeImageLoadObject: imageId was not present in imageCache` broke series switching | per-stack cache cleanup | only slices that were loaded are removed |
| 5 worker threads and the image cache survived the last viewer | M1 runtime never released | refcounted release (ADR 0005) |
| About 8 WebGL contexts per viewer, so Chromium warned within five cycles | Cornerstone's default pool of seven | `webGlContextCount: 1` |
| `finally` ran before the shared refresh promise was stored when a hook threw synchronously, leaving a rejected promise as the "in flight" refresh forever | request layer | cleanup moved to `.finally` on the stored promise |

## Not done, or not proven

- **Capabilities** has one field, `instanceRetrieve`. The plan's `studySearch` and `maxFramesPerRequest` have nothing to act on yet (QIDO is only ever scoped to a study; the loader asks for one frame at a time), so they were left out rather than accepted and ignored.
- **No cancellation.** The requester takes no abort signal, so a series that was superseded still loads, and a slow call delays those behind it (ADR 0004). M3's prioritised loading should add it.
- **Multi-frame image series are refused** with a clear error (SEG and SR are fine). Enhanced CT/MR need per-frame geometry; no fixture exists yet.
- **Local files:** every file is read once, whole, to parse its header, and again when its slice is shown (the engine registers the file lazily, so a series is not read into memory up front). Deflated transfer syntax is not supported, and dropping a folder with thousands of files will read them all before anything is shown. The host must call `dispose()` on the source; the viewer does not, because StrictMode destroys one viewer and creates another on the same source.
- **`<dv-viewer>` cannot set request headers** (it takes a `wado-root` attribute only). Hosts that need auth use `createViewer` or the React and Vue components with `options`. The styled element's configuration is M4.
- **Layouts and the full public API.** `layout` is `'1x1'` only, and `Viewer` has no `setLayout`, `navigateTo`, `tools`, `measurements`, or `segmentations` yet.
- **Browsers:** Chromium only. Safari, Firefox, and iPad are untested. GPU memory under pressure is not tested (SwiftShader).
- **React 18, package name, Nuxt as required, Safari/iPad, default bindings:** the open questions in the plan are unchanged.
- The lifecycle check compares heap size with a 30 MB allowance, DOM nodes and listeners with 50. These are tolerances for browser noise, not proofs: a leak smaller than that per 17 cycles would pass. The structural checks (engines, viewports, cache bytes, workers, WebGL) are exact.
- **Size.** The engine chunk grew a little (the `dicomfile` loader and the DICOM header parser): each example is about 95 KiB raw (11 KiB brotli) larger than at the end of M1. See [m1-bundle-sizes.md](m1-bundle-sizes.md).
