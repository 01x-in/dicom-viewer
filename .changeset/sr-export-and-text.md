---
'@01x/dicom-viewer-core': minor
'@01x/dicom-viewer-elements': minor
---

The viewer can write what a person measured. `viewer.measurements.exportSr()` makes a DICOM Structured Report (a TID 1500 measurement report) of the measurements on screen, in the browser, and `exportText()` gives them as plain text. The report is the measurements only, with no pixel data, and it has the patient's identity in it, as a PACS needs. highdicom reads it, and the viewer reads it again. Each measurement keeps the same tracking identifier in every export.

The measurements panel has a **Copy** button (it shows the text in a box to copy by hand when the browser refuses the clipboard) and a **Download** menu (Text, PDF, and DICOM SR) in place of the Download PDF button. The `measurements` config key, `{ downloadFormats, copyText }`, says which items the menu has and whether Copy is there, so a host that must not hand out `.dcm` files leaves `sr` out. The commands `measurements.copyText`, `measurements.downloadText`, and `measurements.downloadSr` are new, and the API calls and commands still work for a format the menu leaves out. The report controls, which were English only, are now in `ViewerMessages`.

Reading a report now puts right text that was written in UTF-8 (a label such as `é` or in another script showed as `Ã©`), and takes a label from a Comment, where the writer puts the whole of it. Core gains the types `SrExportOptions`, `TextOptions`, `MeasurementsConfig`, and `DownloadFormat`, and the constant `DOWNLOAD_FORMATS`.
