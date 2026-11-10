# Measurements and segmentations

Both are kept by the viewer as plain data, whatever is on screen. The engine only draws a copy for the stacks that are
on screen, and gives it back when a stack goes away. So you can read and change them from code at any time, and they
survive a layout change.

## Measurements

The tools are length, bidirectional, ellipse, rectangle, probe, and angle. Choose one with
`viewer.tools.setActive('length')` (or the toolbar) and draw with the left mouse button.

A measurement is data: a `type`, a `reference` (the instance it is on) and `points` in **patient millimetres**
(DICOM patient coordinates), so it stays correct if the image is zoomed, panned, or shown in another viewport. The
statistics (mean, spread, minimum, maximum in Hounsfield units for the ellipse and the rectangle, and the value of a
probe) are read from the pixels when the image is on screen, and are within 0.5 HU of the truth on the phantom.

```ts
viewer.measurements.list();                       // every measurement, in the order they were made
viewer.measurements.list({ seriesInstanceUID });  // or those on one series (also: studyInstanceUID, sopInstanceUID)

await viewer.measurements.add({
  type: 'probe',
  reference: { studyInstanceUID, seriesInstanceUID, sopInstanceUID },
  points: [[-12.5, 4, 30]],
});

await viewer.measurements.update(id, { label: 'Lesion 1' });  // rename, or move the handles
await viewer.measurements.jumpTo(id);                         // show the image it is on
await viewer.measurements.slices();                         // Map of id -> slice number (from 1, as the overlay counts)
await viewer.measurements.remove(id);
```

Calls that can be wrong reject with a `RangeError` that says what: `add` for an id that is taken or a measurement that is
not valid, `update` and `select` for an id that is not there or points that do not fit. `remove` does not reject for an
id that is not there: it resolves to `false` (and `true` when it removed one). All of them wait for the viewer's queue,
so they come after the calls made before them.

A measurement is drawn only on the slice it is on, as in most viewers. In the measurements panel each row says which
slice that is ("Slice 31"), and **Previous** and **Next** step through the measurements, showing the slice of each and
going round at the ends. `slices()` reads the series and changes nothing; a measurement on a series the source does not
have has no entry. The labels are translatable: `measurementSlice` (with `{slice}`), `previousMeasurement`, and
`nextMeasurement`.

To compare measurements, choose several: click the box on a row, press **X** on the focused row, press Ctrl+A in the list,
or use **Select all**. Choosing is not picking: it does not show an image. **Show selected** then puts them side by side,
one in each viewport on its own slice, in the order of the list (two in a `1x2` layout, three or four in `2x2`; if more
than four are chosen it shows the first four and says so). **Delete selected** removes them. This is the panel's own
choice and is not in the viewer state; to do the same in code, call `viewer.setLayout` and then
`viewer.measurements.jumpTo(id, { viewportId })` for each. The labels are `measurementSelection`, `selectAll`,
`selectedCount`, `showSelected`, `deleteSelected`, and `showingFirstSelected`.

### Saving and restoring

```ts
const document = viewer.measurements.exportJson();   // { format: 'measurements/v1', measurements: [...] }
localStorage.setItem('m', JSON.stringify(document));

await viewer.measurements.importJson(localStorage.getItem('m'), { mode: 'merge' }); // or 'replace'
```

`importJson` accepts the document or its JSON text, checks it with a schema, and is **all or nothing**: a document with
anything wrong in it adds nothing and rejects. A measurement with the same id is replaced under `merge`.

### Events

`measurement:added`, `measurement:updated`, `measurement:removed`, and `measurement:selected` come with an `origin`
(`user` for the mouse, `api` for your calls), so you can tell your own changes from the person's:

```ts
viewer.on('measurement:added', ({ measurement, origin }) => {
  if (origin === 'user') save(measurement);
});
```

### Structured reports

`viewer.measurements.loadSr(seriesInstanceUID)` reads a DICOM Structured Report (a TID 1500 measurement report) of the
study on screen, and keeps its shapes as measurements. Lengths, bidirectional measurements, ellipses, rectangles, probes,
and angles are kept, each on the image the report puts it on. The numbers in the report are not used: the viewer works
them out again from the points and the pixels, so they match the image.

