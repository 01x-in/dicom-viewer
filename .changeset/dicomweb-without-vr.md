---
'@tushar-im/dicom-viewer-core': patch
---

The DICOMweb source accepts DICOM JSON whose elements have no `vr`, as static WADO servers (such as OHIF's public one) send it. It never read the VR.
