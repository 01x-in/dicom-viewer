---
'@01x/dicom-viewer-core': minor
'@01x/dicom-viewer-elements': minor
---

Read DICOM Structured Reports and download a PDF report of the measurements.

- `viewer.measurements.loadSr(seriesInstanceUID)` reads a TID 1500 measurement report of the study on screen and keeps its lengths, bidirectional measurements, ellipses, rectangles, probes, and angles as measurements. The numbers are worked out again from the pixels. A shape that cannot be kept is counted in `skipped`, with the reason. Loading a report again replaces what it made.
- `viewer.measurements.exportPdf()` makes a PDF of the measurements of the study on screen, in the browser. It leaves out who the patient is unless `showPatientInfo` is on. The command `measurements.downloadPdf` saves it, and a config file can put it on the toolbar.
- The measurements panel has a "Load report" control, which lists the SR series of the study, and a "Download PDF" button.
- `measurementName` moves into the core package and is exported from it. The elements package still exports it.
