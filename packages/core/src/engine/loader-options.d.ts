// Provided by an alias in tsdown.config.ts. The loader's `setOptions` is not reachable through its
// package exports, but it is the only way to add headers to the frame requests it makes itself.
declare module 'dv-loader-options' {
  import type { LoaderOptions } from '@cornerstonejs/dicom-image-loader/types';
  export function setOptions(options: LoaderOptions): void;
}
