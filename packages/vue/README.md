# @tushar-im/dicom-viewer-vue

The Vue 3 adapter of the DICOM viewer. It works in Vite and in Nuxt, with no bundler configuration.

```vue
<script setup lang="ts">
import { createDicomWebDataSource, type ViewerOptions } from '@tushar-im/dicom-viewer-core';
import { DicomViewer } from '@tushar-im/dicom-viewer-vue';

const options: ViewerOptions = {
  dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
};
</script>

<template>
  <div style="height: 100vh">
    <DicomViewer :options="options" study-instance-uid="1.2.840.113619.2.55.3" />
  </div>
</template>
```

Install `@tushar-im/dicom-viewer-core` next to it. See the [README](https://github.com/01x-in/dicom-viewer#readme). MIT licensed.
