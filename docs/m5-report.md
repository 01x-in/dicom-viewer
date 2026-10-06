# M5 report: measurements

**Done by the plan's criteria**, with the limits listed at the end. The repository has 768 tests (585 at the end of M4, after its review fixes). The full matrix passes: vanilla, headless (every scenario, including the new `measurements`), Vite React, Vite Vue, Next with Turbopack and with webpack, and Nuxt, each in `inline` and `url` mode, and each with the extended `shell` scenario.

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| All 6 tools | [engine/tools.ts](../packages/core/src/engine/tools.ts), [engine/measurements.ts](../packages/core/src/engine/measurements.ts), [tools.ts](../packages/core/src/tools.ts) | Length, bidirectional, ellipse, rectangle, probe, and angle are left-button tools beside window / level, pan, zoom, and scroll (`viewer.tools.setActive`, the Measure menu, or a key binding of the host's). The scenario draws a length and an ellipse with the real mouse and checks where they land in patient millimetres |
| A list panel to rename, delete, and jump | [measurement-list.ts](../packages/elements/src/measurement-list.ts), the `measurements` panel of [viewer-element.ts](../packages/elements/src/viewer-element.ts) | A listbox of the study's measurements: Enter or a click shows the image and picks it, F2 or a double click names it, Delete removes it, one tab stop with arrows. The `shell` scenario does all of it by keyboard in every framework example, with axe run with the Measure menu open, a measurement listed, and the rename field open |
| Mappers tested in both directions | [mappers.ts](../packages/core/src/measurements/mappers.ts), [annotation-shape.ts](../packages/core/src/engine/annotation-shape.ts) | Pure functions between a measurement, the engine's shape, and a Cornerstone annotation. The unit tests take all six kinds from a measurement to a hydrated annotation and back, and refuse a wrong number of handles, a handle that is not finite, a tool that is not ours, an image that is not in the stack, an angle with two points, and a reference that is not UIDs |
| HU stats within ±0.5 HU on the phantom | [stats.ts](../packages/core/src/measurements/stats.ts), `readSlice` on the port | An ellipse of radius 5 on each of the four inserts and on the body: mean, minimum, and maximum within 0.5 HU of the insert's value and a spread within 0.5 HU of zero (they are exact), 60 pixels or more; a probe on each; a 5 by 5 rectangle in the bone insert covers 25 pixels with mean 1000. An ellipse across the edge of the bone insert and the body gives the same count, mean, spread, minimum, and maximum as a count made in the page from single `sampleHu` calls |
| JSON round-trip | [model.ts](../packages/core/src/measurements/model.ts), [registry.ts](../packages/core/src/measurements/registry.ts) | `measurements/v1`, Zod. In the real engine, 14 measurements are exported, written to text, cleared, imported into the same viewer, and exported again: the two texts are identical. Unit tests cover merge and replace, an invalid document adding nothing, and the numbers being worked out again |

## What the real engine and the tests found

| Problem | Cause | Fix |
|---|---|---|
| The list's Rename and Delete buttons acted on the wrong row when pressed right after a change of focus | The click handlers captured "the current row" when the list was last drawn | They read it when clicked, and the rename field belongs to the row being renamed, not the one that has the focus (found by a unit test) |
| A first reading of the mouse test said the drawn ellipse had a mean of −16 HU | The scenario's geometry was wrong, not the viewer: the example lays the viewport out 308 px wide, so a pixel is 2.4 screen pixels, and the ellipse tool centres on the press and takes the drag as its radius, so the drawn shape ran across two inserts | The scenario takes the scale from the viewport and draws in plain body. The viewer's −16 HU was right for that shape |
| `next-webpack (url: shell)` timed out in `page.goto` once in a full run | The Next server did not answer for 180 s | Not reproduced: the variant passes in full when run again. Recorded here because it was seen |

The measurement engine code (hydrating shapes, reading them back, selecting, the quiet flag, the cleanup on destroy) worked in Chromium the first time it was run; the failures above were in a test and in the scenario.

## Decisions

- [ADR 0008](adr/0008-measurements.md): measurements are plain data in the core and the engine draws a copy; coordinates are patient millimetres with a reference to the instance; the numbers are worked out in the core from the handles and from decoded pixels, through the queue; they are not in `ViewerStateV1`; the conversions are pure functions.
- The statistics are the core's, not Cornerstone's: a pixel is inside when its centre is, edges included, and the spread is the population standard deviation.
- The Delete and Backspace keys remove the picked measurement, and are left alone when none is picked.

## Changes to the API

- **Core:** `viewer.measurements` (`list`, `get`, `add`, `update`, `remove`, `clear`, `select`, `getSelected`, `jumpTo`, `exportJson`, `importJson`); the events `measurement:added`, `:updated`, `:removed`, `:selected`; the error context `measurement`; `PrimaryTool` has six more ids and `ToolInfo` a `kind`; the key action `delete-measurement`; `StackPort.readSlice`, `addMeasurement`, `updateMeasurement`, `removeMeasurement`, `selectMeasurement`, `onMeasurementChange`; `EngineDiagnostics.annotations`; and the helpers `measurementLines`, `measurementTitle`, `measurementValues`, `parseMeasurementsDocument`.
- **Testing:** the fake engine draws and reports shapes (`emitMeasurement`, `measurements`, `measurementCalls`, `slicesRead`, `sliceOf`), and the fake instances have position, orientation, spacing, and a frame of reference.
- **Elements:** `<dv-measurement-list>`, the Measure menu in `DEFAULT_TOOLBAR` (`TOOLBAR_ACTIONS.measure`), menu entries with a chosen state (`role="menuitemradio"`), and `hide-measurements-panel`.
- **React and Vue:** `hideMeasurementsPanel` and `useMeasurements`. The built-in panel is the first tab of the right-hand dock, so a host's own right-hand panels come after it unless it is hidden.

## Not done, or not proven

- **One stack per series.** Two viewports of one series (M7) would share Cornerstone's annotations; one closing would remove the other's.
- **The on-image text is Cornerstone's own** and is not compared with the core's numbers.
- **Units are `mm` and `HU` whatever the modality**, and an image without position and orientation is measured by Cornerstone's own scale with no statistics.
- **Statistics are for axis-aligned shapes in a stack viewport**; volume and reformatted views are M7.
- **The Delete key with a measurement picked on the image is only unit tested.** Picking one by pressing on its handle is covered in the real engine, and the Delete key in the list is covered in every framework example.
- **No undo, no Escape to cancel a shape in progress, no colour or line settings, no SR export** (the plan's stretch goal), no touch input.
- **The list has no sorting, filtering, or export button**; a host calls `exportJson`.
- **Chromium only**, as before. Safari and Firefox, React 18, the package name, and open question 5 (the default keys against OHIF) are still open.
