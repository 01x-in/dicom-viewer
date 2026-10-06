// Shared by the scenarios of examples/headless: the input every one gets, a page that records what
// went wrong in it, and the steps every scenario starts with.
import type { Browser, ConsoleMessage, Page } from 'playwright';
import type { MockServer } from '../../tools/dicomweb-mock/src/server.ts';
import { type AssetsMode, isIgnorableRequest } from './smoke.ts';

declare global {
  interface Window {
    __dvGl?: WeakRef<WebGLRenderingContext | WebGL2RenderingContext>[];
  }
}

export interface HeadlessInput {
  readonly pageUrl: string;
  readonly mock: MockServer;
  /** A second mock that answers 401 until it has accepted the bearer token. */
  readonly authMock: MockServer;
  readonly studyUid: string;
  readonly j2kSeriesUid: string;
  readonly evrleSeriesUid: string;
  readonly segSeriesUid: string;
  readonly assetsMode: AssetsMode;
  readonly assetsPath: string;
  readonly fixturesDir: string;
  readonly cycles: number;
  readonly perf: PerfInput;
}

/** The large SEG of the performance budget: generated on demand, and served by a mock of its own. */
export interface PerfInput {
  readonly mock: MockServer;
  readonly studyUid: string;
  readonly ctSeriesUid: string;
  readonly segSeriesUid: string;
}

export interface ScenarioResult {
  readonly scenario: string;
  readonly failures: string[];
}

export interface Watched {
  readonly page: Page;
  readonly failures: string[];
  readonly workerUrls: string[];
  /** Responses with these statuses are expected in this scenario (and their console echo). */
  expectStatus(...statuses: number[]): void;
  close(): Promise<void>;
}

export async function watch(browser: Browser, trackGl = false): Promise<Watched> {
  const failures: string[] = [];
  const workerUrls: string[] = [];
  const expected = new Set<number>();
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const page = await context.newPage();
  if (trackGl) {
    // Remember every WebGL context so a leak shows up as one that is still alive after the viewers are gone.
    await page.addInitScript(() => {
      window.__dvGl = [];
      for (const prototype of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype]) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- it is called with the right `this` below
        const original = prototype.getContext as (this: unknown, ...args: unknown[]) => unknown;
        (prototype as { getContext: unknown }).getContext = function (
          this: unknown,
          ...args: unknown[]
        ): unknown {
          const result = original.apply(this, args);
          if (
            typeof WebGLRenderingContext !== 'undefined' &&
            (result instanceof WebGLRenderingContext ||
              (typeof WebGL2RenderingContext !== 'undefined' &&
                result instanceof WebGL2RenderingContext))
          ) {
            window.__dvGl?.push(new WeakRef(result));
          }
          return result;
        };
      }
    });
  }
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (message.type() === 'error') {
      // The browser echoes every failed request to the console; expected ones are checked via their response.
      const echoed = /status of (\d{3})/.exec(text);
      if (echoed?.[1] !== undefined && expected.has(Number(echoed[1]))) return;
      failures.push(`console error: ${text}`);
    } else if (message.type() === 'warning' && /too many active webgl contexts/i.test(text)) {
      failures.push(`console warning: ${text}`);
    }
  });
  page.on('pageerror', (error) => failures.push(`uncaught: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (!isIgnorableRequest(request.url())) {
      failures.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? '?'})`);
    }
  });
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      !expected.has(response.status()) &&
      !isIgnorableRequest(response.url())
    ) {
      failures.push(`HTTP ${response.status().toString()}: ${response.url()}`);
    }
  });
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  return {
    page,
    failures,
    workerUrls,
    expectStatus: (...statuses) => {
      for (const status of statuses) expected.add(status);
    },
    close: () => context.close(),
  };
}

export function query(input: HeadlessInput, extra: Record<string, string>): string {
  const params = new URLSearchParams({ ...extra });
  if (input.assetsMode === 'url') params.set('assets', input.assetsPath);
  return `${input.pageUrl}?${params.toString()}`;
}

export async function waitForStatus(page: Page, ...statuses: string[]): Promise<string> {
  // Generous: 20 viewers one after another take a while on a shared CI runner.
  await page.waitForFunction(
    (wanted) => wanted.includes(document.documentElement.dataset['dvStatus'] ?? ''),
    statuses,
    { timeout: 300_000 },
  );
  return page.evaluate(() => document.documentElement.dataset['dvStatus'] ?? '');
}

export async function expectReady(watched: Watched): Promise<boolean> {
  const status = await waitForStatus(watched.page, 'ready', 'error');
  if (status === 'ready') return true;
  watched.failures.push(
    `viewer failed: ${await watched.page.evaluate(() => window.__dvError ?? 'unknown')}`,
  );
  return false;
}
