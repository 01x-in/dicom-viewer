import type { LoadedSeries } from '@scope/viewer-core';

declare global {
  interface Window {
    __dv?: LoadedSeries;
    __dvError?: string;
  }
}
