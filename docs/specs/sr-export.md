# Spec: write Structured Reports, copy the measurements as text, and a Download menu

Status: proposed (M11). Builds on [ADR 0013](../adr/0013-structured-reports-and-pdf.md) and the [M10 spec](sr-import.md).

## Why

M10 reads a Structured Report (SR) and makes a PDF of the measurements. Two things are missing:

1. **Nothing a person measures here can leave the viewer in a form another system reads.** In practice, measurements end up in two places: as numbers inside the radiologist's report text, and as an SR, annotation, or key image saved in the PACS. A PDF is neither. The SR is the one that other viewers and report systems can use. `exportSr` is the stretch goal that has been in [plan.md](../plan.md) since the start.
2. **A person who wants the numbers in a report has to retype them.** The measurements panel should give a text they can paste.

This spec covers three things:

1. **Write an SR.** `viewer.measurements.exportSr()` makes a DICOM SR (TID 1500 measurement report) of the measurements of the study on screen, in the browser, and a person downloads it.
2. **Copy as text.** `viewer.measurements.exportText()` and a "Copy" button put the measurements on the clipboard as plain text.
3. **A Download menu.** The "Download PDF" button becomes a "Download" menu with a choice of format.

Out (each can be a later spec):
- Sending the SR to a server (STOW-RS). The viewer only reads from servers today, and the `seg-sr-only` capability is about reading. This spec produces a file.
- GSPS and other presentation states.
- Shapes the model has no type for (it has six types, and this spec writes all six).
- A picture of the slice in the PDF.

## Design

### Where the code goes

The architecture rules decide the layout. Only `engine/**` may import `@cornerstonejs/*`, and that includes the SR writer in `@cornerstonejs/adapters`.

```
packages/core/src/
  engine/sr.ts                 new: writeStructuredReport(measurements, instances) -> bytes
  rendering-port.ts            new method: writeReport(measurements, instances) -> Promise<ArrayBuffer>
  measurements/registry.ts     new: exportSr(options), exportText(options), in the queue
  report/text.ts               pure: the report model (measurements/report.ts) -> text
packages/elements/src/
  measurement-list.ts          "Copy" button, "Download" menu
```

The report model that M10 built (`measurements/report.ts`) is the one source of rows, order, and the patient switch. The PDF and the text are two renderers of it, so they cannot disagree, and a test of the model covers both.

### Writing an SR

1. `exportSr()` goes through the queue, like `loadSr`.
2. It collects the measurements of the study on screen and the instances they are on. For each instance the engine needs the metadata the writer asks for (`sopCommonModule`, `instance`, `frameNumber`, and the patient, study, and series modules). The engine registers those the same way it does to read a report: claim the images, write, release in a `finally` (ADR 0005). The matrix checks that the held-image count is the same afterwards.
3. The engine turns each measurement into the shape the writer expects (the reverse of the reader: `measurements/mappers.ts` and `engine/annotation-shape.ts` already hold the pure parts), calls Cornerstone's `MeasurementReport.generateReport`, and writes the dataset to bytes with `dcmjs`. It returns plain bytes. No Cornerstone type reaches the public API.
4. `exportSr()` returns a `Blob` of type `application/dicom`. A new series UID and SOP instance UID are made for each export. The clock is injected, so a test can fix it.

What is written:
- One group for each measurement, in the order of the list. The label is the finding name. The six types are written: length, bidirectional, ellipse, rectangle, probe, and angle.
- The numbers the viewer holds for the measurement (length, area, mean and spread of Hounsfield units, and so on). A number that has not been worked out yet is left out, not written as zero.
- A tracking unique identifier made from the measurement's id, so the same measurement has the same identifier each time.
- A reference to each image the shapes are on, by SOP instance, and the series and study they belong to.

What is not written: measurements on images that are not in the study on screen (there are none: measurements belong to the study), and the pixel data of anything.

### Patient identity in an SR

