# @tushar-im/dicom-viewer-core

## 1.0.1

### Patch Changes

- e53ea77: `viewport.cine.toggle()` decides on what the last call asked for, so two quick presses of the cine key, button, or command cancel each other. The overlay patient-tag guard also covers the request, visit, procedure, and report groups and the physician identification tags.
- c675569: The DICOMweb source accepts DICOM JSON whose elements have no `vr`, as static WADO servers (such as OHIF's public one) send it. It never read the VR. The `vr` of `DicomJsonInstance` is now optional in the type, so code that reads it must allow `undefined`.

## 1.0.0

### Major Changes

- d21c400: First stable release. Layouts, series drag and drop, hanging protocols, reformatted planes with crosshairs, DICOM SEG overlays, measurements, the config layer, and the styled shell, for React, Next.js, Vue, Nuxt, and plain HTML. From here the public API follows semver: anything under `viewer.unsafe` is outside it.
