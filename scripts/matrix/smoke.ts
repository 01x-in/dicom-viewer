import { type Browser, chromium, type ConsoleMessage, type Page } from 'playwright';

export type AssetsMode = 'inline' | 'url';

export interface SmokeInput {
  readonly pageUrl: string;
  readonly wadoRoot: string;
  readonly studyUid: string;
  readonly seriesUid: string;
  /** The phantom SEG series, which segments `seriesUid`. */
  readonly segSeriesUid: string;
  readonly assetsMode: AssetsMode;
  /** Where `url` mode serves assets from, relative to the page. */
  readonly assetsPath: string;
  readonly cpuRendering: boolean;
}

export interface SmokeResult {
  readonly failures: string[];
  readonly workerUrls: string[];
}

interface SegmentationHandle {
  readonly segments: readonly { number: number; label: string }[];
  readonly labelmapFrameCount: number;
  sample(sliceIndex: number, row: number, column: number): number;
}

interface ViewSnapshot {
  readonly window: { center: number; width: number };
  readonly defaultWindow: { center: number; width: number };
  readonly invert: boolean;
  readonly zoom: number;
}

interface ViewerHandle {
  readonly imageCount: number;
  getView(): ViewSnapshot | undefined;
  applyWindowPreset(presetId: string): Promise<void>;
  setZoom(zoom: number): Promise<void>;
  readonly cine: {
    play(options?: { fps?: number; loop?: boolean }): Promise<void>;
    stop(): void;
    readonly playing: boolean;
  };
  loadSegmentation(segSeriesInstanceUID: string): Promise<SegmentationHandle>;
  getImageIndex(): number | undefined;
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
export const EXPECTED_HU: readonly { name: string; row: number; column: number; hu: number }[] = [
  { name: 'outside the body', row: 0, column: 0, hu: -1000 },
  { name: 'body', row: 64, column: 64, hu: 40 },
  { name: 'left marker', row: 43, column: 103, hu: 200 },
  { name: 'air insert', row: 36, column: 64, hu: -1000 },
  { name: 'water insert', row: 92, column: 64, hu: 0 },
  { name: 'fat insert', row: 64, column: 36, hu: -100 },
  { name: 'bone insert', row: 64, column: 92, hu: 1000 },
];
export const MID_SLICE_INDEX = 31;

export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env['DV_CHROMIUM'];
  return chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

export function isIgnorableRequest(url: string): boolean {
  return url.endsWith('/favicon.ico');
}

/** Fraction of pixels in the viewport canvas that are not (near) black. */
export async function litFraction(page: Page): Promise<number> {
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
    await page.goto(`${input.pageUrl}?${query.toString()}`, {
      waitUntil: 'load',
      timeout: 180_000,
    });
    await page.waitForFunction(
      () => document.documentElement.dataset['dvStatus'] !== undefined,
      undefined,
      { timeout: 120_000 },
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

    // SEG: parsed by the v5 adapters from one whole-instance retrieval (the only kind the proxy allows).
    const seg = await page.evaluate(async (segSeriesUid) => {
      const handle = await window.__dv?.loadSegmentation(segSeriesUid);
      if (handle === undefined) return undefined;
      return {
        labels: handle.segments.map((segment) => `${segment.number.toString()}:${segment.label}`),
        frames: handle.labelmapFrameCount,
        boneCentre: handle.sample(31, 64, 92),
        bodyCentre: handle.sample(31, 64, 64),
        outside: handle.sample(31, 0, 0),
        boneAbsentOnFirstSlice: handle.sample(0, 64, 92),
      };
    }, input.segSeriesUid);
    if (seg === undefined) {
      failures.push('SEG did not load');
    } else {
      if (seg.labels.join(',') !== '1:Body,2:Bone insert')
        failures.push(`SEG segments are ${seg.labels.join(',')}`);
      if (seg.frames !== 64)
        failures.push(`SEG labelmap has ${seg.frames.toString()} frames, expected 64`);
      if (seg.boneCentre !== 2)
        failures.push(`SEG bone insert pixel is ${seg.boneCentre.toString()}, expected 2`);
      if (seg.bodyCentre !== 1)
        failures.push(`SEG body pixel is ${seg.bodyCentre.toString()}, expected 1`);
      if (seg.outside !== 0)
        failures.push(`SEG background pixel is ${seg.outside.toString()}, expected 0`);
      if (seg.boneAbsentOnFirstSlice !== 1)
        failures.push(
          `SEG first-slice pixel is ${seg.boneAbsentOnFirstSlice.toString()}, expected 1`,
        );
    }

    // Real input must reach Cornerstone's tool group through the host's DOM (light DOM, no shadow root).
    const box = await page.locator('canvas').first().boundingBox();
    if (box === null) throw new Error('the viewport has no canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(500);
    const afterWheel = await page.evaluate(() => window.__dv?.getImageIndex());
    if (afterWheel === 10 || afterWheel === undefined) {
      failures.push(`mouse wheel did not scroll the stack (still on ${String(afterWheel)})`);
    }

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
  } catch (error) {
    // A rejected probe (decode, network, or SEG parse) is a result for this variant, not a reason to
    // abort the whole matrix.
    failures.push(`smoke aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
  return { failures, workerUrls };
}
