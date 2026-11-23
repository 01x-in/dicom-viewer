# @01x/dicom-viewer-core

## 1.3.0

### Minor Changes

- 883bf6a: Each row of the measurements panel now says which slice the measurement is on ("Slice 31", counted as the overlay counts), and **Previous** and **Next** buttons step through the measurements, showing the slice of each. A measurement is drawn only on its own slice, so before this a person could not tell where the others were. Core gains `viewer.measurements.slices()`, which gives the slice of each measurement by id, and three translatable messages: `measurementSlice`, `previousMeasurement`, and `nextMeasurement`.
  
  The panel can also choose several measurements: a box on each row (or **X** on the focused row, or Ctrl+A for all), a **Select all** box, and a count. **Show together** puts the chosen measurements side by side, one in each viewport on its own slice (two in a row of two, three or four in a grid of four, and the first four when more are chosen, which it says). **Delete selected** removes them. Choosing is separate from picking: it does not show an image. The option's `aria-checked` says whether it is chosen. New translatable messages: `measurementSelection`, `selectAll`, `selectedCount`, `showTogether`, `deleteSelected`, and `showingFirstSelected`.
  
  Once a report is loaded, a **Reload report** button loads it again, replacing what it made (the select cannot, as choosing the report that is already chosen sends no change). The message is `reloadReport`.
- b1da859: Multi-frame images open. A series of Enhanced CT, MR, or PT instances shows each frame as one slice, with the position, orientation, and rescale of its own, over DICOMweb and from local files, and reformats into planes when the frames are even and parallel. A loop with no geometry (ultrasound, angiography) shows its frames in the order they were recorded, and cine plays at the rate the image states (`RecommendedDisplayFrameRate`, `CineRate`, or `FrameTime`) unless `fps` is given. Single-frame series are unchanged.
  
  `navigateTo` takes a `frameNumber` (from 1, default 1) and rejects a frame the instance does not have, naming how many it has. A measurement on a frame above 1 has `reference.frameNumber`; a measurement with none is on frame 1, and `measurements/v1` stays version 1. `measurements.list` takes a `frameNumber` filter. The `viewport:image` event and the result of `navigateTo` say the frame. A Structured Report is read by frame. A binary SEG on the frames of one multi-frame instance is drawn on the frame each of its frames names; `segmentations.jumpToSegment` says the `frameNumber` it showed. A SEG of another kind (fractional or labelmap) on a multi-frame image rejects and says why, because the viewer cannot tell its frames apart.
  
  `SeriesInstance` has three new fields: `frameNumber`, `frameCount`, and `instanceMetadata`. A host with its own data source that builds `SeriesInstance` by hand must add them, and make one `SeriesInstance` for each frame of a multi-frame instance: the same `sopInstanceUID`, the `frameNumber` and `frameCount`, an `imageId` for that frame, the frame's own position and orientation at the top level of its `metadata`, and the whole instance in `instanceMetadata`.

## 1.2.0

### Minor Changes

- 15cca81: Read DICOM Structured Reports and download a PDF report of the measurements.
  
  - `viewer.measurements.loadSr(seriesInstanceUID)` reads a TID 1500 measurement report of the study on screen and keeps its lengths, bidirectional measurements, ellipses, rectangles, probes, and angles as measurements. The numbers are worked out again from the pixels. A shape that cannot be kept is counted in `skipped`, with the reason. Loading a report again replaces what it made.
  - `viewer.measurements.exportPdf()` makes a PDF of the measurements of the study on screen, in the browser. It leaves out who the patient is unless `showPatientInfo` is on. The command `measurements.downloadPdf` saves it, and a config file can put it on the toolbar.
  - The measurements panel has a "Load report" control, which lists the SR series of the study, and a "Download PDF" button.
  - `measurementName` moves into the core package and is exported from it. The elements package still exports it.

### Patch Changes

- e38b2cf: Document the `messages` property in the API reference: the full key list, placeholders, an example, and what is not translated.

## 1.1.0

### Minor Changes

- 9dd70c7: Add typed host messages for the styled viewer. React and Vue accept `messages`, and the web components accept the same property. Omitted messages keep their English defaults. Changing the messages updates the toolbar, panels, status text, and accessible labels without replacing the viewer or clearing measurements.
  
  Expose `ViewerMessages`, `DEFAULT_VIEWER_MESSAGES`, `resolveViewerMessages`, and `formatViewerMessage` from the core. Segmentation warnings include named parameters so translated warnings retain dimensions, distances, counts, and segment labels. The shell shows a generic translated load error and leaves the original error in its event for the host to handle safely.

## 1.0.2

### Patch Changes

- ebdf4b6: Updates `zod` to 4.6.7. Earlier versions can run out of memory while checking a very large array that fails the check (GHSA-mrhx-c7xc-m3w5), and the viewer checks arrays that a server sends.

## 1.0.1

### Patch Changes

- e8d8406: The packages are published under the `@01x` npm organization: `@01x/dicom-viewer-core`, `-elements`, `-react`, and `-vue`. The code is the same as the `@tushar-im/dicom-viewer-*` 1.0.0 packages, which are no longer published.

## 1.0.0

### Major Changes

- d21c400: First stable release. Layouts, series drag and drop, hanging protocols, reformatted planes with crosshairs, DICOM SEG overlays, measurements, the config layer, and the styled shell, for React, Next.js, Vue, Nuxt, and plain HTML. From here the public API follows semver: anything under `viewer.unsafe` is outside it.
