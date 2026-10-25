import type { Viewer, ViewportApi } from '@01x/dicom-viewer-core';

declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvViewer?: Viewer | undefined;
    __dvError?: string;
  }
}
