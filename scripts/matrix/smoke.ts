import { type Browser, chromium, type ConsoleMessage, type Page } from 'playwright';

export type AssetsMode = 'inline' | 'url';

export interface SmokeInput {
  readonly pageUrl: string;
  readonly wadoRoot: string;
  readonly studyUid: string;
  readonly seriesUid: string;
  readonly assetsMode: AssetsMode;
  /** Where `url` mode serves assets from, relative to the page. */
  readonly assetsPath: string;
  readonly cpuRendering: boolean;
}

export interface SmokeResult {
  readonly failures: string[];
  readonly workerUrls: string[];
}

interface ViewerHandle {
  readonly imageCount: number;
  getImageIndex(): number;
  setImageIndex(index: number): Promise<void>;
  sampleHu(imageIndex: number, row: number, column: number): Promise<number>;
}

declare global {
  interface Window {
    __dv?: ViewerHandle;
    __dvError?: string;
  }
}

/** Exact Hounsfield values the phantom guarantees at slice 32 (see fixtures/phantom/README.md). */
const EXPECTED_HU: readonly { name: string; row: number; column: number; hu: number }[] = [
  { name: 'outside the body', row: 0, column: 0, hu: -1000 },
  { name: 'body', row: 64, column: 64, hu: 40 },
  { name: 'left marker', row: 43, column: 103, hu: 200 },
  { name: 'air insert', row: 36, column: 64, hu: -1000 },
  { name: 'water insert', row: 92, column: 64, hu: 0 },
  { name: 'fat insert', row: 64, column: 36, hu: -100 },
  { name: 'bone insert', row: 64, column: 92, hu: 1000 },
];
const MID_SLICE_INDEX = 31;

export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env['DV_CHROMIUM'];
  return chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

function isIgnorableRequest(url: string): boolean {
  return url.endsWith('/favicon.ico');
}

/** Fraction of pixels in the viewport canvas that are not (near) black. */
async function litFraction(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null || canvas.width === 0) return 0;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (context === null) return 0;
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    let lit = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0) > 30) lit += 1;
    }
    return lit / (data.length / 4);
  });
}

export async function smoke(browser: Browser, input: SmokeInput): Promise<SmokeResult> {
  const failures: string[] = [];
  const workerUrls: string[] = [];
  const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
  const page = await context.newPage();

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`uncaught: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (!isIgnorableRequest(request.url())) {
      failures.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? '?'})`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !isIgnorableRequest(response.url())) {
      failures.push(`HTTP ${response.status().toString()}: ${response.url()}`);
    }
  });
  page.on('worker', (worker) => workerUrls.push(worker.url()));

  const query = new URLSearchParams({
    wadoRoot: input.wadoRoot,
    study: input.studyUid,
    series: input.seriesUid,
  });
  if (input.assetsMode === 'url') query.set('assets', input.assetsPath);
  if (input.cpuRendering) query.set('cpu', '1');

  try {
    await page.goto(`${input.pageUrl}?${query.toString()}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.documentElement.dataset['dvStatus'] !== undefined,
      undefined,
      { timeout: 60_000 },
    );
    const status = await page.evaluate(() => document.documentElement.dataset['dvStatus']);
    if (status !== 'ready') {
      failures.push(`viewer failed: ${await page.evaluate(() => window.__dvError ?? 'unknown')}`);
      return { failures, workerUrls };
    }

    const imageCount = await page.evaluate(() => window.__dv?.imageCount ?? 0);
    if (imageCount !== 64) failures.push(`expected 64 images, got ${imageCount.toString()}`);

    for (const probe of EXPECTED_HU) {
      const hu = await page.evaluate(
        ([index, row, column]) => window.__dv?.sampleHu(index, row, column) ?? Number.NaN,
        [MID_SLICE_INDEX, probe.row, probe.column] as const,
      );
      if (hu !== probe.hu)
        failures.push(
          `J2K decode: ${probe.name} is ${String(hu)} HU, expected ${probe.hu.toString()}`,
        );
    }

    await page.evaluate(() => window.__dv?.setImageIndex(10));
    const index = await page.evaluate(() => window.__dv?.getImageIndex());
    if (index !== 10) failures.push(`scrolling to slice 11 left the viewport on ${String(index)}`);

    // Rendering is asynchronous after setImageIdIndex resolves; give it a couple of frames.
    await page.waitForTimeout(500);
    const lit = await litFraction(page);
    if (lit < 0.05) failures.push(`viewport looks blank (${(lit * 100).toFixed(1)}% lit pixels)`);

    const expectedWorker =
      input.assetsMode === 'inline' ? 'blob:' : `${input.assetsPath}/decode.worker.js`;
    if (!workerUrls.some((url) => url.includes(expectedWorker) || url.startsWith(expectedWorker))) {
      failures.push(
        `no decode worker started from ${expectedWorker} (saw ${workerUrls.join(', ') || 'none'})`,
      );
    }
  } finally {
    await context.close();
  }
  return { failures, workerUrls };
}
