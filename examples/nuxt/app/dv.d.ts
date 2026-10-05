import type { ViewportApi } from '@scope/viewer-core';

declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvError?: string;
  }
}
