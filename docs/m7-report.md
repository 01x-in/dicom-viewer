# M7 report: layouts and MPR

**Done by the plan's criteria**, with the limits listed at the end. The decisions are in [ADR 0012](adr/0012-layouts-and-mpr.md), which is now accepted.

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| All four layouts | [layouts.ts](../packages/core/src/layouts.ts), [viewer-element.ts](../packages/elements/src/viewer-element.ts) | `1x1`, `1x2`, `2x2`, and `1+3` are a table (columns, rows, and where each viewport goes; a test checks that each covers every grid square once). `ViewerStateV1.layout` holds one and `viewports` holds exactly the ids it shows. `viewer.setLayout`, `setState({ layout })`, the `layout.set` command, and a Layout menu change it. The shell makes, attaches, and removes a viewport element for each. The shell scenario of the matrix opens the menu in every framework and counts the viewports |
| Series drag and drop into viewports | [series-drag.ts](../packages/elements/src/series-drag.ts), the series browser and `<dv-viewer>` | A row carries the series and its study under one custom type. A cell accepts only that type, shows where it would land, and on a drop from the same study shows the series there and makes the viewport active. A payload from anywhere else is validated and ignored; a series that cannot be shown is a `dv-error`. The matrix drags a real row onto a real cell in every framework. Choosing a row with the keyboard fills the active viewport |
| Hanging protocols | [hanging.ts](../packages/core/src/hanging.ts) | Plain data, validated when the viewer is made. `matchHangingProtocol` is pure and scores per modality, per rule, and per blank viewport. `viewer.hangingProtocols` lists, matches, and applies; applying opens every series first and skips one with no pictures. `<dv-viewer>` applies the best fit when nothing was asked for or restored |
| Streaming volume | [engine/volume.ts](../packages/core/src/engine/volume.ts), [engine/index.ts](../packages/core/src/engine/index.ts) | `RenderingPort.renderVolume` draws a stack as Cornerstone's streaming image volume in the axial, sagittal, or coronal plane and returns a `StackPort`. Planes of one stack share a volume |
| Memory policy | [mpr.ts](../packages/core/src/mpr.ts) | `decideMpr` (pure) needs a reconstructable stack and a volume (rows × columns × slices × 4 bytes) that fits `memory.maxCacheBytes` after the volumes already held: 1 GiB, or 512 MiB on a device that reports 4 GiB or less. A volume is counted once however many planes use it. The budget also sets the size of Cornerstone's cache, which drops the images least used |
| Crosshairs | [engine/tools.ts](../packages/core/src/engine/tools.ts) | The planes of one volume share one Cornerstone tool group, so `CrosshairsTool` links them. `crosshairs` is a tool the left button can drive; `viewer.tools.isAvailable('crosshairs')` is true only while two planes of one volume are on screen, and the toolbar button says so. The matrix clicks the phantom's marker in the axial plane and checks that the sagittal and coronal planes went to its column and row |
| VOI sync | [viewer-core.ts](../packages/core/src/viewer-core.ts) | The window and the inversion are copied between the planes of one volume, as the kind of change they were (a person's drag stays a user change). Not the zoom or the slice, and not between two viewports that merely show one series. The matrix sets a window on the coronal plane and reads it off the axial one |
| SEG in MPR | [engine/segmentation.ts](../packages/core/src/engine/segmentation.ts) | Cornerstone draws a labelmap on a plane only as a volume, so the engine copies each layer's labelmap images into a volume of the base volume's shape and registers it (and a second for outlines). The copies are counted by plane and go with the last plane or with the SEG. Visibility, colour, opacity, and highlight follow through the path stacks use. The matrix reads the pixels: the body is tinted red and the bone insert green in all three planes, and neither once the SEG is hidden |
| Tilted and non-uniform phantoms fall back correctly | [phantom.py](../tools/phantom/phantom.py), [fixtures/phantom](../fixtures/phantom/README.md) | `ct-tilted` (stacked along a line 15° off the normal) and `ct-nonuniform` (one 5 mm gap in 2.5 mm spacing) are in a study of their own. Python tests read the angle and the steps back. In a real browser both are shown as their 16 slices, square, with the reasons `tilted` and `non-uniform-spacing`. Unit tests cover the other reasons, a volume over the budget, and an engine that throws `VolumeUnsupportedError` |

## Also in the milestone

- **The active viewport.** The toolbar, the commands, and the series, measurement, and segment panels act on `viewer.viewports.active` (the last viewport pressed or focused), unless a page names one with `viewport-id`.
- **`viewer.showMpr()` and the `mpr.show` command** lay a series out as three planes and the slices; the Layout menu has an entry for it.
- **The controlled `state` prop** that M5 and M6 deferred to this milestone: React and Vue show the state they are given and clear what it leaves out. See the limits below.
- **Where the reason is told.** A viewport that asked for a plane and got slices says why in the viewport; a viewport in a plane is named for it for a screen reader, and numbered when there are several.

## Verification

- Format, lint, and typecheck are clean (`pnpm typecheck`, as CI runs it). The repository has MORE_TESTS unit tests (1,251 at the end of M6.6) and the phantom's 28 Python tests (24 before).
- `pnpm matrix` (all variants, `inline` and `url`): MATRIX_ROWS rows.
- The matrix has new scenarios `mpr` and `mpr fallback` for `headless`, and the `shell` scenario of every framework now opens the Layout menu, drags a series, shows the planes, and runs axe with four viewports and with three planes on screen. The `lifecycle` scenario runs 20 cycles of a viewer with three planes and a SEG; it checks the engine's own counters, which now include volumes.
- The `segmentation budget` scenario (512 × 512 × 300, 100 segments, 3 s) takes about 6.5 s on the machine this milestone was built on, with or without M7: the same scenario on `main` takes 6.5 s and 7.2 s there. It was run with `DV_SEG_BUDGET_MS=20000`. The 2.1 s of the M6 report was another machine.

## What running it found

| Problem | Cause | Fix |
|---|---|---|
| A viewer with planes left a WebGL context behind on every cycle, and the page's contexts only grew | Cornerstone adds a listener to its global event target for each image a volume asks for, and removes it when the image reaches the cache. A volume given up before it finished loading (a cancelled load, every cycle of the leak test) leaves one per image, and each holds the volume, and through it the WebGL context. Found by taking a heap snapshot and asking what kept a context alive | The engine tells the listeners that every image arrived, once, while the volume is still there, before it removes the volume |
| `Cannot decache an image with a shared cache key` | The images of a volume share its buffer, and cannot be dropped one by one before the volume is gone. The removal of the volume was queued, the images' was not | The volume is removed at once when its last plane lets go, and the images that belong to a volume are skipped afterwards |
| The leak check said 53 of 56 WebGL contexts were alive | A volume asks for its context on every render, and the harness counted each ask | The harness counts a context once |
| The first coronal click of the crosshair test did nothing | A click on a crosshair line grabs the line; it does not move it. The test clicked the middle row, which is where the line starts | The test clicks the marker, away from both lines |
| The dicomweb scenario expected 9 series in a study of 7 | It counted the series of the whole fixtures folder, and the folder has a second study now | It counts the series of its study |
| The second viewport of the SEG scenarios was refused | The example page added `vp-1` to a `1x1` layout | It asks for `1x2` |
| "The first study" of the fixtures was not always the main one | The mock server read the series directories in the order the file system gave them, which has none | It reads them by name |

## Changes to the API

- **Core:** `viewer.setLayout`, `viewer.showMpr`, `viewer.hangingProtocols` (`list`, `match`, `apply`), `viewer.viewports.active` and `setActive`, `viewer.tools.isAvailable`, `viewport.mpr`, the events `viewport:active` and `viewport:mpr`, the commands `layout.set` and `mpr.show`, the tool `crosshairs`, the option `memory: { maxCacheBytes }`, the option `hangingProtocols`, `setViewportSeries(…, { orientation })`, and `setState({ layout })`. `ViewerStateV1.layout` is one of four and `ViewportStateV1` has `orientation`. Exported helpers: `LAYOUTS`, `layoutCells`, `decideMpr`, `describeFallback`, `matchHangingProtocol`, `parseHangingProtocols`, `DEFAULT_HANGING_PROTOCOLS`, `viewStatePatch`, `sameViewState`, `isDicomUid`.
- **Port:** `RenderingPort.renderVolume`, `RenderVolumeOptions`, `VolumeUnsupportedError`. The fake port draws planes too, and `createFakeViewer` takes the new options.
- **Elements:** the default toolbar has a Crosshairs button and a Layout menu. The `viewport-id` of the toolbar and the three panels is unset by default, and then they follow the active viewport (it was `vp-0`). A viewport element has `data-active` when there is more than one.
- **React and Vue:** `state` (with `onStateChange` / `@state-change`).
- **Changed on purpose:** `setState` announces nothing for a patch that changes nothing. The image count, the cine, and the slice limits of a viewport come from the port, not the stack, which is the same number for slices.
- **Data:** two phantom series, `ct-tilted` and `ct-nonuniform`, in a second study; the mock server's series are read in name order.

## Not done, or not proven

- **No 3D, no oblique planes, and no measurements on a plane.** A measurement tool chosen with a plane in focus leaves the left button on window / level. `jumpToSegment` moves the viewport to slices.
- **Volumes are streamed whole.** The whole volume is requested (the 64-slice prefetch of stacks does not apply), and the first picture shows as slices arrive. A very large series is turned away by the budget rather than loaded in parts.
- **The memory estimate is four bytes a voxel.** It is safe for a scaled CT and high for 8-bit data. It is not a measurement of what the browser holds.
- **The state prop follows; it does not enforce.** A page that never echoes `onStateChange` is not put back where it was. Measurements and SEGs are not in it.
- **A SEG over a plane is a second copy** of the labelmap, as a volume, next to the images it came from.
- **Layouts have no keyboard shortcut,** and a drop of a series has no live announcement beyond the viewport's new label.
- **Chromium only,** as before; the budget scenario could not meet 3 s on the machine it was built on.
