# M10 report: Structured Reports and the PDF report

**Done by the spec's criteria**, with the limits listed at the end. M10 was not in the first plan: it is the SR stretch goal, widened to a PDF of the measurements. The spec is [specs/sr-import.md](specs/sr-import.md) and the decisions are in [ADR 0013](adr/0013-structured-reports-and-pdf.md), which is accepted.

## Done-when, item by item

| Spec item | Where | Evidence |
|---|---|---|
| Load measurements from an SR | [engine/sr.ts](../packages/core/src/engine/sr.ts), [measurements/sr.ts](../packages/core/src/measurements/sr.ts), [measurements/registry.ts](../packages/core/src/measurements/registry.ts) | `viewer.measurements.loadSr(seriesInstanceUID)` reads a TID 1500 report and keeps its lengths, bidirectional measurements, ellipses, rectangles, probes, and angles as measurements with the origin `import`. It goes through the queue. A shape it cannot keep is counted in `skipped`, with the reason. Ids are `sr:<SR SOP UID>:<position>`, so loading again replaces and does not add |
| Numbers match the image | [measurements/sr.ts](../packages/core/src/measurements/sr.ts) | The numbers stored in the report are not shown. Length, angle, area, and HU statistics are worked out again from the points and the pixels. The matrix checks a highdicom report against the phantom: length 27 mm, angle 90°, probe 0 HU, ellipse 1000 HU, rectangle −100 HU, and both areas, all within 0.05 |
| A report from a tool other than Cornerstone | [fixtures/phantom/sr-measurements](../fixtures/phantom/README.md), [phantom.py](../tools/phantom/phantom.py) | Written by highdicom, six groups on four slices, with the shape beside the number as the standard's template has it. The engine lifts it into the number for the reader. Reports written by Cornerstone's writer (all six types) round-trip to 0.01 mm in a unit test |
| Left out is counted | [measurements/registry.ts](../packages/core/src/measurements/registry.ts) | Five reasons: an image not in the study (this includes a series the server does not have), a shape the model rejects, a group the reader could not read, a kind of shape with no place (named), and an id that another measurement holds. A report never replaces a measurement a person, the host, or `importJson` made |
| The engine gives back what it took | [engine/index.ts](../packages/core/src/engine/index.ts) | Images are claimed while the report is read and released in a `finally`. The `structured report` scenario checks that the held-image count is the same after two loads as before |
| A PDF of the measurements | [report/pdf.ts](../packages/core/src/report/pdf.ts), [measurements/report.ts](../packages/core/src/measurements/report.ts) | `viewer.measurements.exportPdf()` returns a `Blob`. A4 pages, Helvetica and Helvetica-Bold, a table of name, type, value, series, slice, and source, a footer on every page. The report is built as plain data first, so rows and order are tested as data. poppler (`pdftotext`, `pdftoppm`) read a 45-row, five-page sample |
| Patient identity off by default | [measurements/report.ts](../packages/core/src/measurements/report.ts) | The name, the ID, and the birth date are in the report model only with `showPatientInfo`. A test serialises the model and looks for them. The matrix checks the PDF does not say "Patient" |
| A control in the panel, and a command | [measurement-list.ts](../packages/elements/src/measurement-list.ts), [commands.ts](../packages/core/src/commands.ts) | A "Load report" select (absent with no SR series) that says what was added and left out, and a "Download PDF" button (`aria-disabled` with no measurements). The command `measurements.downloadPdf` is data a config file can put on the toolbar. axe is clean in the vanilla shell scenario |
| Tests, docs, changeset | [.changeset/sr-import-and-pdf.md](../.changeset/sr-import-and-pdf.md), [guide](guides/measurements-and-segmentations.md) | Minor bump of core and elements. The guide has "Structured reports" and "A PDF report". README and the site text say what the viewer reads |

## Verification

