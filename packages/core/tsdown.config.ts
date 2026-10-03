import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    publint: true,
  },
  {
    entry: { 'bin/viewer-assets': 'src/bin/viewer-assets.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: false,
    clean: false,
    fixedExtension: false,
  },
]);
