---
'@01x/dicom-viewer-core': patch
---

Updates `zod` to 4.6.7. Earlier versions can run out of memory while checking a very large array that fails the check (GHSA-mrhx-c7xc-m3w5), and the viewer checks arrays that a server sends.
