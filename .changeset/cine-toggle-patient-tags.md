---
'@tushar-im/dicom-viewer-core': patch
'@tushar-im/dicom-viewer-elements': patch
---

`viewport.cine.toggle()` decides on what the last call asked for, so two quick presses of the cine key, button, or command cancel each other. The overlay patient-tag guard also covers the request, visit, procedure, and report groups and the physician identification tags.
