# @01x/dicom-viewer-elements

## 1.3.0

### Minor Changes

- 883bf6a: Each row of the measurements panel now says which slice the measurement is on ("Slice 31", counted as the overlay counts), and **Previous** and **Next** buttons step through the measurements, showing the slice of each. A measurement is drawn only on its own slice, so before this a person could not tell where the others were. Core gains `viewer.measurements.slices()`, which gives the slice of each measurement by id, and three translatable messages: `measurementSlice`, `previousMeasurement`, and `nextMeasurement`.
  
  The panel can also choose several measurements: a box on each row (or **X** on the focused row, or Ctrl+A for all), a **Select all** box, and a count. **Show together** puts the chosen measurements side by side, one in each viewport on its own slice (two in a row of two, three or four in a grid of four, and the first four when more are chosen, which it says). **Delete selected** removes them. Choosing is separate from picking: it does not show an image. The option's `aria-checked` says whether it is chosen. New translatable messages: `measurementSelection`, `selectAll`, `selectedCount`, `showTogether`, `deleteSelected`, and `showingFirstSelected`.
  
  Once a report is loaded, a **Reload report** button loads it again, replacing what it made (the select cannot, as choosing the report that is already chosen sends no change). The message is `reloadReport`.

### Patch Changes

- 86a2b59: The "Load report" control in the measurements panel now shows the report that is loaded, and goes back to its prompt if the load fails or the study changes. It used to show the prompt again after every load, which did not say which report the measurements came from.
- Updated dependencies [883bf6a]
- Updated dependencies [b1da859]
  - @01x/dicom-viewer-core@1.3.0

## 1.2.0

### Minor Changes

- 15cca81: Read DICOM Structured Reports and download a PDF report of the measurements.
  
  - `viewer.measurements.loadSr(seriesInstanceUID)` reads a TID 1500 measurement report of the study on screen and keeps its lengths, bidirectional measurements, ellipses, rectangles, probes, and angles as measurements. The numbers are worked out again from the pixels. A shape that cannot be kept is counted in `skipped`, with the reason. Loading a report again replaces what it made.
  - `viewer.measurements.exportPdf()` makes a PDF of the measurements of the study on screen, in the browser. It leaves out who the patient is unless `showPatientInfo` is on. The command `measurements.downloadPdf` saves it, and a config file can put it on the toolbar.
  - The measurements panel has a "Load report" control, which lists the SR series of the study, and a "Download PDF" button.
  - `measurementName` moves into the core package and is exported from it. The elements package still exports it.

### Patch Changes

- e38b2cf: Document the `messages` property in the API reference: the full key list, placeholders, an example, and what is not translated.
- Updated dependencies [e38b2cf]
- Updated dependencies [15cca81]
  - @01x/dicom-viewer-core@1.2.0

## 1.1.0

### Minor Changes

- 9dd70c7: Add typed host messages for the styled viewer. React and Vue accept `messages`, and the web components accept the same property. Omitted messages keep their English defaults. Changing the messages updates the toolbar, panels, status text, and accessible labels without replacing the viewer or clearing measurements.
  
  Expose `ViewerMessages`, `DEFAULT_VIEWER_MESSAGES`, `resolveViewerMessages`, and `formatViewerMessage` from the core. Segmentation warnings include named parameters so translated warnings retain dimensions, distances, counts, and segment labels. The shell shows a generic translated load error and leaves the original error in its event for the host to handle safely.

### Patch Changes

- Updated dependencies [9dd70c7]
  - @01x/dicom-viewer-core@1.1.0

## 1.0.2

### Patch Changes

- Updated dependencies [ebdf4b6]
  - @01x/dicom-viewer-core@1.0.2

## 1.0.1

### Patch Changes

- e8d8406: The packages are published under the `@01x` npm organization: `@01x/dicom-viewer-core`, `-elements`, `-react`, and `-vue`. The code is the same as the `@tushar-im/dicom-viewer-*` 1.0.0 packages, which are no longer published.
- Updated dependencies [e8d8406]
  - @01x/dicom-viewer-core@1.0.1

## 1.0.0

### Major Changes

- d21c400: First stable release. Layouts, series drag and drop, hanging protocols, reformatted planes with crosshairs, DICOM SEG overlays, measurements, the config layer, and the styled shell, for React, Next.js, Vue, Nuxt, and plain HTML. From here the public API follows semver: anything under `viewer.unsafe` is outside it.

### Patch Changes

- Updated dependencies [d21c400]
  - @01x/dicom-viewer-core@1.0.0
