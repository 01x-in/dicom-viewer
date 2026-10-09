// Visual regression: builds the vanilla example from the packed tarballs, opens it against the phantom, and
// compares a screenshot of each scene with its baseline (scripts/visual/baselines/<scene>.png).
//
//   node scripts/visual/run.ts [--update] [--only <scene>]
//
// Pictures depend on the fonts and the browser build, so baselines are made, and compared, in the pinned
// Playwright image (see docs/guides/visual-regression.md). A baseline that is missing is reported, and fails the
// run only with DV_VISUAL_STRICT=1.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Page } from 'playwright';
import { startMockServer } from '../../tools/dicomweb-mock/src/server.ts';
import { prepareExample, waitForServer } from '../matrix/example.ts';
import { packTarballs } from '../matrix/pack.ts';
import { launchBrowser } from '../matrix/smoke.ts';
import { type PhantomIds, SCENES, type SceneContext } from './scenes.ts';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINES = join(root, 'scripts/visual/baselines');
const OUTPUT = join(root, '.visual');
const PORT = 4121;
const MOCK_PORT = 8052;
const SIZE = { width: 1200, height: 800 } as const;

/** The share of pixels that may differ (anti-aliasing and the like) before a scene fails. */
const MAX_DIFF_RATIO = Number(process.env['DV_VISUAL_MAX_DIFF'] ?? '0.002');
const STRICT = process.env['DV_VISUAL_STRICT'] === '1';

const { values } = parseArgs({
  options: {
    update: { type: 'boolean', default: false },
    only: { type: 'string' },
  },
});

type Verdict = 'pass' | 'fail' | 'new' | 'updated';

interface Result {
  readonly scene: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

async function snapshot(page: Page): Promise<Buffer> {
  return page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
}

async function settle(page: Page): Promise<void> {
  let previous: Buffer | undefined;
  for (let tries = 0; tries < 60; tries += 1) {
    await page.waitForTimeout(400);
    const current = await snapshot(page);
    if (previous?.equals(current) === true) return;
    previous = current;
  }
  throw new Error('the picture never stopped changing');
}

function compare(actual: Buffer, baseline: Buffer): { ratio: number; diff: Buffer } | string {
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(baseline);
  if (a.width !== b.width || a.height !== b.height) {
    return `the picture is ${a.width.toString()}x${a.height.toString()}, the baseline ${b.width.toString()}x${b.height.toString()}`;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const count = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  return { ratio: count / (a.width * a.height), diff: PNG.sync.write(diff) };
}

async function check(scene: string, actual: Buffer): Promise<Result> {
  await mkdir(join(OUTPUT, 'actual'), { recursive: true });
  await writeFile(join(OUTPUT, 'actual', `${scene}.png`), actual);
  const baselinePath = join(BASELINES, `${scene}.png`);
  if (values.update) {
    await mkdir(BASELINES, { recursive: true });
    await writeFile(baselinePath, actual);
    return { scene, verdict: 'updated', detail: 'baseline written' };
  }
  if (!existsSync(baselinePath)) {
    return {
      scene,
      verdict: STRICT ? 'fail' : 'new',
      detail: 'no baseline (the picture is in .visual/actual)',
    };
  }
  const outcome = compare(actual, await readFile(baselinePath));
  if (typeof outcome === 'string') return { scene, verdict: 'fail', detail: outcome };
  if (outcome.ratio > MAX_DIFF_RATIO) {
    await mkdir(join(OUTPUT, 'diff'), { recursive: true });
    await writeFile(join(OUTPUT, 'diff', `${scene}.png`), outcome.diff);
    return {
      scene,
      verdict: 'fail',
      detail: `${(outcome.ratio * 100).toFixed(3)}% of the pixels differ (limit ${(MAX_DIFF_RATIO * 100).toFixed(3)}%); see .visual/diff`,
    };
  }
  return { scene, verdict: 'pass', detail: `${(outcome.ratio * 100).toFixed(3)}% differ` };
}

const scenes = SCENES.filter((scene) => values.only === undefined || scene.name === values.only);
if (scenes.length === 0) {
  console.error(
    `Unknown --only "${values.only ?? ''}". Choose one of: ${SCENES.map((scene) => scene.name).join(', ')}`,
  );
  process.exit(2);
}

await rm(OUTPUT, { recursive: true, force: true });
const tarballs = await packTarballs(root);
const mock = await startMockServer({
  fixturesDir: join(root, 'fixtures/phantom'),
  mode: 'open',
  port: MOCK_PORT,
});
const results: Result[] = [];
let server: ReturnType<typeof spawn> | undefined;
let dir: string | undefined;
try {
  const found = (name: string): { studyUid: string; seriesUid: string } => {
    const series = mock.fixtures.series.find((item) => item.description.includes(name));
    if (series === undefined) throw new Error(`the phantom has no ${name}`);
    return series;
  };
  const ct = found('ct-j2k');
  const tilted = found('ct-tilted');
  const ids: PhantomIds = {
    study: ct.studyUid,
    ct: ct.seriesUid,
    seg: found('seg-body-bone').seriesUid,
    tilted: { study: tilted.studyUid, series: tilted.seriesUid },
  };

  console.log('== visual: install and build the vanilla example from the tarballs');
  dir = await prepareExample(root, 'visual', 'vanilla', tarballs);
  await exec('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], {
    cwd: dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  await exec('pnpm', ['run', 'build'], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
  server = spawn('pnpm', ['run', 'serve'], {
    cwd: dir,
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
  });
  const pageUrl = `http://127.0.0.1:${PORT.toString()}/`;
  await waitForServer(pageUrl, server);

  const browser = await launchBrowser();
  try {
    for (const scene of scenes) {
      console.log(`== visual: ${scene.name}`);
      const context = await browser.newContext({
        viewport: SIZE,
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        locale: 'en-US',
        timezoneId: 'UTC',
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const sceneContext: SceneContext = {
        page,
        ids,
        settle: () => settle(page),
        open: async (options = {}) => {
          const params = new URLSearchParams({ fill: '' });
          if (options.empty !== true) {
            params.set('wadoRoot', mock.url);
            params.set('study', options.study ?? ids.study);
            params.set('series', options.series ?? ids.ct);
          }
          await page.goto(`${pageUrl}?${params.toString()}`, {
            waitUntil: 'load',
            timeout: 180_000,
          });
          if (options.empty !== true) {
            await page.waitForFunction(
              () => document.documentElement.dataset['dvStatus'] === 'ready',
              undefined,
              { timeout: 180_000 },
            );
          } else {
            await page.waitForSelector('dv-viewer');
          }
        },
      };
      try {
        await scene.run(sceneContext);
        if (errors.length > 0) throw new Error(`page error: ${errors.join('; ')}`);
        results.push(await check(scene.name, await snapshot(page)));
      } catch (error) {
        results.push({
          scene: scene.name,
          verdict: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  await mock.close();
  if (server?.pid !== undefined) process.kill(-server.pid, 'SIGTERM');
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
}

console.log('\n== Results');
for (const result of results) {
  console.log(`${result.verdict.toUpperCase().padEnd(7)} ${result.scene}: ${result.detail}`);
}
process.exitCode = results.some((result) => result.verdict === 'fail') ? 1 : 0;
