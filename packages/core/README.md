# @tushar-im/dicom-viewer-core

The headless core of the DICOM viewer: the Cornerstone3D engine (prebundled, loaded on first use), the viewer state,
the tools, measurements, DICOM SEG overlays, layouts and reformatted planes, and the DICOMweb and local-file data
sources. It has no interface of its own; pair it with `@tushar-im/dicom-viewer-elements`, or use it from your own UI.

```ts
import { createDicomWebDataSource, createViewer } from '@tushar-im/dicom-viewer-core';

const viewer = createViewer({
  dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
});
```

`createViewer` needs a browser. Cornerstone is bundled into this package, so you never install it. The package also
has a `viewer-assets` command (`npx viewer-assets copy <folder>`) for hosts that serve the workers from a URL.

See the [README](https://github.com/01x-in/dicom-viewer#readme) and the
[guides](https://github.com/01x-in/dicom-viewer/tree/main/docs/guides). MIT licensed.
