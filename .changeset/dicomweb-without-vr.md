---
'@tushar-im/dicom-viewer-core': patch
---

The DICOMweb source accepts DICOM JSON whose elements have no `vr`, as static WADO servers (such as OHIF's public one) send it. It never read the VR. The `vr` of `DicomJsonInstance` is now optional in the type, so code that reads it must allow `undefined`.
