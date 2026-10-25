# @01x/dicom-viewer-react

The React adapter of the DICOM viewer. It works in Vite and in the Next.js App Router (Turbopack and webpack), with no
bundler configuration. React 19 or later.

```tsx
'use client';
import { createDicomWebDataSource, type ViewerOptions } from '@01x/dicom-viewer-core';
import { DicomViewer } from '@01x/dicom-viewer-react';

// Keep the options object the same between renders. A new object restarts the viewer.
const options: ViewerOptions = {
  dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
};

export function Viewer() {
  return (
    <div style={{ height: '100vh' }}>
      <DicomViewer options={options} studyInstanceUID="1.2.840.113619.2.55.3" />
    </div>
  );
}
```

Install `@01x/dicom-viewer-core` next to it. See the [README](https://github.com/01x-in/dicom-viewer#readme). MIT licensed.
