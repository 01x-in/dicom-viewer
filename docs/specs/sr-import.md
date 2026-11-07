# Spec: read Structured Reports (TID 1500), and download a PDF report

Status: draft. Nothing is built. Milestone ID for commits: `M10` (proposed; v1 shipped at M8).

## Why

A person asked whether the viewer supports GSPS or Structured Reports. It supports neither. Today a series with modality `SR` is listed, then skipped when the viewer picks something to draw (`NON_IMAGE_MODALITIES` in `packages/core/src/data/series.ts`). The data source can already fetch an SR instance whole (`getInstanceBytes(..., 'SR')`, allowed by the default `seg-sr-only` capability). Nothing reads it.

This spec covers two things:

1. **Load measurements from an SR.** Read-only. The measurements land in the same list and on the same images as measurements a person draws.
2. **Download a PDF report** of the measurements on screen, from a button in the measurements panel. (The request said "download pdf button". This spec reads it as a report of the measurements. If it meant something else, see "Decisions needed".)

GSPS is not in this spec. It needs a reader we would write ourselves and drawing code in the engine. It gets its own spec.

## Scope

In:
- SR measurements of the six types the model holds: `length`, `bidirectional`, `ellipse`, `rectangle`, `probe`, `angle` (`packages/core/src/measurements/model.ts`).
- A call to load an SR series, and a control in the measurements panel to call it.
- A PDF of the measurements, with a call and a button.
- A synthetic SR fixture, tests, docs, and a changeset.

Out (each can be a later spec):
- Writing an SR (`exportSr`, the stretch goal in `docs/plan.md`).
- GSPS and other presentation states.
- SR that is text only, key object selections, and measurements without image coordinates.
- Shapes the model has no type for: free-hand outlines, arrows, circles, Cobb angle. These are skipped and counted (see "Load behavior").
- A picture of the slice inside the PDF.

## Design

### Where the code goes

The architecture rules decide the layout. Only `packages/core/src/engine/**` may import `@cornerstonejs/*`, and `@cornerstonejs/adapters` is one of those packages. It is already a dependency, and `engine/segmentation.ts` already uses `adaptersSEG` from it.

```
packages/core/src/
  engine/sr.ts                 uses adaptersSR to read an SR; returns plain data (no Cornerstone types)
  rendering-port.ts            new method: parseStructuredReport(bytes, imageIds) -> EngineSrMeasurement[]
  measurements/sr.ts           pure: EngineSrMeasurement -> Measurement, through parseMeasurement (Zod)
  measurements/registry.ts     new: loadSr(seriesInstanceUID), runs in the queue
  measurements/report.ts       pure: measurements + study info -> a plain report model
  report/pdf.ts                lazy chunk: report model -> PDF bytes
packages/elements/src/
  measurement-list.ts          "Load report" control and "Download PDF" button
```

### Loading an SR

1. `viewer.measurements.loadSr(seriesInstanceUID)` goes through the queue in `viewer-core.ts`, like `viewer.segmentations.load`.
2. It checks the UID with `assertDicomUid`, then fetches the instance with `getInstanceBytes(study, series, sop, 'SR')`. A server that serves no whole instances makes this fail with the data source's own error. The call rejects with it.
3. It finds the images the SR points at. Cornerstone's reader needs a map from SOP instance UID to image id, and the image's plane metadata, to turn pixel positions into millimetres. The viewer already holds this for series it has loaded. For a referenced series it has not loaded, the call fetches the series metadata only (no pixels) with `getSeries`.
4. The engine reads the SR with `adaptersSR` and returns plain shapes: a type, points, a label, and the SOP instance each is on.
5. `measurements/sr.ts` turns each shape into a `Measurement` through `parseMeasurement`. A shape the model rejects is skipped, not thrown.
6. The measurements are added with origin `import`.

### Load behavior

- **Ids are stable.** An id is made from the SR's SOP instance UID and the shape's position in the report. Loading the same SR twice replaces its measurements instead of doubling them. This matches `importJson`'s default `merge` mode.
- **Numbers are worked out again.** Values stored in the SR (area, mean, and so on) are not shown. The viewer computes length, angle, and Hounsfield statistics from the points and the pixels, as it does for every other measurement. The number on screen always matches the image.
- **Skips are counted, not hidden.** The result is `{ added, replaced, skipped: { reason, count }[] }`. Reasons include: a type the model has no place for, an image that is not in this study, and a report row with no image coordinates. The panel shows the count and the reasons. A report that adds nothing says why.
- **All or nothing does not apply.** `importJson` is all or nothing because a file the viewer wrote should be perfect. An SR comes from outside, so partial loads are normal and reported.
- **Nothing to give back.** Parsing holds no workers, cache, or WebGL. If the spike finds otherwise, ADR 0005 applies.

