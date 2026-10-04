import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/define.ts'],
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  publint: true,
});