```ts
const { added, replaced, skipped } = await viewer.measurements.loadSr(srSeriesUid);
// skipped: [{ reason: 'The viewer has no place for this kind of shape (CircleROI).', count: 1 }]
```

A report comes from outside, so part of it may be of no use. A shape the viewer cannot keep is counted in `skipped`, with
the reason, and the rest is kept. Measurements from a report have the origin `import`, and an id made from the report and
the place of the shape in it, so loading the same report again replaces them. The call rejects with a `RangeError` for a
series that is not an SR, and with an `Error` for a report that is not TID 1500. The report is read by Cornerstone's
adapters, and shapes are found by the names its tools write, so a report from another tool is read only when it follows
them. The measurements panel has a "Load report" control for this.

### A PDF report

`viewer.measurements.exportPdf()` makes a PDF of the measurements of the study on screen, in the browser: one row for
each, with its numbers, its series and slice, and whether it was drawn, added by code, or imported. It resolves to a
`Blob`, and rejects with a `RangeError` when there is nothing to put in it.

```ts
const pdf = await viewer.measurements.exportPdf({ title: 'Follow-up' });
// or save it with the command the panel's Download menu runs for the PDF:
await viewer.commands.run('measurements.downloadPdf');
```

The report leaves out the name, the ID, and the birth date of the patient unless the viewer is set to show them (the
overlay's `showPatientInfo`). It uses the two standard PDF fonts, so a character outside Latin-1 (such as a Chinese
label) is shown as `?`, and the page says how many. The writer is its own lazy chunk, about 2 kB, loaded when a report is
made. A config file can put the button on the toolbar with the command `measurements.downloadPdf`.

### Copy the measurements as text

`viewer.measurements.exportText()` gives the same report as plain text, one line for each measurement, to paste into a
message or a report. It is made from the same rows as the PDF, so the two say the same, and it follows the same rules:
the patient is left out unless the viewer is set to show who the patient is. Text is not limited to Latin-1, so a label
in any script is written as it is.

```ts
const text = await viewer.measurements.exportText({ title: 'Follow-up' });
// Follow-up
// Study UID: 1.2.3
// Made: 2026-11-08 09:14 UTC
//
// Aorta: Length 14.2 mm. CT, Axial 2.5 mm, slice 22 (Drawn)
```

The panel's **Copy** button puts it on the clipboard. A browser may refuse (a page that is not secure, or no
permission). Then the panel shows the text in a box, selected, with a note, so a person can copy it by hand.

### Write a DICOM Structured Report

`viewer.measurements.exportSr()` writes the measurements of the study on screen as a DICOM Structured Report (a TID 1500
measurement report), in the browser. It resolves to a `Blob` of type `application/dicom`.

```ts
const sr = await viewer.measurements.exportSr({ seriesDescription: 'Follow-up', seriesNumber: 61 });
// or save it with the command the panel's Download menu runs:
await viewer.commands.run('measurements.downloadSr'); // measurements.dcm
```

- **The file is the report only.** It holds the measurements, with a reference to each image by UID. It has no pixel data
  and no copy of the study. The images stay in the study, which the report points at.
- **The file has the patient's identity in it.** A DICOM object has to carry the patient's name, ID, and birth date, or
  a PACS will not file it, so the writer copies them from the images, with the study's own IDs. This is so whatever
  `showPatientInfo` says. The file is made in the browser and nothing is sent anywhere, but a person who shares it
  shares who the patient is. The menu item says so.
- **Each export is a new series**, with a new UID. A measurement has the same tracking identifier every time, made from
  its id.
- **What is written.** One measurement group for each measurement, in the order of the list. Its label is the finding
  (a short code, `LABEL`, with the first 64 characters), and the whole label is also in a Comment, which has no length
  limit. The numbers the viewer holds are written (length, area, angle, and the Hounsfield units of a region or a probe).
  A number the viewer has not worked out is left out, not written as zero. A shape is written beside its number, as the
  standard does, except for a bidirectional measurement, whose two shapes are inside their numbers.
- **Which tools read it.** highdicom reads it and finds each measurement (the browser matrix checks this). The viewer
  reads it again. OHIF, and Cornerstone's own reader, look for the shape inside the number, so they do not put these
  groups on the image. This was not tried in OHIF. No PACS has been tried, and nothing here shows that one accepts the
  file.
