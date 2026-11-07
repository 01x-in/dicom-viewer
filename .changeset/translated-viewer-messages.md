---
'@01x/dicom-viewer-core': minor
'@01x/dicom-viewer-elements': minor
'@01x/dicom-viewer-react': minor
'@01x/dicom-viewer-vue': minor
---

Add typed host messages for the styled viewer. React and Vue accept `messages`, and the web components accept the same property. Omitted messages keep their English defaults. Changing the messages updates the toolbar, panels, status text, and accessible labels without replacing the viewer or clearing measurements.

Expose `ViewerMessages`, `DEFAULT_VIEWER_MESSAGES`, `resolveViewerMessages`, and `formatViewerMessage` from the core. Segmentation warnings include named parameters so translated warnings retain dimensions, distances, counts, and segment labels. The shell shows a generic translated load error and leaves the original error in its event for the host to handle safely.
