// Prebuilds the decode and compute workers so hosts never bundle Cornerstone's
// `new URL(..., import.meta.url)` workers.
//
// Outputs (all generated, none committed):
//   assets/decode.worker.js          `url` mode decode worker, loads WASM from `wasmBasePath`
//   assets/compute.worker.js         `url` mode compute worker
//   assets/wasm/*.wasm               the codecs the decode worker loads
//   src/generated/inline-assets.ts   `inline` mode: both worker sources, WASM embedded in decode
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Plugin, rolldown } from 'rolldown';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromCore = createRequire(join(packageDir, 'package.json'));
const loaderRoot = dirname(
  requireFromCore.resolve('@cornerstonejs/dicom-image-loader/package.json'),
);
const loaderDist = join(loaderRoot, 'dist/esm');
const loaderEntry = join(loaderDist, 'imageLoader/wadors/index.js');
const requireFromLoader = createRequire(loaderEntry);
const toolsDist = join(
  dirname(requireFromCore.resolve('@cornerstonejs/tools/package.json')),
  'dist/esm',
);

/** Codecs the viewer supports. JPEG XL is deliberately left out (1 MB, not in the v1 scope). */
const WASM_SPECIFIERS = [
  '@cornerstonejs/codec-openjpeg/decodewasm',
  '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasm',
  '@cornerstonejs/codec-charls/decodewasm',
  '@cornerstonejs/codec-openjph/wasm',
] as const;

/** The fake `import.meta.url` used in the inline build: a blob: worker URL cannot be a `new URL` base. */
const INLINE_IMPORT_META_URL = 'https://dicom-viewer.invalid/decode.worker.js';

async function readWasmFiles(): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  for (const specifier of WASM_SPECIFIERS) {
    const path = requireFromLoader.resolve(specifier);
    files[basename(path)] = await readFile(path);
  }
  return files;
}

function workerPlugin(embedded: Record<string, Buffer>): Plugin {
  const base64Files = Object.fromEntries(
    Object.entries(embedded).map(([name, bytes]) => [name, bytes.toString('base64')]),
  );
  return {
    name: 'dv-worker',
    resolveId(source, importer) {
      if (source === 'dv-upstream-decode-worker') {
        return { id: join(loaderDist, 'decodeImageFrameWorker.js'), moduleSideEffects: true };
      }
      if (source === 'dv-upstream-compute-worker') {
        return { id: join(toolsDist, 'workers/computeWorker.js'), moduleSideEffects: true };
      }
      // package.json says `sideEffects: false`, but the shim exists only for its side effect.
      if (source === './wasm-shim.ts') {
        return { id: join(packageDir, 'workers/wasm-shim.ts'), moduleSideEffects: true };
      }
      // Emscripten glue names these for its Node code path, which never runs in a worker.
      if (source === 'fs' || source === 'path') return '\0dv-empty';
      // xmlbuilder2 (via vtk.js) requires Node's `url`; `URL` is a global in a worker.
      if (source === 'url') return '\0dv-url';
      if (source === 'dv-inline-wasm') return '\0dv-inline-wasm';
      // Drop the JPEG XL decoder: its 1 MB WASM is outside the supported syntaxes.
      if (importer !== undefined && source.endsWith('/decodeJPEGXL.js')) return '\0dv-no-jxl';
      return null;
    },
    load(id) {
      if (id === '\0dv-inline-wasm') {
        return `export const wasmFiles = ${JSON.stringify(base64Files)};`;
      }
      if (id === '\0dv-empty') return 'export default {};';
      if (id === '\0dv-url') {
        return 'export const URL = globalThis.URL; export const URLSearchParams = globalThis.URLSearchParams; export default { URL, URLSearchParams };';
      }
      if (id === '\0dv-no-jxl') {
        return [
          'const unsupported = () => Promise.reject(new Error("JPEG XL is not supported by this build."));',
          'export const initialize = unsupported;',
          'export default unsupported;',
        ].join('\n');
      }
      return null;
    },
  };
}

async function bundle(
  entry: 'decode' | 'compute',
  embedded: Record<string, Buffer>,
  inline: boolean,
): Promise<string> {
  const build = await rolldown({
    input: join(packageDir, `workers/${entry}.worker.ts`),
    platform: 'browser',
    plugins: [workerPlugin(embedded)],
    transform: inline
      ? { define: { 'import.meta.url': JSON.stringify(INLINE_IMPORT_META_URL) } }
      : {},
    logLevel: 'warn',
  });
  const { output } = await build.generate({ format: 'esm', codeSplitting: false, minify: true });
  await build.close();
  const [chunk] = output;
  return chunk.code;
}

if (
  process.argv.includes('--if-missing') &&
  existsSync(join(packageDir, 'src/generated/inline-assets.ts'))
) {
  process.exit(0);
}

const wasm = await readWasmFiles();
const urlWorker = await bundle('decode', {}, false);
const inlineWorker = await bundle('decode', wasm, true);
const urlComputeWorker = await bundle('compute', {}, false);
const inlineComputeWorker = await bundle('compute', {}, true);

await rm(join(packageDir, 'assets'), { recursive: true, force: true });
await mkdir(join(packageDir, 'assets/wasm'), { recursive: true });
await writeFile(join(packageDir, 'assets/decode.worker.js'), urlWorker);
await writeFile(join(packageDir, 'assets/compute.worker.js'), urlComputeWorker);
for (const [name, bytes] of Object.entries(wasm)) {
  await writeFile(join(packageDir, 'assets/wasm', name), bytes);
}

await mkdir(join(packageDir, 'src/generated'), { recursive: true });
await writeFile(
  join(packageDir, 'src/generated/inline-assets.ts'),
  [
    '// Generated by scripts/build-workers.ts. Do not edit.',
    `export const inlineDecodeWorkerSource: string = ${JSON.stringify(inlineWorker)};`,
    `export const inlineComputeWorkerSource: string = ${JSON.stringify(inlineComputeWorker)};`,
    '',
  ].join('\n'),
);

const kb = (text: string | Buffer): string => `${(Buffer.byteLength(text) / 1024).toFixed(0)} kB`;
console.log(`decode worker (url):    ${kb(urlWorker)}`);
console.log(`decode worker (inline): ${kb(inlineWorker)}`);
console.log(`compute worker (url):   ${kb(urlComputeWorker)}`);
for (const [name, bytes] of Object.entries(wasm)) console.log(`  wasm ${name}: ${kb(bytes)}`);
