# @01x/dicom-viewer-core

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
