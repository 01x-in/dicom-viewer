# ADR 0012: Layouts, planes of a volume, and the memory they need

Status: accepted (M7). Builds on [ADR 0004](0004-viewer-state-and-ordering.md) (every change goes through one queue), [ADR 0005](0005-engine-runtime-lifecycle.md) (what the engine takes it gives back), [ADR 0006](0006-view-state-and-input.md) (the state records the view), [ADR 0009](0009-segmentations.md) (SEGs), and [ADR 0011](0011-config-layer.md) (commands).

## Context

Until M7 the viewer had one viewport, `vp-0`, and drew a series only as the slices it was acquired in. The plan asks for four layouts, series dragged into viewports, hanging protocols, reformatted planes (MPR) with crosshairs, a shared window, and SEGs over the planes. Two things make this more than more of the same:

- **A plane is not a stack.** Cornerstone draws a plane from a volume: one array made from every slice, which can take hundreds of megabytes and has to be streamed in. A series that is tilted, unevenly spaced, or too large cannot become one.
- **Several viewports share things.** The planes of one volume share the volume, a window, and (for crosshairs) a tool group; a SEG must be drawn over each; and which viewport the toolbar acts on has to be decided.

## Decision

- **Layouts are data.** `1x1`, `1x2` (one row of two), `2x2`, and `1+3` (one large viewport and three small) are a table in the core (`layouts.ts`): for each, the columns and rows of a grid and where each viewport goes. Viewport ids are stable: `vp-0` to `vp-3`, and `vp-0` is in every layout. `ViewerStateV1.layout` is one of the four, and `viewports` holds exactly the ids the layout shows. A link that leaves some out gets them empty; one that names a viewport the layout does not have is refused. `viewer.setLayout` runs in the queue: viewports the new layout keeps stay as they are, new ones start empty, and the others stop drawing and leave the state (going back shows them empty).
- **One viewport is active.** The toolbar, the commands, and the panels act on `viewer.viewports.active` (`vp-0` at the start, then the last viewport the person pressed or focused), unless a page names one. It is not in the state, because a link should not carry it. The shell marks it only when there is more than one viewport.
- **A series is dragged by a custom data type.** A row of the series browser carries the series and its study as `application/x-dv-series`, and nothing else. A viewport cell accepts only that type, shows where it would land, and on a drop from the same study sets the viewport's series. A payload from anywhere else is validated and ignored. Choosing a row with the keyboard fills the active viewport, so there is no mouse-only route.
- **Hanging protocols are data and a pure function.** A protocol is a layout and a rule for each viewport (modality, part of the description, a smallest size, the first or the largest). `matchHangingProtocol` scores them: more viewports filled wins, then more rules met, a blank viewport counts against it, and a `priority` outranks all of that. Applying one opens every series first, so a series with no pictures is skipped for the next that fits, and the layout and the series are set together. The shell applies the best fit when the host gave protocols and nothing was asked for or restored. None are applied by default, and `DEFAULT_HANGING_PROTOCOLS` is a start.
- **A viewport asks for a plane; it may get slices.** `ViewportStateV1.orientation` is `axial`, `sagittal`, or `coronal`. The viewer decides in `decideMpr` (pure): the stack must be reconstructable (the data layer already says why not: missing geometry, too few slices, no pixel spacing, mixed sizes, tilted, non-uniform spacing), and its volume (rows × columns × slices × 4 bytes, since a scaled CT volume is held as floats) must fit in `memory.maxCacheBytes` (1 GiB, or 512 MiB on a device that reports 4 GiB or less) after the volumes already held. Planes of one stack count once. If the answer is no, or the engine cannot draw a volume (`VolumeUnsupportedError`), the viewport shows the slices, `viewport.mpr` says why in one of eight reasons, and a `viewport:mpr` event tells the shell, which writes the reason in the viewport. The state keeps what was asked, so a link made there asks again where it can be done, and asking again retries.
- **The engine draws a plane as a `StackPort`.** `RenderingPort.renderVolume` returns the same interface as a stack, with `imageCount` the number of slices in the plane. Nothing above the port changed for scrolling, windows, zoom, cine, the overlay, or the keys. Pixels (`sampleHu`, `readSlice`) and shapes belong to stacks: a plane rejects the first and ignores the second, and a measurement tool chosen while a plane has the focus leaves the left button on window / level.
- **Planes of one volume share a tool group, a window, and crosshairs.** The engine makes one Cornerstone tool group for each volume, so `CrosshairsTool` links its planes. The core copies the window and the inversion between the planes of a volume (a person's drag stays a user change); it does not copy the zoom or the slice, and it does not link two viewports that merely show the same series. `crosshairs` is a tool the left button can drive; `viewer.tools.isAvailable('crosshairs')` is true only while two planes of one volume are on screen, and the toolbar button says so.
- **A SEG over a plane is a copy in a volume.** Cornerstone draws a labelmap on a plane only as a volume. The engine copies the labelmap images of each layer into a volume of the same shape as the base volume (slice by slice, since the volume orders its images along the slice normal) and registers it as a segmentation of its own, with a second for outlines. The copies are counted by plane and given back with the last plane that drew them or with the SEG. The viewer attaches SEGs to planes as it does to stacks, so visibility, colour, opacity, and highlight follow without a second path.
- **The state prop.** React and Vue get a controlled `state`: the layout and every viewport (series, plane, slice, window, zoom). It is shown when the viewer starts and whenever the page gives another; what it leaves out of a viewport is cleared; a state that is the one the viewer is in changes nothing, and `setState` announces nothing for a patch that changes nothing, so a page that keeps what `onStateChange` tells it does not set off a round of changes. The study is not part of it, nor are measurements and SEGs (ADRs 0008 and 0009 keep them out of the state).
- **Left out:** 3D rendering and oblique planes; measurements on a plane; jumping to a segment in a plane (it moves the viewport to slices); a layout of more than four viewports; per-series synchronised scrolling; and a WebGL context for each viewport (the pool stays at one context).

## How it is built

1. The layout table, the state, `setLayout`, and the grid in the shell.
2. The active viewport, the `layout.set` command, and the Layout menu.
3. Drag and drop.
4. Hanging protocols.
5. The plane in the state, `decideMpr`, the port, the fake, and the viewer; then the engine.
6. Crosshairs, the shared window, the SEG over a plane, `viewer.showMpr` and its command.
7. Two phantom series that cannot be reformatted, and the matrix scenarios.
8. The controlled `state` prop.

## Done when

- All four layouts draw, and a series can be put in any viewport by the mouse and by the keyboard.
- A protocol that fits a study hangs it; one that does not changes nothing.
- The axial, sagittal, and coronal planes of the phantom have the right shape (anisotropic voxels), the right content, and scroll; the window is shared; a click with the crosshairs moves the other planes to that point; a SEG tints the body and the bone insert in every plane.
- The tilted and the unevenly spaced phantom, a volume over the budget, and an engine without WebGL show slices and say why.
- 20 cycles of a viewer with three planes and a SEG leave nothing behind: no volume, no image, no WebGL context.

## As built

- **Found by running it, not by reading the Cornerstone code:**
  - The images of a volume share its buffer, so Cornerstone refuses to drop one of them from the cache before the volume is gone. The engine removes the volume first and skips its images afterwards.
  - Cornerstone adds a listener to its global event target for each image a volume asks for, and removes it when that image is cached. An image that was cancelled never is. A volume given up before it has loaded (every cycle of the leak test) left one listener per image, each holding the volume and, through it, the page's WebGL context. The engine now says that every image arrived, once, while the volume is still there. Without it every viewer left a WebGL context behind.
  - The matrix's WebGL counter counted a context each time the page asked for it, and a volume asks on every render. It counts each context once.
  - `readdir` has no order, and "the first study" is the main one for every consumer. The mock server reads the series directories by name now, since there are two studies.
- The crosshairs are driven by clicking: a click on a reference line grabs it, so the matrix clicks away from the lines.
- `setState` with a patch that changes nothing no longer announces a change.
- A viewport that fell back to slices tries for the plane again when it is asked again.

## Evidence

See [m7-report.md](../m7-report.md).
