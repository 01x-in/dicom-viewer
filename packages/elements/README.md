# @01x/dicom-viewer-elements

The styled interface of the DICOM viewer as web components: `<dv-viewer>` with its toolbar, series browser,
measurement and segmentation panels, layouts, and light and dark themes. It works in plain HTML and in any framework.

```html
<dv-viewer id="viewer" style="display: block; height: 100vh"></dv-viewer>
<script type="module">
  import '@01x/dicom-viewer-elements/define';
  import { createDicomWebDataSource } from '@01x/dicom-viewer-core';

  const viewer = document.querySelector('#viewer');
  viewer.options = {
    dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
  };
  viewer.studyInstanceUid = '1.2.840.113619.2.55.3';
</script>
```

Import `@01x/dicom-viewer-elements/define` once to register the elements. Install `@01x/dicom-viewer-core` next to it. See the
[README](https://github.com/01x-in/dicom-viewer#readme) for theming, the toolbar, panels and slots. MIT licensed.
