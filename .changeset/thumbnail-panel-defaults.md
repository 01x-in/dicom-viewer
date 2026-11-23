---
'@01x/dicom-viewer-elements': minor
'@01x/dicom-viewer-react': minor
'@01x/dicom-viewer-vue': minor
---

Add optional `seriesDisplay="thumbnails"` and `defaultRightPanelCollapsed` appearance controls to the styled shell and React and Vue adapters. Thumbnail tiles have a black image background and omit visible series captions while preserving accessible names, hover identification, selection, and keyboard use. The right dock can start collapsed, and user expansion persists through later host updates. Existing hosts keep detailed series rows and an expanded right dock.
