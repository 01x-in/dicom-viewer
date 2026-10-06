# ADR 0008: Measurements are data in the core, and the engine draws a copy of them

Status: accepted (M5). Builds on [ADR 0004](0004-viewer-state-and-ordering.md) (one queue for every engine call) and [ADR 0005](0005-engine-runtime-lifecycle.md) (give back what the engine took).

## Context

M5 adds six measurement tools (length, bidirectional, ellipse, rectangle, probe, angle), a list to rename, delete, and jump, and JSON export and import. Cornerstone already draws these shapes and keeps them as annotations, in one store for the whole page, tied to a frame of reference. Using that store as the home of the measurements would tie the public API to Cornerstone, lose the measurements when a stack is torn down (the leak rule says the stack must give its annotations back), and make import and export a matter of Cornerstone's internal shape.

## Decision

- **A measurement is plain data the viewer owns.** `viewer.measurements` has `list`, `get`, `add`, `update`, `remove`, `clear`, `select`, `getSelected`, `jumpTo`, `exportJson`, and `importJson`, and the events `measurement:added`, `:updated`, `:removed`, and `:selected` (the first three say who made the change: `user`, `api`, or `import`). The viewer keeps the measurements whatever is on screen. [registry.ts](../../packages/core/src/measurements/registry.ts) is the one place that changes them.
- **The engine draws a copy.** When a stack comes on screen, the viewer gives its port the measurements whose instances the stack has (`addMeasurement`); when it goes, the port removes them from Cornerstone's store along with the viewport. What the person does comes back as `MeasurementChange` events (`completed`, `modified`, `removed`, `selected`), and what the viewer itself asks for is not reported back. Cornerstone's annotation count is part of `getEngineDiagnostics()`, so the 20-cycle leak check, which now adds a measurement each cycle, fails if one is left.
- **Coordinates are patient space.** The model (`measurements/v1`, Zod) holds each shape's handles in millimetres in DICOM's LPS axes, in the order Cornerstone keeps them (an ellipse: the ends of the vertical axis, then of the horizontal one; a rectangle: a corner, the corner along the width, the corner along the height, the opposite one; a bidirectional measurement: the first axis, then the second; an angle: arm, vertex, arm), plus a reference to the study, series, SOP instance, and frame of reference it was made on. UIDs are checked like every UID that comes from outside.
- **The conversions are pure functions, tested in both directions.** [mappers.ts](../../packages/core/src/measurements/mappers.ts) turns a measurement into the shape the engine is given and a shape the person drew into a measurement. [annotation-shape.ts](../../packages/core/src/engine/annotation-shape.ts) turns a Cornerstone annotation into that shape and a shape into what the tool's `hydrate` is given. It imports no Cornerstone code (only types), so the unit tests cover all six kinds there and back without an engine.
- **The numbers are worked out here, not read from Cornerstone's text.** Lengths, areas, and angles come from the handles ([geometry.ts](../../packages/core/src/measurements/geometry.ts), with the formulas Cornerstone uses). Hounsfield statistics come from the pixels: the port decodes a slice (`readSlice`) and [stats.ts](../../packages/core/src/measurements/stats.ts) takes the pixels whose centre is inside the shape (edges included), with the population standard deviation. A probe reads the pixel the point is in. This keeps the statistics testable without an engine, the same for an imported shape as for a drawn one, and independent of Cornerstone's versions. The cost is that the text Cornerstone draws on the image is its own number, which can differ in the last pixels at an edge; the two are not compared.
- **Reading pixels goes through the queue.** Every call that changes a measurement, and every read of pixels for it, is enqueued like any other engine call ([ADR 0004](0004-viewer-state-and-ordering.md)), so a measurement added right after a series switch is drawn on the new series. What the person does with the mouse is not queued, like the other reports of input. A drag moves a handle many times a second, so the pixels are read again 150 ms after the last move, and the numbers shown in between are cleared rather than left stale.
- **Measurements are not part of `ViewerStateV1`.** The state is what a link restores, and a list of measurements is long, private to a case, and not what a link should carry. They travel by the API, the events, and the JSON document. The controlled `state` prop that M4 deferred stays with layouts and segmentations (M7).
- **The six tools are left-button tools.** `PRIMARY_TOOLS` has ten entries, each marked `view` or `measure`. A measurement tool that is not chosen stays passive, so its handles still answer to the mouse while window / level or pan is active, and pressing on a handle picks the measurement.
- **The document is `measurements/v1`.** `exportJson()` returns plain data: `{ format, measurements }`, each measurement with a `values` object of the numbers worked out for it. `importJson` takes the document or its text, checks all of it, and adds nothing if anything is wrong. Ids must be unique; `merge` (the default) replaces a measurement that has the same id, and `replace` starts empty. `values` is dropped on import and worked out again.
- **The shell.** The default toolbar has a Measure menu (the chosen tool is shown on its button), and the shell registers a built-in `measurements` panel on the right: `<dv-measurement-list>`, a listbox of the study's measurements. Enter or a click shows the image and picks the measurement; F2, a double click, or Rename names it; the Delete key or Delete removes it; arrows move the one tab stop. Rename and Delete act on the row that has the focus. `hide-measurements-panel` removes it; React and Vue have `hideMeasurementsPanel` and `useMeasurements`.
- **Keys.** Delete and Backspace remove the picked measurement, and are left alone when none is picked.

## Evidence

The `measurements` scenario of `pnpm matrix --only headless` runs against the real engine and the phantom, whose pixels are known exactly, in both asset modes:

- an ellipse of radius 5 pixels on each of the four inserts and on the body has the insert's value as mean, minimum, and maximum within 0.5 HU, and a standard deviation within 0.5 HU of zero; a probe on each gives its value;
- a 5 by 5 rectangle in the bone insert covers 25 pixels with mean 1000;
- an ellipse across the edge of the bone insert and the body gives the same count, mean, spread, minimum, and maximum (within 0.5 HU) as a count made in the page from single `sampleHu` calls;
- a length, a right angle, and an ellipse area come out at the millimetres and degrees their handles give;
- the JSON survives text and an empty viewer, byte for byte;
- Cornerstone holds the shapes only while their series is on screen, and none after `clear()`;
- a line and an ellipse drawn with the real mouse land where the screen says they are (the ellipse's edges within one pixel of where the drag put them, its mean 40 HU in plain body), and the window does not change; dragging the ellipse's handle changes what it covers, both with the ellipse tool and with window / level active, and pressing on a handle picks the measurement.

The `shell` scenario then walks the same flow in every framework example: the Measure menu from the keyboard, a line drawn through the slot, the list, rename, leaving and coming back from the list, and delete, with axe run with the menu open, with a measurement listed, and with the rename field open.

## Consequences

- **One stack per series on screen.** Two viewports of one series (M7) would share Cornerstone's annotations by image id, and one of them closing would remove the other's. M7 has to count users the way the engine counts image users.
- **Measurements of other studies are kept but not listed.** The panel shows the study on screen; `list()` and `exportJson()` have all of them.
- **Units.** The lines say millimetres and `HU`. For a modality that is not CT, the number is the stored value after rescale, and the unit is wrong.
- **Images without position and orientation** (a plain radiograph) can be measured by Cornerstone's own scale, but their pixels are not read: no statistics.
- **ROI shapes are axis-aligned in the image**, which is all a stack viewport draws. Statistics for a shape on a rotated or reformatted view are M7's.
- **No undo, no Escape to cancel a shape being drawn, no styling of the shapes' colours, no SR export** (the plan's stretch goal).
