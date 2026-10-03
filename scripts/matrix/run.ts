// Installability matrix: builds each example from the packed tarballs, serves the production build,
// and runs the browser smoke test against the dicomweb-mock in OncoTrace-proxy mode.
//
//   node scripts/matrix/run.ts [--only <variant>] [--keep]
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { startMockServer } from '../../tools/dicomweb-mock/src/server.ts';
import { packTarballs, type Tarballs } from './pack.ts';
import { type AssetsMode, launchBrowser, smoke } from './smoke.ts';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Variant {
  readonly name: string;
  readonly example: string;
  readonly buildScript: string;
  /** Server-rendered frameworks: the server's stderr must stay clean. */
  readonly ssr: boolean;
  readonly port: number;
}

const VARIANTS: readonly Variant[] = [
  { name: 'vanilla', example: 'vanilla', buildScript: 'build', ssr: false, port: 4101 },
  { name: 'vite-react', example: 'vite-react', buildScript: 'build', ssr: false, port: 4102 },
  { name: 'vite-vue', example: 'vite-vue', buildScript: 'build', ssr: false, port: 4103 },
  {
    name: 'next-turbopack',
    example: 'next-app',
    buildScript: 'build:turbopack',
    ssr: true,
    port: 4104,
  },
  {
    name: 'next-webpack',
    example: 'next-app',
    buildScript: 'build:webpack',
    ssr: true,
    port: 4105,
  },
  { name: 'nuxt', example: 'nuxt', buildScript: 'build', ssr: true, port: 4106 },
];

const { values } = parseArgs({
  options: { only: { type: 'string' }, keep: { type: 'boolean', default: false } },
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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited with ${String(server.exitCode)}`);
    try {
      const response = await fetch(url);
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
  readonly mode: AssetsMode;
  readonly failures: string[];
}

async function runVariant(
  variant: Variant,
  tarballs: Tarballs,
  mock: Awaited<ReturnType<typeof startMockServer>>,
): Promise<Row[]> {
  console.log(`\n== ${variant.name}: install`);
  const dir = await prepare(variant, tarballs);
  await exec('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], {
    cwd: dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  console.log(`== ${variant.name}: build`);
  await exec('pnpm', ['run', variant.buildScript], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });

  const server = spawn('pnpm', ['run', 'serve'], {
    cwd: dir,
    env: { ...process.env, PORT: String(variant.port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' },
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
    if (series === undefined) throw new Error('phantom J2K series missing');
    for (const mode of ['inline', 'url'] as const) {
      console.log(`== ${variant.name}: smoke (${mode})`);
      mock.requestLog.length = 0;
      const result = await smoke(browser, {
        pageUrl,
        wadoRoot: mock.url,
        studyUid: study,
        seriesUid: series.seriesUid,
        assetsMode: mode,
        assetsPath: '/viewer-assets',
        cpuRendering: false,
      });
      const failures = [...result.failures];
      for (const entry of mock.requestLog) {
        if (entry.status >= 400)
          failures.push(`mock saw ${entry.status.toString()} for ${entry.path}`);
      }
      if (variant.ssr && /error/i.test(serverErrors))
        failures.push(`server errors:\n${serverErrors}`);
      rows.push({ variant: variant.name, mode, failures });
    }
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    if (!values.keep) await rm(dir, { recursive: true, force: true });
  }
  return rows;
}

const tarballs = await packTarballs(root);
const mock = await startMockServer({
  fixturesDir: join(root, 'fixtures/phantom'),
  mode: 'oncotrace-proxy',
  port: 8042,
});
const rows: Row[] = [];
try {
  for (const variant of VARIANTS.filter(
    (item) => values.only === undefined || item.name === values.only,
  )) {
    rows.push(...(await runVariant(variant, tarballs, mock)));
  }
} finally {
  await mock.close();
}

console.log('\n== Results');
for (const row of rows) {
  console.log(`${row.failures.length === 0 ? 'PASS' : 'FAIL'}  ${row.variant} (${row.mode})`);
  for (const failure of row.failures) console.log(`      ${failure}`);
}
process.exitCode = rows.some((row) => row.failures.length > 0) ? 1 : 0;