- **Loading it again.** A report that was exported and is then loaded gives the same shapes again with new ids (they
  come from the report's SOP instance). If the measurements it was made from are still there, they are there twice. Clear
  them first, or load the report into a clean study.
- **A measurement on a series the data source does not have** cannot be written, as the report must name an image. The
  call rejects and says how many.

`loadSr` takes the UID of a report series in the study. It has no way to read a file a person picks from disk.

### The Download menu, and what a host may offer

The panel's **Download** button is a menu with Text (.txt), PDF (.pdf), and DICOM SR (.dcm). Which items it shows, and
whether the **Copy** button is there, are a choice for the host, so they are config (the `measurements` key, in a config
file or as a code option, and `viewer.config.apply` changes them later):

```json
{
  "version": 1,
  "measurements": { "downloadFormats": ["text", "pdf"], "copyText": true }
}
```

- `downloadFormats` lists the items, in order. The default is `["text", "pdf", "sr"]`. A host that must not hand out
  `.dcm` files leaves `"sr"` out. An empty list hides the menu.
- `copyText` shows or hides the Copy button. The default is `true`.
- A format that is left out is left out of the panel only. `exportSr()`, `exportText()`, and `exportPdf()` are calls a
  host makes itself, and the commands `measurements.downloadSr`, `measurements.downloadText`,
  `measurements.downloadPdf`, and `measurements.copyText` still work, so a host that hides the menu can put a command on
  the toolbar. The config says what the shell shows. The API is the host's code.

All the labels, including those of the report controls, are in `ViewerMessages` and can be translated (`download`,
`downloadText`, `downloadPdf`, `downloadSr`, `copyText`, `copiedText`, `copyFailed`, `copyBoxLabel`, and the report
messages).

## Segmentations (DICOM SEG)

A SEG is loaded against the series it names. It belongs to the study on screen, and goes when the study does.

```ts
const info = await viewer.segmentations.load(segSeriesInstanceUID);
// info.segments: [{ number, label, color, opacity, visible, voxelCount, imageCount, centroid }, ...]

await viewer.segmentations.setVisible(segSeriesInstanceUID, false);        // the whole SEG
await viewer.segmentations.setSegmentVisible(segSeriesInstanceUID, 2, false);
await viewer.segmentations.setSegmentColor(segSeriesInstanceUID, 2, '#ff7a00'); // or [255, 122, 0]
await viewer.segmentations.setSegmentOpacity(segSeriesInstanceUID, 2, 0.4);    // 0 to 1
await viewer.segmentations.setOpacity(segSeriesInstanceUID, 0.6);              // the whole SEG
```

What is drawn for a segment is its opacity times the opacity of the SEG. Visibility, colour, and opacity are the same
in every viewport, including one that is made later (and in a plane of a volume: see the layouts section of the README).

### Highlight and jump

```ts
await viewer.segmentations.highlight(uid, [2], { mode: 'dim-others' }); // or 'outline'
await viewer.segmentations.highlight(uid, undefined);                  // take it away

const where = await viewer.segmentations.jumpToSegment(uid, 2, { strategy: 'largestSlice' });
// strategies: 'largestSlice' (the image with most of the segment), 'centroid', 'nearestTo'
```

`jumpToSegment` shows an image in the series the SEG segments. It rejects for a segment that has no pixels. In an MPR
plane it moves the viewport to slices.

### Navigating from outside

`viewer.navigateTo` takes a SOP instance and, if you like, the SEGs to show and the segments to highlight, in one
call, so a host page can say "show this image with that lesion":

```ts
await viewer.navigateTo({
  seriesInstanceUID,
  sopInstanceUID,
  segmentations: [{ seriesInstanceUID: segUid, visible: true, highlightSegments: [3] }],
});
```

The image loads first and the rest of the series follows outward from it. A SEG that cannot be loaded is reported in
the result's `failedSegmentations` and does not stop the image from showing.

### When a SEG does not fit

A SEG that does not lie on the images it names is still drawn, with a `segmentation:warning` event (the Segments panel
shows the message). A SEG that cannot be read at all, or whose server does not hand out whole instances (see
[data sources](data-sources.md)), rejects from `load`.

Loading is fast enough for large SEGs: a binary SEG of 512 by 512 by 300 pixels with 100 segments decodes in a worker,
in about 2 seconds on a developer machine.