### Public API

```ts
interface SrLoadResult {
  readonly added: number;
  readonly replaced: number;
  readonly skipped: readonly { readonly reason: string; readonly count: number }[];
}
// on MeasurementsApi:
loadSr(seriesInstanceUID: string): Promise<SrLoadResult>;
exportPdf(options?: PdfOptions): Promise<Blob>;
```

No Cornerstone type appears in the public API.

### The measurements panel

- A "Load report" control lists the SR series of the open study. Choosing one calls `loadSr`.
- A "Download PDF" button calls `exportPdf` and saves the file. It is disabled when there are no measurements.
- Both are panel controls, so they must follow ADR 0010: each has an `aria-label`, uses only `--dv-*` tokens, and keeps the existing `data-*` attributes and class names.
- A toolbar command (`measurements.downloadPdf`) is added to `viewer.commands`, so a config file can place it on the toolbar as data.

### The PDF report

Contents, one table row per measurement:
- Title, the viewer name and version, and the time it was made.
- Study and series description, modality, and the slice number.
- Label, type, value (length in mm, angle in degrees, area and Hounsfield statistics), and where it came from (`user`, `api`, or `import`).
- A footer on every page: "Software for building viewers. Not for diagnosis."

Privacy:
- The report leaves out patient name, patient ID, and birth date unless `showPatientInfo` is on, the same switch as the overlay (`config/tags.ts`). The default is off.
- The report is made in the browser. Nothing is sent anywhere.

Making the PDF:
- `report/pdf.ts` is a lazy chunk, so the entry and viewer chunks do not grow.
- A PDF library adds size. Add a budget line to `.size-limit.json` for the chunk and say why in the PR (the rule in `CLAUDE.md`). Choosing the library is a spike task: measure two or three small ones and pick the smallest that handles a table and page breaks.
- **Text that is not Latin.** A label is free text. A library that uses its standard fonts cannot draw every character. The report must not crash and must not silently drop text. Either embed a font (more size) or replace an unsupported character with `?` and say so on the page. Decide in the spike.
- Fallback if no library is small enough: a print stylesheet and `window.print()`. This has no file download and no new dependency, but the person must choose "Save as PDF".

## Test plan (tests first)

1. **Fixture.** Add a synthetic SR to `tools/phantom/phantom.py` and `fixtures/phantom`, with an entry in `SHA256SUMS`. It refers to the phantom CT series and holds one of each of the six types, plus one shape of an unsupported type. It must be reproducible: `phantom.py` already replaces the clock and random UIDs that highdicom stamps (see the comment near line 456). Two ways to make it:
   - **A.** Write it with Cornerstone's own adapter in a small script. This is a certain round trip, and the first test uses it.
   - **B.** Write it with highdicom (`hd.sr`), which the phantom tool already depends on. This tests the case that matters most: an SR from a tool other than Cornerstone.
2. **Pure mapper** (`measurements/sr.test.ts`): each shape type maps; a bad shape is skipped; an id is stable.
3. **Engine** (`engine/sr.test.ts`): the fixture gives the expected shapes. Points match the ones written within a small tolerance.
4. **Registry**: `loadSr` adds with origin `import`; loading twice replaces; the skip counts are right; a UID that fails `assertDicomUid` never reaches a request path.
5. **PDF**: the report model is tested as data (rows, order, the patient-tag switch). The PDF bytes get a smoke test: it starts with `%PDF`, and the page count is right for a long list.
6. **Matrix**: add a step to the browser smoke test. Open a study with the SR, load it, and expect the measurement count in the panel.
7. **Visual**: the panel with the new controls, in both themes. Baselines are made only in the pinned Playwright image.
8. **Accessibility**: the existing axe checks must still pass with the new controls.

## Steps

Each step is one commit, `M10: ...`, with its tests.