- `pnpm check`: build, format, lint, typecheck, and 1,631 unit tests (1,501 at the end of M8) pass. The phantom's Python tests are 33 (28 at M7).
- `pnpm size`: the engine chunk is 801.7 kB brotli against 880 kB (800 kB at M8). The viewer chunk is 24.1 kB against 26 kB. The PDF writer is its own lazy chunk, 2.0 kB against a 3 kB budget.
- `pnpm matrix` (all variants, `inline` and `url`): 66 rows, all pass. That includes vanilla, headless, vite-react, vite-vue, next-turbopack, next-webpack, and nuxt, with the shell scenario (and its axe check) in every framework. The headless variant has a new scenario, `structured report`, in both asset modes.

## What running it found

| Problem | Cause | Fix |
|---|---|---|
| A highdicom report loaded nothing, and the log had one line | Cornerstone's reader looks for the shape inside the numeric item. The standard puts it beside the number | The engine moves a single shape beside a number into it. A group with more than one is counted as unreadable, as the reader cannot tell which number a shape belongs to |
| A group the reader failed on was silently missing | The reader catches an error per group and goes on | The engine reads one group at a time. A group that gives nothing back is counted, and each shape knows its position |
| Shapes were half a pixel off | Report pixel coordinates start at the pixel corner, and the reader's do not | The fixture writes `+0.5`, and the reader subtracts it |
| An ellipse had its width and height swapped | The writer puts the longer axis first, and the model wants the vertical one | The engine orders the axes by the direction of the image's rows |
| The matrix said `n.then is not a function` | `addDicomWebInstance` does not always return a promise | The registration is wrapped in `Promise.resolve` |
| Two loads at once could read an image before its metadata was in | Registration was fire and forget | A map of registrations in flight, and `ensureRegistered` waits for it |
| A fixture's means were 799.6 and −58.1 HU, not 1000 and −100 | The shapes spilled over the edge of the inserts | They were moved inside |
| A replaced viewer or study could receive an answer to an older load | The panel did not forget a request when the viewer changed | A request counter, cleared on viewer change and study change |

## Changes to the API

- **Core:** `viewer.measurements.loadSr`, `viewer.measurements.exportPdf`, the command `measurements.downloadPdf`, the types `SrLoadResult`, `SrSkip`, and `PdfOptions`, and `measurementName` (moved from elements). `MAX_REPORT_TITLE_LENGTH` is 120.
- **Port:** `RenderingPort.readReportReferences` and `RenderingPort.readReport`. The fake port has `reportReads`, `reportReferences`, `reportResult`, and `failNextReportRead`.
- **Elements:** the measurements panel has `data-action="load-report"` and `data-action="download-pdf"`, and a `data-report-status` block. `measurementName` is still exported.
- **Data:** one phantom series, `sr-measurements` (series number 50), written by highdicom. `dicomweb-mock` serves a file with no pixel data as an instance with no frames.
- **Dependencies:** `dcmjs` 0.52.0, exact-pinned, as a dev dependency of core. It is bundled into the engine chunk, where it already was through the adapters.

## Not done, or not proven

- **Only two writers are tried:** Cornerstone's and highdicom. No vendor report (a PACS, a vendor workstation) has been read. Reports that use a different template are refused with "not a TID 1500 measurement report".
- **No SR is written.** `exportSr` is still the plan's stretch goal. GSPS is not read.
- **Shapes the model has no type for are counted, not kept:** circles, arrows, free-hand outlines, Cobb angle. The fixture has a circle, to keep that honest.
- **The PDF has Latin-1 text only.** Other characters are drawn as `?`, and the page says how many. It has no picture of the slice.
- **A report refers to images by SOP instance.** A shape on an image that is not in the study is counted as left out; a multi-frame image is read as frame 1.
- **`pnpm visual` was not run.** Its baselines must be made in the pinned Playwright image, and the panel has two new controls, so they will need making again (a decision for the maintainer).
- **Safari and Firefox** are still untried, as at M8.
