# M11 report: the SR is written, and the measurements are text

Spec: [specs/sr-export.md](specs/sr-export.md). Decisions: [ADR 0014](adr/0014-sr-export-and-text.md). What the spike found: [m11-spike.md](m11-spike.md).

## Done-when, item by item

| Spec item | Where | Evidence |
|---|---|---|
| `viewer.measurements.exportSr()` writes a TID 1500 SR | [engine/sr-write.ts](../packages/core/src/engine/sr-write.ts), [engine/sr-finish.ts](../packages/core/src/engine/sr-finish.ts), [measurements/registry.ts](../packages/core/src/measurements/registry.ts) | Cornerstone's writer makes the content, a pure step mends it. Unit tests write all six kinds and read them back to 0.01 mm. highdicom reads the file in the matrix. |
| It is the same file for the same measurements | `uidFromText` in `sr-finish.ts` | The tracking identifier of a measurement is a hash of its id. The matrix exports twice and the check compares the identifiers. |
| `exportText()` and a Copy button | [report/text.ts](../packages/core/src/report/text.ts), [measurement-list.ts](../packages/elements/src/measurement-list.ts) | The text is made from the same model as the PDF. When the clipboard refuses, the panel shows the text in a box to copy by hand. |
| The Download button is a menu: Text, PDF, DICOM SR | `measurement-list.ts` | Keyboard and ARIA as the toolbar menus. axe is clean with the menu open. |
| A `measurements` config key says what the panel offers | [config](../packages/core/src/config), `viewer-config.schema.json` | The default is everything. An empty list hides the menu. A format left out is left out of the panel only. |
| A measurement on a frame of a multi-frame image is written with its frame | `engine/sr-write.ts`, `measurements/registry.ts`, `tools/phantom/check_sr_export.py` | Added when M12 was merged in. Unit tests write two frames of one instance and read them back on their frames. |
| The report controls are messages | [messages.ts](../packages/core/src/messages.ts) | "Load report", "Download", and the new labels are `ViewerMessages` keys. |

## Verification

- `pnpm check` parts, run on the merge of M12 and M11: build, typecheck, ESLint, Biome, and `pnpm test` (1,881 tests, all pass).
- `pnpm size`, `pnpm docs:api` and `pnpm package-check` pass.
- Phantom: `uv run pytest` (58 tests) passes.
- The browser matrix: see "Matrix" below.

### Size

| Budget | Size | Limit |
|---|---|---|
| core: viewer chunk | 27.51 kB | 28 kB (was 27) |
| core: engine chunk (lazy) | 804.06 kB | 880 kB |
| core: PDF chunk (lazy) | 2.01 kB | 2 kB (unchanged) |
| elements: viewer element chunk | 28.64 kB | 29 kB (was 27) |
| core/testing | 4.02 kB | 4.5 kB (was 4) |

The writer is in the engine chunk already, through the reader, so the engine chunk grew by the mending step only. Three limits were raised, and the pull request says why: the viewer chunk and the panel carry the text renderer, the menu, the selection controls and the new messages, and `core/testing` carries the fake writer and the multi-frame fakes of M12.

## What running it found

- **The writer's own file is not valid DICOM.** A code of 19 characters in a field of 16, a meaning that is cut at 64, a random tracking identifier, a missing character set, a placeholder number for a probe, no minimum for a rectangle, two evidence entries for one study. Each is mended in `sr-finish.ts` and has a test. See [m11-spike.md](m11-spike.md).
- **dcmjs reads UTF-8 as Windows-1252.** A label such as `é` came back as `Ã©`, and one in Chinese was lost. The reader now repairs the text in place. This also mends M10.
- **The browser found two things the unit tests did not.** A rectangle had no minimum, and the Download menu did not close with Escape when it had been opened with the mouse.
- **A manual pass on the demo found several things in the panel** and they are fixed: the select was squeezed to one letter, the reload icon was clipped, the Download menu was clipped by the panel, a long report name pushed the controls out, and the choice of several measurements needed a way back to one viewport (a **Single view** button) and clearer names (**Show selected**).
- **Merging M12 changed one thing for the writer.** M12 makes each frame an image of its own, so the writer is given the frame a measurement is on, and the evidence lists an instance once with no frame (several frames of one instance are one entry).

## Matrix

On the merge of M12 and M11, in Chromium: `pnpm matrix --only headless` passes 40 of 40 scenarios (both asset modes, including `structured report`, where highdicom reads the exported file, and every multi-frame scenario of M12), and `pnpm matrix --only vanilla` passes 6 of 6. The full matrix with React, Vue, and the other frameworks was not run for M11, and the visual baselines were not made (the *Visual regression* workflow makes them).

## Changes to the API

- **Core:** `viewer.measurements.exportSr` and `exportText`, the commands `measurements.copyText`, `measurements.downloadText`, and `measurements.downloadSr`, the config key `measurements`, and the types `SrExportOptions`, `TextOptions`, `MeasurementsConfig`, and `DownloadFormat`, with the constant `DOWNLOAD_FORMATS`.
- **Messages:** new keys for the report controls. `showTogether` of 1.3.0 is now `showSelected`; `singleView` is new.
- **Elements:** the Copy button, the Download menu, the Single view button, and the picture button for reloading a report.

## Not done, or not proven

- **No PACS has accepted the file.** highdicom reads it, and the viewer reads it again, and that is all that is shown.
- **OHIF, 3D Slicer, and other viewers were not tried.** By decision, OHIF will not draw these groups on the image and shows no label.
- **`dciodvfy` (dicom3tools) was not run.** It checks a file against the standard in full.
- **A report on a real Enhanced CT, MR, or PT was not written and read in another tool.** The multi-frame case is tested on a synthetic image.
- **An exported report that is loaded again makes its measurements twice**, with new ids. Matching by tracking identifier is a later change.
- **An angle is written with Cornerstone's code "Cobb angle".**
- **There is no way to open a `.dcm` from disk as a report.** `loadSr` takes the UID of a series of the study.
- **Safari and Firefox were not tried.** The matrix runs Chromium. The visual baselines for the new panel controls come from the *Visual regression* workflow, not from a laptop.