0. **Spike (about one weekend).** Fixtures A and B. Read A with `adaptersSR`; check the points. Try B. Measure the engine-chunk growth against its budget (880 kB). Measure two PDF libraries. Go or no-go: see below.
1. Pure mapper and Zod checks.
2. Engine reader and the port method.
3. `loadSr` in the registry, through the queue, with its events.
4. Panel controls.
5. Report model, then the PDF chunk, `exportPdf`, the button, the command.
6. Docs: a section in the measurements guide, an ADR (0013), a changeset, a README line, the size budget, and the site's feature text.

### Go or no-go (after step 0)

Go if all of these hold:
- Cornerstone's reader gives back all six types from fixture A, with points that match.
- The engine chunk stays within its budget, or the increase is small enough to justify in the PR.
- One PDF library fits a size we accept, or the print fallback is accepted.

If fixture B does not read, that is not a no-go. It means the first release reads SRs made by Cornerstone and says so. Reading other tools' SRs then needs a reader we write ourselves (a pure parser of the SR content tree). That is more code but removes the engine dependency, and it is the next spec.

## Spike findings (step 0, partly done)

Run in Node against `@cornerstonejs/adapters` 5.11.4, with one SR made by highdicom (`Comprehensive3DSR`, TID 1500, one `Length` group) that refers to a phantom CT slice.

- **It reads a highdicom SR, but only after a fix-up.** `MeasurementReport.generateToolState` looks for the spatial coordinates (SCOORD) inside the numeric item (NUM) of a measurement group. highdicom, like the standard's template, puts the SCOORD next to the NUM. With a NUM present the reader fails with "No spatial coordinates group found", and it only logs a warning. The engine must move a sibling SCOORD into the NUM item before it calls the reader. With that done the `Length` came back with the right world points and length (60 mm for 40 pixels at 1.5 mm).
- **Half a pixel.** The reader treats an SCOORD value as measured from the pixel's corner and subtracts 0.5 to get Cornerstone's pixel-centre index (a column of 30 became index 29.5). Tests must compare in millimetres with that in mind, and fixture A (written by Cornerstone's own adapter) is the check that the two sides agree.
- **The image map is keyed `SOP:frame`**, for example `1.2.3.4:1`, not by SOP instance alone. A wrong key gives the unhelpful "Cannot read properties of undefined (reading 'frameOfReferenceUID')".
- **The reader needs a parsed dataset**, made with `dcmjs` (`DicomMessage.readFile`, then `naturalizeDataset`). `dcmjs` is already inside the engine chunk through the adapters, but `packages/core` does not list it. Add it as an exact-pinned dev dependency (0.52.0), as for the Cornerstone packages (ADR 0003). No chunk growth is expected from this; confirm when the budget is measured.
- **Errors inside a group are swallowed.** The reader catches them and goes on, so a group that fails simply is not in the result. The engine must count the measurement groups itself and report the difference as skipped, with the reason "could not be read".
- **Geometry comes from Cornerstone's metadata.** The pixel-to-world step reads `imagePlaneModule` for each referenced image from Cornerstone's own metadata, so the images must be registered first. The engine already does that with `metadataUtilities.addDicomWebInstance` and a claim-and-release count (`engine/index.ts`, ADR 0005). Parsing an SR claims the referenced images, reads, and releases them.
- **Still open from step 0:** the other five types (only `Length` has been read), fixture A, engine-chunk growth, and the PDF library measurement.

## Risks

- **Other tools' SRs.** The reader is built around what Cornerstone writes. Whether it reads an SR from highdicom or a vendor is what the spike finds out. Do not claim it works for them until fixture B passes.
- **Missing metadata.** If the referenced images' plane metadata is absent, positions cannot become millimetres. Those shapes are skipped with that reason.
- **Engine size.** The adapters' SR code may add to the lazy engine chunk even though the SEG code is already there.
- **Time.** The estimate is 2 to 4 days for SR and 1 to 2 days for the PDF, after the spike. The spike is the cheapest way to move those numbers.

## Decisions needed

1. **What did "download PDF" mean?** This spec says: a report of the measurements on screen. It could instead mean a PDF of the SR itself, or a screenshot of the image. The first needs the least work.
2. **Does the report show study and series descriptions?** They are not patient tags, but they can identify a case. The spec shows them. Say if you want them off by default.
3. **A new dependency for the PDF, or print-to-PDF?** The spec prefers a small library in a lazy chunk, decided by the spike.
4. **Milestone ID.** `M10` is proposed. Change it if you number this differently.