This one differs from the PDF. A DICOM object has to carry the patient name, ID, and birth date, or a PACS will not file it. The writer copies them from the source images, with the study's own IDs. So an SR file contains who the patient is whatever `showPatientInfo` says. See "Decisions needed". The file is made in the browser and downloaded. Nothing is sent anywhere. The guide says that the file has patient identity in it.

### Copy as text

`exportText(options?)` returns a string made from the report model. The shape of it:

```
Measurement report
Study: CT chest
Made: 2026-11-08 09:14 UTC

Length 1: Length 14.2 mm. CT, Axial 2.5 mm, slice 22 (Drawn)
Aorta: Area 312.4 mm². Mean 41.2 HU. CT, Axial 2.5 mm, slice 30 (Imported)
```

- One line for each measurement: the name, the numbers, the series, the slice (from 1), and where it came from.
- It follows the same rules as the PDF: the patient is left out unless `showPatientInfo` is on, a title is at most 120 characters, and the values are the numbers the panel shows.
- Text is not limited to Latin-1, as a PDF is. A label is written as it is.
- The "Copy" button uses the clipboard API. A browser may refuse it (no secure context, no permission). Then the panel shows the text in a read-only box, selected, with a message, so a person can copy it by hand. It never fails without saying.

### The Download menu

The "Download PDF" button becomes a "Download" menu button with these items:

- **Text (.txt)**: `measurement-report.txt`.
- **PDF (.pdf)**: `measurement-report.pdf`, as now.
- **DICOM SR (.dcm)**: `measurements.dcm`. See "Decisions needed" on whether this is an item or only an API call and a command.

The menu is a panel control, so it follows ADR 0010 and the pattern of the toolbar menus (`aria-haspopup="menu"`, `role="menu"` and `menuitem`, arrow keys, Escape closes and returns focus to the button). It uses only `--dv-*` tokens. The button is disabled (`aria-disabled`) when there are no measurements, as the PDF button is now.

`data-*` attributes and class names that the tests and the matrix use stay as they are (ADR 0010): the PDF item keeps `data-action="download-pdf"`. New ones: `data-action="download-menu"`, `download-text`, `download-sr`, and `copy-text`.

New commands in `viewer.commands`, so a config file can put them on the toolbar as data: `measurements.copyText`, `measurements.downloadText`, and `measurements.downloadSr`. `measurements.downloadPdf` stays.

All new labels, and the two M10 controls that were left in English ("Load report" and "Download PDF"), go into `ViewerMessages` so they can be translated (the message layer from M6.6).

### Public API

```ts
// on MeasurementsApi:
exportSr(options?: SrExportOptions): Promise<Blob>;
exportText(options?: TextOptions): Promise<string>;
```

`SrExportOptions` has a series description and a series number, with defaults (`Measurements`, `60`). `TextOptions` has the same `title` as `PdfOptions`.

## Test plan (tests first)

1. **Pure text** (`report/text.test.ts`): rows and order from the model; the patient switch (serialise and look for the name, as the PDF test does); a long label is kept whole; an empty list.
2. **Engine writer** (`engine/sr.test.ts`): write all six types, read them back with the M10 reader, and compare the points to 0.01 mm (the writer and the reader must agree on the half pixel and on the ellipse axes). Check the header: Comprehensive SR class, TID 1500, the patient and study of the source, new series and SOP UIDs.
3. **Round trip in the viewer** (`viewer-sr-export.test.ts`, fake port): `exportSr` then `loadSr` of the result gives the same measurements; a measurement made from a report is written again; a measurement with no stats is written without them; `exportSr` rejects with no measurements, and after `destroy`.
4. **Another tool reads it.** The headless matrix writes the SR of the phantom measurements to a file and a Python check (`tools/phantom`, `uv run`) reads it with highdicom (`hd.sr.srread`) and checks the content tree: TID 1500, one group for each measurement, the shapes, the numbers, and the references. This is the test that matters most: our own reader agreeing with our own writer proves little.
5. **Panel** (`measurement-list.test.ts`): the menu opens, moves with the arrow keys, closes with Escape and returns focus; each item calls its command; Copy shows the text box when the clipboard refuses; the button is disabled with no measurements; each label comes from the messages.
6. **Matrix**: the `structured report` scenario loads the report, exports the SR, reads it back through `loadSr` on the exported bytes (replacing nothing it should not), copies the text (with the clipboard permission given), and downloads in each format. The held-image count is the same after every call. axe is clean with the menu open.
7. **Visual**: the panel with the menu closed and open, in both themes. Baselines are made as the [guide](../guides/visual-regression.md) says (the *Visual regression* workflow with `update`, or the pinned image), never on a laptop.

