import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  publint: true,
  // Marks the whole package as client-only for Next.js App Router (React Server Components).
  outputOptions: { banner: "'use client';" },
});
