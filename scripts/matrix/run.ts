// Installability matrix: builds each example from the packed tarballs, serves the production build
// (or the dev server with --dev), and runs the browser smoke test against the dicomweb-mock in
// OncoTrace-proxy mode.
//
//   node scripts/matrix/run.ts [--only <variant>] [--keep] [--dev]
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { startMockServer } from '../../tools/dicomweb-mock/src/server.ts';
import { smokeHeadless } from './headless.ts';
import { smokeConfig } from './config.ts';
import { smokeShell } from './shell.ts';
import { fileBytes, kib, measureJavaScript, sizeOf, total, type FileSize } from './measure.ts';
import { packTarballs, type Tarballs } from './pack.ts';
import { launchBrowser, smoke } from './smoke.ts';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Variant {
  readonly name: string;
  readonly example: string;
  readonly buildScript: string;
  /** Starts the framework's dev server (`--dev`). */
  readonly devScript: string;
  /** Server-rendered frameworks: the server's stderr must stay clean. */
  readonly ssr: boolean;
  readonly port: number;
  /** Where the production build puts the JavaScript hosts ship to browsers, relative to the project. */
  readonly jsDir: string;
  /** Where `viewer-assets copy` put the worker and WASM files, relative to the project. */
  readonly assetsDir: string;
  /** `headless` runs the M2 scenarios (links, auth, retries, local files, leaks) instead of the packaging smoke test. */
  readonly scenarios?: 'headless';
}

const VARIANTS: readonly Variant[] = [
  {
    name: 'vanilla',
    example: 'vanilla',
    buildScript: 'build',
    devScript: 'dev',
    ssr: false,
    port: 4101,
    jsDir: 'dist/assets',
    assetsDir: 'dist/viewer-assets',
  },
  {
    name: 'headless',
    example: 'headless',
    buildScript: 'build',
    devScript: 'dev',
    ssr: false,
    port: 4107,
    jsDir: 'dist/assets',
    assetsDir: 'dist/viewer-assets',
    scenarios: 'headless',
  },
  {
    name: 'vite-react',
    example: 'vite-react',
    buildScript: 'build',
    devScript: 'dev',
    ssr: false,
    port: 4102,
    jsDir: 'dist/assets',
    assetsDir: 'dist/viewer-assets',
  },
  {
    name: 'vite-vue',
    example: 'vite-vue',
    buildScript: 'build',
    devScript: 'dev',
    ssr: false,
    port: 4103,
    jsDir: 'dist/assets',
    assetsDir: 'dist/viewer-assets',
  },
  {
    name: 'next-turbopack',
    example: 'next-app',
    buildScript: 'build:turbopack',
    devScript: 'dev:turbopack',
    ssr: true,
    port: 4104,
    jsDir: '.next/static/chunks',
    assetsDir: 'public/viewer-assets',
  },
  {
    name: 'next-webpack',
    example: 'next-app',
    buildScript: 'build:webpack',
    devScript: 'dev:webpack',
    ssr: true,
    port: 4105,
    jsDir: '.next/static/chunks',
    assetsDir: 'public/viewer-assets',
  },
  {
    name: 'nuxt',
    example: 'nuxt',
    buildScript: 'build',
    devScript: 'dev',
    ssr: true,
    port: 4106,
    jsDir: '.output/public/_nuxt',
    assetsDir: '.output/public/viewer-assets',
  },
];

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    cycles: { type: 'string', default: '20' },
    keep: { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
  },
});

function tarballOverrides(tarballs: Tarballs): Record<string, string> {
  return {
    '@scope/viewer-core': `file:${tarballs.core}`,
    '@scope/viewer-elements': `file:${tarballs.elements}`,
    '@scope/viewer-react': `file:${tarballs.react}`,
    '@scope/viewer-vue': `file:${tarballs.vue}`,
  };
}

