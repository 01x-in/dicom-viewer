# M6 report: segmentation

**Done by the plan's criteria**, with the limits listed at the end. The repository has 994 tests (768 at the end of M5). The full matrix passes: vanilla, headless (every scenario, including the new `segmentation`, `segmentation in two viewports`, and `segmentation budget`), Vite React, Vite Vue, Next with Turbopack and with webpack, and Nuxt, each in `inline` and `url` mode, and each with the extended `shell` scenario.

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| Two phantom SEGs | [phantom.py](../tools/phantom/phantom.py), [fixtures/phantom](../fixtures/phantom/README.md) | Five: `seg-body-bone` (byte for byte as before), `seg-inserts` (four segments on 48 images), `seg-overlap` (two layers), `seg-mismatch`, and `seg-fractional`. Python tests read each back with highdicom. The checksums and the regenerated tree are checked in CI |
| Per-segment visibility, colour, and opacity | [display.ts](../packages/core/src/segmentations/display.ts), [engine/segmentation.ts](../packages/core/src/engine/segmentation.ts), [registry.ts](../packages/core/src/segmentations/registry.ts) | The `segmentation` scenario reads the canvas of the real engine: each colour is within 8 of 255 of what the settings say, for colour, opacity 0 and 1, a hidden segment, a hidden SEG, and everything restored |
| Jump | [locate.ts](../packages/core/src/segmentations/locate.ts) | `largestSlice`, `centroid`, and `nearestTo` go to the images worked out from the phantom (8, 31, 55, 8), and the viewport shows them. The segment's middle in patient millimetres is checked against the bone insert's known centre to 0.1 mm |
| Highlight | [display.ts](../packages/core/src/segmentations/display.ts), the outline segmentation in [engine/segmentation.ts](../packages/core/src/engine/segmentation.ts) | `dim-others` takes the other segments to a tenth in the canvas and leaves the chosen one. `outline` changes at least 6 of 12 pixels round the chosen segment and leaves every fill alone |
| Visibility stays in sync across viewports | the registry's `attach` | A page with two viewports of one series: one call changes both canvases, and a viewport attached later draws what is loaded as it now looks. A unit test covers the same with the fake engine |
| Segment index runs in the worker | [segment-index.ts](../packages/core/src/segmentations/segment-index.ts), [decode-binary.ts](../packages/core/src/segmentations/decode-binary.ts), [comlink-expose.ts](../packages/core/workers/comlink-expose.ts) | The counts, images, and centres of the phantom SEGs come from the compute worker in both asset modes (the page does the work itself, with a console warning, only if the worker cannot be had; the matrix does not fail on that warning, but the timings above are the worker's). The counts agree with what the Cornerstone adapters make of the same files: 618,640 and 12,144 pixels, and 39,858, 26,397, and 13,797 shared |
| Geometry warnings fire | [validate.ts](../packages/core/src/segmentations/validate.ts) | Unit tests on the real phantom headers, and in the real engine the mismatch SEG says `frame-of-reference` and `plane-position` ("21 frames ... by up to 12.0 mm"); the overlap SEG says `overlapping-segments`. The shell shows the warnings, and axe is run with them showing |
| Performance budget met | [perf.py](../tools/phantom/perf.py), the `segmentation budget` scenario | 512 by 512 by 300 with 100 segments (143 MB, 4500 frames, 4,447,300 pixels): about 2.1 s for the whole call, request included, against 3 s. The decode on the worker is 1.2 s. The Cornerstone adapters took 3.8 s on the main thread for the same file |

## What the real engine and the tests found

| Problem | Cause | Fix |
|---|---|---|
| The adapters missed the budget and froze the page | They read the SEG with dcmjs on the main thread: 3.8 s of the 4.1 s | A decoder of our own for binary SEGs, on the compute worker, from the bit-packed pixel data to labelmap layers and the index in one pass (1.2 s). The adapters stay for any other kind |
| 112 warnings "No imageId found for SOPInstanceUID" on every load | Cornerstone v5's `generalImageModule` has no SOP instance UID, which the adapters read there, so every frame fell back to matching by position | The adapters get a metadata provider that adds it. The mismatch phantom, which has planes that match nothing, would otherwise load no frames |
| A SEG that covers some images kept drawing on the images it does not cover | With labelmap images only where there were pixels, Cornerstone goes on drawing the last labelmap | A labelmap image for every image of the stack (found by the real-engine scenario on `seg-inserts`, which covers 48 of 64) |
| A SEG of one segment had no segment numbers on its frames | highdicom names the segment once, in the shared functional groups, when there is only one | The reader takes the shared one as the default (found by a unit test on the real `seg-mismatch` file) |
| The decoder test assumed frames come in slice order | highdicom orders them as it likes | The tests check each frame against the instance it names |
| Two overlapping layers did not look like one over the other | Cornerstone shares the overlay equally between the layers (a quarter of the image shows, three eighths for each colour) | The scenario checks that rule; recorded in the ADR |
| Outlining some segments of a labelmap is not possible | Cornerstone outlines all of a labelmap or none | A second segmentation over the same labelmap images, drawn as outlines only |
| `pnpm matrix` packed a stale build | The matrix packs what is in `dist`; it does not build | `CLAUDE.md` and the README say to run `pnpm build` first |
| The headless scenario expected three series in the list | The phantom now has seven | It counts the study's series |
| With `cpuRendering`, a SEG draws nothing and Cornerstone logs `getActors(...).filter is not a function` | A labelmap is a WebGL actor | The engine does not try, and the SEG gets a `not-drawn` warning |

## Decisions

- [ADR 0009](adr/0009-segmentations.md): a SEG is plain data in the core and the engine draws it as Cornerstone labelmaps; what is drawn is a pure function of the settings; the registry is the reconciler for every viewport; a SEG goes with its study; a binary SEG is decoded on the compute worker by our own decoder, with the adapters for the rest; geometry doubts are warnings; `navigateTo` loads, sets, and highlights after the slice is on screen.
- The segment index is built in the same pass as the decode, and the three jump strategies are pure functions.
- A SEG is not in `ViewerStateV1`.

## Changes to the API

- **Core:** `viewer.segmentations` (`list`, `get`, `load`, `unload`, `setVisible`, `setSegmentVisible`, `setSegmentColor`, `setSegmentOpacity`, `setOpacity`, `highlight`, `jumpToSegment`); the events `segmentation:loaded`, `:unloaded`, `:updated`, `:visibility`, `:warning`; the error context `segmentation`; `NavigateTarget.segmentations` and `NavigateResult.failedSegmentations`; `EngineDiagnostics.segmentations`; the helpers `parseColor`, `colorToHex`, and the constants for opacity, highlight modes, and jump strategies. **Removed:** `ViewportApi.loadSegmentation` and the exported `SegmentationHandle` and `SegmentInfo` of the M1 spike (a new `SegmentInfo` describes a segment of a loaded SEG).
- **Port:** `RenderingPort.readSegmentationHeader`, `loadSegmentation(imageIds, bytes, header)`, `StackPort.drawSegmentation` and `hideSegmentation`.
- **Testing:** the fake source has six SEGs (`FAKE_IDS.seg`, `segSecond`, `segOverlap`, `segOff`, `segOnSecondStack`, `segUnreadable`), and the fake engine records what it is asked to draw and lets a test say what is in a SEG.
- **Elements:** `<dv-segmentation-list>` and `hide-segmentations-panel`.
- **React and Vue:** `hideSegmentationsPanel` and `useSegmentations`. The right-hand dock now has two built-in tabs, so a test that wants only its own panels hides both.
- **Examples:** every example exposes `window.__dvViewer`, and the headless example has `second` (a second viewport) and `seg` (a SEG in every leak-check cycle).

## Not done, or not proven

- **Only binary SEGs whose frames name their instances take the fast path.** Fractional SEGs (run in the real engine through the adapters) and anything else are read on the main thread at the adapters' speed. SEGs of the newer labelmap type have not been tried.
- **The page's heap and the engine's cache hold a layer's labelmap images for every image of the stack** (78 MB per layer at the plan's size), and about three times the file while it loads.
- **The overlay is placed by the instances a frame names, not by its planes.** A SEG that is off its images is drawn on them, with a warning.
- **SEGs need WebGL.** With the CPU rendering option Cornerstone throws when asked to draw a labelmap (found by running it). The engine now refuses, and the SEG carries a `not-drawn` warning; the numbers of the SEG are still right, but nothing is drawn.
- **The budget on a shared CI runner is set to 9 s**, since it was only measured on the development machine, at about 2.1 s.
- **No editing, creating, or exporting a SEG, no per-segment statistics, nothing in MPR** (M7), and no SEG in `ViewerStateV1`.
- **Highlight has no settings** (3 pixel outline, a fifth of the opacity for dimmed segments).
- **Two viewports of one series work for SEGs but not yet for measurements** (one stack per series).
- **Chromium only**, as before. Safari and Firefox, React 18, the package name, touch input, and open question 5 (the default keys against OHIF) are still open.
