import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const require = createRequire(import.meta.url);

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: true,
    sourcemap: false,
    minify: true,
    publint: true,
    // Cornerstone and vtk.js are devDependencies, so they are bundled into the lazily loaded engine
    // chunk. vtk.js reaches xmlbuilder2, which imports Node's `events`; bundlers turn that into an
    // empty stub, so it is aliased to the npm polyfill here (and `url` to a shim). See docs/adr/0003-prebundled-engine.md.
    alias: {
      events: require.resolve('events/'),
      url: fileURLToPath(new URL('./src/engine/shims/url.ts', import.meta.url)),
    },
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