async function prepare(variant: Variant, tarballs: Tarballs): Promise<string> {
  const target = join(root, '.matrix', variant.name);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, 'examples', variant.example), target, {
    recursive: true,
    filter: (source) => !/\/(node_modules|dist|\.next|\.nuxt|\.output)(\/|$)/.test(source),
  });
  const overrides = tarballOverrides(tarballs);
  const manifestPath = join(target, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const tarball = overrides[name];
    if (tarball !== undefined && manifest.dependencies !== undefined) {
      manifest.dependencies[name] = tarball;
    }
  }
  manifest.pnpm = { ...manifest.pnpm, overrides: { ...manifest.pnpm?.overrides, ...overrides } };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited with ${String(server.exitCode)}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`server did not answer at ${url}`);
}

interface Row {
  readonly variant: string;
  readonly mode: string;
  readonly failures: string[];
}

interface Measurement {
  readonly variant: string;
  readonly javascript: readonly FileSize[];
  readonly assets: readonly FileSize[];
}

type Mock = Awaited<ReturnType<typeof startMockServer>>;

const PERF_FIXTURES = join(root, '.matrix/perf-fixtures');

/** The SEG of the performance budget is 300 MB, so it is generated here, once, and never committed. */
async function ensurePerfFixtures(): Promise<void> {
  if (existsSync(join(PERF_FIXTURES, 'seg-perf/0001.dcm'))) return;
  console.log('== generating the large SEG of the performance budget (tools/phantom/perf.py)');
  await exec('uv', ['run', '--frozen', 'python', 'perf.py', PERF_FIXTURES], {
    cwd: join(root, 'tools/phantom'),
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function runVariant(
  variant: Variant,
  tarballs: Tarballs,
  mock: Mock,
  authMock: Mock,
  perfMock: Mock | undefined,
): Promise<{ rows: Row[]; measurement: Measurement }> {
  console.log(`\n== ${variant.name}: install`);
  const dir = await prepare(variant, tarballs);
  await exec('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], {
    cwd: dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!values.dev) {
    console.log(`== ${variant.name}: build`);
    await exec('pnpm', ['run', variant.buildScript], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  }
  const assetsRoot = join(dir, variant.assetsDir);
  const measurement: Measurement = values.dev
    ? { variant: variant.name, javascript: [], assets: [] }
    : {
        variant: variant.name,
        javascript: (await measureJavaScript(join(dir, variant.jsDir))).filter(
          (item) => !join(dir, variant.jsDir, item.name).startsWith(assetsRoot),
        ),
        assets: [
          await sizeOf(join(assetsRoot, 'decode.worker.js'), 'decode.worker.js'),
          await sizeOf(join(assetsRoot, 'compute.worker.js'), 'compute.worker.js'),
          ...(await Promise.all(
            [
              'openjpegwasm_decode',
              'libjpegturbowasm_decode',
              'charlswasm_decode',
              'openjphjs',
            ].map((name) => sizeOf(join(assetsRoot, 'wasm', `${name}.wasm`), `wasm/${name}.wasm`)),
          )),
        ],
      };

  const server = spawn('pnpm', ['run', values.dev ? variant.devScript : 'serve'], {
    cwd: dir,
    env: { ...process.env, PORT: String(variant.port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' },
    // Own process group, so the whole tree (pnpm, then the framework's server) can be stopped.
    detached: true,
  });
  let serverErrors = '';
  server.stderr.on('data', (chunk: Buffer) => {
    serverErrors += chunk.toString();
  });
  const rows: Row[] = [];
  const browser = await launchBrowser();
  try {
    const pageUrl = `http://127.0.0.1:${variant.port.toString()}/`;
    await waitForServer(pageUrl, server);
    const study = mock.fixtures.studyUids[0] ?? '';
    const series = mock.fixtures.series.find((item) => item.description.includes('ct-j2k'));
    const segSeries = mock.fixtures.series.find((item) =>
      item.description.includes('seg-body-bone'),
    );
    if (series === undefined || segSeries === undefined) throw new Error('phantom series missing');
    const evrle = mock.fixtures.series.find((item) => item.description.includes('ct-evrle'));
    for (const mode of ['inline', 'url'] as const) {
      console.log(`== ${variant.name}: smoke (${mode})`);
      mock.requestLog.length = 0;
      if (variant.scenarios === 'headless') {
        if (evrle === undefined || perfMock === undefined)
          throw new Error('phantom series missing');
        const perfCt = perfMock.fixtures.series.find((item) => item.modality === 'CT');
        const perfSeg = perfMock.fixtures.series.find((item) => item.modality === 'SEG');
        if (perfCt === undefined || perfSeg === undefined) throw new Error('perf series missing');
        const results = await smokeHeadless(browser, {
          perf: {
            mock: perfMock,
            studyUid: perfCt.studyUid,
            ctSeriesUid: perfCt.seriesUid,
            segSeriesUid: perfSeg.seriesUid,
          },
          pageUrl,
          mock,
          authMock,
          studyUid: study,
          j2kSeriesUid: series.seriesUid,
          evrleSeriesUid: evrle.seriesUid,
          segSeriesUid: segSeries.seriesUid,
          assetsMode: mode,
          assetsPath: '/viewer-assets',
          fixturesDir: join(root, 'fixtures/phantom'),
          cycles: Number(values.cycles),
        });
        for (const item of results) {
          rows.push({
            variant: variant.name,
            mode: `${mode}: ${item.scenario}`,
            failures: item.failures,
          });
        }
        continue;
      }
      const result = await smoke(browser, {
        pageUrl,
        wadoRoot: mock.url,
        studyUid: study,
        seriesUid: series.seriesUid,
        segSeriesUid: segSeries.seriesUid,
        assetsMode: mode,
        assetsPath: '/viewer-assets',
        cpuRendering: false,
      });
      const failures = [...result.failures];
      for (const entry of mock.requestLog) {
        if (entry.status >= 400)
          failures.push(`mock saw ${entry.status.toString()} for ${entry.path}`);
      }
      if (variant.ssr && !values.dev && /error/i.test(serverErrors))
        failures.push(`server errors:\n${serverErrors}`);
      rows.push({ variant: variant.name, mode, failures });
      mock.requestLog.length = 0;
      const shellFailures = await smokeShell(browser, {
        pageUrl,
        wadoRoot: mock.url,
        studyUid: study,
        seriesUid: series.seriesUid,
        segSeriesUid: segSeries.seriesUid,
        assetsMode: mode,
        assetsPath: '/viewer-assets',
        cpuRendering: false,
      });
      rows.push({ variant: variant.name, mode: `${mode}: shell`, failures: shellFailures });
      mock.requestLog.length = 0;
      const configFailures = await smokeConfig(browser, {
        pageUrl,
        wadoRoot: mock.url,
        studyUid: study,
        seriesUid: series.seriesUid,
        segSeriesUid: segSeries.seriesUid,
        assetsMode: mode,
        assetsPath: '/viewer-assets',
        cpuRendering: false,
        configUrl: `${mock.url}/viewer-config.json`,
      });
      rows.push({ variant: variant.name, mode: `${mode}: config`, failures: configFailures });
    }
  } finally {
    await browser.close();
    if (server.pid !== undefined) process.kill(-server.pid, 'SIGTERM');
    if (!values.keep) await rm(dir, { recursive: true, force: true });
  }
  return { rows, measurement };
}

const selected = VARIANTS.filter((item) => values.only === undefined || item.name === values.only);
if (selected.length === 0) {
  // A typo must not look like a pass: nothing would run and the exit code would be 0.
  console.error(
    `Unknown --only "${values.only ?? ''}". Choose one of: ${VARIANTS.map((item) => item.name).join(', ')}`,
  );
  process.exit(2);
}

const tarballs = await packTarballs(root);
const mock = await startMockServer({
  fixturesDir: join(root, 'fixtures/phantom'),
  mode: 'oncotrace-proxy',
  port: 8042,
  // The settings file the config scenario fetches, from the same server as the images.
  jsonFiles: { '/viewer-config.json': join(root, 'examples/viewer-config.json') },
});
// Answers 401 until a test has accepted the bearer token it is sent.
const authMock = await startMockServer({
  fixturesDir: join(root, 'fixtures/phantom'),
  mode: 'oncotrace-proxy',
  port: 8043,
  auth: true,
}).catch(async (error: unknown) => {
  // A busy port must not leave the first server open, or the command never exits.
  await mock.close();
  throw error;
});
const rows: Row[] = [];
const measurements: Measurement[] = [];
let perfMock: Mock | undefined;
try {
  if (selected.some((item) => item.scenarios === 'headless')) {
    await ensurePerfFixtures();
    perfMock = await startMockServer({ fixturesDir: PERF_FIXTURES, mode: 'open', port: 8044 });
  }
  for (const variant of selected) {
    const result = await runVariant(variant, tarballs, mock, authMock, perfMock);
    rows.push(...result.rows);
    measurements.push(result.measurement);
  }
} finally {
  await mock.close();
  await authMock.close();
  await perfMock?.close();
}

async function writeSizeReport(): Promise<void> {
  const lines: string[] = [
    '# Bundle sizes',
    '',
    'Generated by `pnpm matrix` (scripts/matrix/run.ts) from the packed tarballs. Sizes are of the production',
    'build each framework produces, with no bundler configuration. Do not edit by hand.',
    '',
    '## Packed tarballs',
    '',
    '| Package | Packed (.tgz) |',
    '|---|---|',
  ];
  const packed: readonly (readonly [string, string])[] = [
    ['core', tarballs.core],
    ['elements', tarballs.elements],
    ['react', tarballs.react],
    ['vue', tarballs.vue],
  ];
  for (const [name, path] of packed) {
    lines.push(`| @scope/viewer-${name} | ${kib(await fileBytes(path))} |`);
  }
  lines.push(
    '',
    '## Client JavaScript per example',
    '',
    'All JavaScript the production build emits for the browser, including the lazily loaded engine chunk',
    '(Cornerstone, vtk.js, tools, adapters) and, in inline mode, the embedded worker sources.',
    '',
    '| Example | Files | Total raw | Total gzip | Total brotli | Largest chunk (raw / brotli) |',
    '|---|---|---|---|---|---|',
  );
  for (const item of measurements) {
    const sum = total(item.javascript);
    const [largest] = item.javascript;
    lines.push(
      `| ${item.variant} | ${item.javascript.length.toString()} | ${kib(sum.raw)} | ${kib(sum.gzip)} | ${kib(sum.brotli)} | ${largest === undefined ? '-' : `${kib(largest.raw)} / ${kib(largest.brotli)}`} |`,
    );
  }
  const reference = measurements[0];
  if (reference !== undefined) {
    lines.push(
      '',
      '## `url` mode assets',
      '',
      'Served from `public/viewer-assets` (copied by `viewer-assets copy`). Identical in every example.',
      '',
      '| File | Raw | gzip | brotli |',
      '|---|---|---|---|',
    );
    for (const asset of reference.assets) {
      lines.push(
        `| ${asset.name} | ${kib(asset.raw)} | ${kib(asset.gzip)} | ${kib(asset.brotli)} |`,
      );
    }
    const sum = total(reference.assets);
    lines.push(`| **total** | ${kib(sum.raw)} | ${kib(sum.gzip)} | ${kib(sum.brotli)} |`);
  }
  lines.push('');
  await writeFile(join(root, 'docs/m1-bundle-sizes.md'), lines.join('\n'));
}

if (!values.dev && values.only === undefined && rows.every((row) => row.failures.length === 0)) {
  await writeSizeReport();
  console.log('\nWrote docs/m1-bundle-sizes.md');
}

console.log('\n== Results');
for (const row of rows) {
  console.log(`${row.failures.length === 0 ? 'PASS' : 'FAIL'}  ${row.variant} (${row.mode})`);
  for (const failure of row.failures) console.log(`      ${failure}`);
}
process.exitCode = rows.some((row) => row.failures.length > 0) ? 1 : 0;
