import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const require = createRequire(import.meta.url);

export default defineConfig([
  {
    entry: { index: 'src/index.ts', local: 'src/local.ts' },
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
    plugins: [
      {
        name: 'dv-replace-compute-worker-registration',
        resolveId(source, importer) {
          if (
            source.endsWith('/registerComputeWorker.js') &&
            importer?.includes('@cornerstonejs/tools') === true
          ) {
            return fileURLToPath(
              new URL('./src/engine/shims/register-compute-worker.ts', import.meta.url),
            );
          }
          return null;
        },
      },
    ],
    alias: {
      events: require.resolve('events/'),
      // @cornerstonejs/adapters imports Babel helpers without declaring @babel/runtime.
      '@babel/runtime': dirname(require.resolve('@babel/runtime/package.json')),
      url: fileURLToPath(new URL('./src/engine/shims/url.ts', import.meta.url)),
      // The loader's `setOptions` is not exported. Resolving to the file its own request code imports
      // gives one shared module, so the options we set are the ones it reads.
      'dv-loader-options': join(
        dirname(require.resolve('@cornerstonejs/dicom-image-loader/package.json')),
        'dist/esm/imageLoader/internal/options.js',
      ),
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
