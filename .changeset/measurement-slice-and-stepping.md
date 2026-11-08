---
'@01x/dicom-viewer-core': minor
'@01x/dicom-viewer-elements': minor
---

Each row of the measurements panel now says which slice the measurement is on ("Slice 31", counted as the overlay counts), and **Previous** and **Next** buttons step through the measurements, showing the slice of each. A measurement is drawn only on its own slice, so before this a person could not tell where the others were. Core gains `viewer.measurements.slices()`, which gives the slice of each measurement by id, and three translatable messages: `measurementSlice`, `previousMeasurement`, and `nextMeasurement`.
