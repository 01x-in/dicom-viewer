---
'@01x/dicom-viewer-core': minor
'@01x/dicom-viewer-elements': minor
---

Each row of the measurements panel now says which slice the measurement is on ("Slice 31", counted as the overlay counts), and **Previous** and **Next** buttons step through the measurements, showing the slice of each. A measurement is drawn only on its own slice, so before this a person could not tell where the others were. Core gains `viewer.measurements.slices()`, which gives the slice of each measurement by id, and three translatable messages: `measurementSlice`, `previousMeasurement`, and `nextMeasurement`.

The panel can also choose several measurements: a box on each row (or **X** on the focused row, or Ctrl+A for all), a **Select all** box, and a count. **Show selected** puts the chosen measurements side by side, one in each viewport on its own slice (two in a row of two, three or four in a grid of four, and the first four when more are chosen, which it says). **Delete selected** removes them. Choosing is separate from picking: it does not show an image. The option's `aria-checked` says whether it is chosen. New translatable messages: `measurementSelection`, `selectAll`, `selectedCount`, `showSelected`, `deleteSelected`, `singleView`, and `showingFirstSelected`.

Once a report is loaded, a **Reload report** button loads it again, replacing what it made (the select cannot, as choosing the report that is already chosen sends no change). The message is `reloadReport`.
