# @01x/dicom-viewer-core

## 1.1.0

### Minor Changes

- 9dd70c7: Add typed host messages for the styled viewer. React and Vue accept `messages`, and the web components accept the same property. Omitted messages keep their English defaults. Changing the messages updates the toolbar, panels, status text, and accessible labels without replacing the viewer or clearing measurements.
  
  Expose `ViewerMessages`, `DEFAULT_VIEWER_MESSAGES`, `resolveViewerMessages`, and `formatViewerMessage` from the core. Segmentation warnings include named parameters so translated warnings retain dimensions, distances, counts, and segment labels. The shell shows a generic translated load error and leaves the original error in its event for the host to handle safely.

## 1.0.2

### Patch Changes

- ebdf4b6: Updates `zod` to 4.6.7. Earlier versions can run out of memory while checking a very large array that fails the check (GHSA-mrhx-c7xc-m3w5), and the viewer checks arrays that a server sends.

## 1.0.1

### Patch Changes

- e8d8406: The packages are published under the `@01x` npm organization: `@01x/dicom-viewer-core`, `-elements`, `-react`, and `-vue`. The code is the same as the `@tushar-im/dicom-viewer-*` 1.0.0 packages, which are no longer published.

## 1.0.0

### Major Changes

- d21c400: First stable release. Layouts, series drag and drop, hanging protocols, reformatted planes with crosshairs, DICOM SEG overlays, measurements, the config layer, and the styled shell, for React, Next.js, Vue, Nuxt, and plain HTML. From here the public API follows semver: anything under `viewer.unsafe` is outside it.