## Steps

Each step is one commit, `M11: ...`, with its tests.

0. **Spike (about a day).** Write the six types from `Measurement` objects with Cornerstone's writer, with no Cornerstone annotations on screen, and read the file with highdicom and pydicom. Check the engine chunk against its budget (880 kB brotli). Go or no-go: see below.
1. Text renderer, `exportText`, and the commands.
2. Panel: Copy button, Download menu with Text and PDF, messages for every label.
3. Engine writer and the port method.
4. `exportSr` in the registry, with the queue and the held-image count.
5. SR in the menu (if decided), the matrix step, and the highdicom check.
6. Docs: the measurements guide (a section on writing a report, and the identity warning), an ADR (0014), the README and site text, the plan's M11 row and outcome, `docs/m11-report.md`, a changeset (minor, core and elements), and the size budgets.
7. Release: after the pull request is merged, run the *Release* workflow from the Actions tab (`docs/guides/releasing.md`). The changeset makes it 1.3.0.

### Go or no-go (after step 0)

Go if all of these hold:
- The writer makes all six types from the viewer's measurements, and highdicom reads the file.
- The engine chunk stays within its budget, or the increase is small enough to justify in the pull request.

If highdicom cannot read what Cornerstone's writer makes, the spec changes: we write the content tree ourselves with `dcmjs`, as a pure function (more code, no engine dependency), and say so. Copy as text and the Download menu do not depend on the spike, so steps 1 and 2 go ahead either way.

## Risks

- **The writer needs more than the measurement.** It asks for metadata of each referenced image and for pieces of tool state the viewer does not keep (cached statistics, handle details). The spike finds out how much has to be made up, and where.
- **Another tool may still refuse the file.** Cornerstone's writer is what OHIF uses, so OHIF reads it, but a PACS can be stricter about attributes (a missing equipment or a verifying observer). The check with highdicom is a floor, not proof. Do not claim a PACS accepts the file until one does.
- **Patient identity in a file.** A person may share an SR without knowing it names the patient. The menu item and the guide say so.
- **Duplicates.** Loading a report and then loading the SR that was exported from it gives the same shapes twice, with different ids. The ids are from the SOP instance of each report, so the viewer cannot tell them apart. This is said in the guide. Matching by tracking identifier is a later change.
- **The clipboard.** Browsers differ on when it works. The text box is the fallback, and the matrix tests both.
- **Time.** The estimate is 3 to 4 days for the SR, and 1 day for the text and the menu, after the spike.

## Decisions needed

1. **Is the SR an item in the Download menu?** The request was for two items, Text and PDF. This spec proposes a third, "DICOM SR (.dcm)", because it is the item that matches how measurements move between systems. The alternative is to keep the menu to two items and offer the SR only as `exportSr()` and a command a config can put on the toolbar.
2. **What patient identity does the SR carry?** This spec copies it from the source images, because a PACS will not file an object without it, and says so in the menu and the guide. The alternative is to write it only with `showPatientInfo` on, and otherwise write placeholders (an anonymous SR), which a PACS cannot match to the patient.
3. **Milestone ID.** `M11` is as asked. The plan has an M9 (OncoTrace readiness) that is not built; this does not change that.
