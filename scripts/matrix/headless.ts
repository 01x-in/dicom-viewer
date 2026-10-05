// Scenarios for examples/headless, the M2 "headless vanilla example": a study loaded by UID,
// scrolling, a link that restores the view, token refresh, retries, local files, and a leak check.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type CDPSession, type ConsoleMessage, type Page } from 'playwright';
import type { MockServer } from '../../tools/dicomweb-mock/src/server.ts';
import {
  type AssetsMode,
  EXPECTED_HU,
  isIgnorableRequest,
  litFraction,
  MID_SLICE_INDEX,
} from './smoke.ts';

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
}

export interface ScenarioResult {
  readonly scenario: string;
  readonly failures: string[];
}

interface ViewerHandle {
  getState(): {
    studyInstanceUID?: string;
    viewports: {
      id: string;
      seriesInstanceUID?: string;
      stackIndex?: number;
      imageIndex?: number;
      window?: { center: number; width: number };
      invert?: boolean;
      zoom?: number;
    }[];
  };
  navigateTo(target: {
    seriesInstanceUID: string;
    sopInstanceUID: string;
  }): Promise<{ imageIndex: number; stackIndex: number; sopInstanceUID: string }>;
}

interface SourceHandle {
  getSeries(
    study: string,
    series: string,
  ): Promise<{
    stacks: {
      instances: { sopInstanceUID: string; metadata: Record<string, { Value?: unknown[] }> }[];
    }[];
  }>;
}

interface DiagnosticsSample {
  readonly renderingEngines: number;
  readonly viewports: number;
  readonly cacheBytes: number;
  readonly workers: number;
  readonly activeEngines: number;
}

declare global {
  interface Window {
    __dvViewer?: ViewerHandle;
    __dvCycles?: { cycle: number; diagnostics: DiagnosticsSample | undefined }[];
    __dvRefreshes?: number;
    __dvSkipped?: { name: string; reason: string }[];
    __dvGl?: WeakRef<WebGLRenderingContext | WebGL2RenderingContext>[];
    __dvSource?: SourceHandle;
  }
}

interface Watched {
  readonly page: Page;
  readonly failures: string[];
  readonly workerUrls: string[];
  /** Responses with these statuses are expected in this scenario (and their console echo). */
  expectStatus(...statuses: number[]): void;
  close(): Promise<void>;
}

async function watch(browser: Browser, trackGl = false): Promise<Watched> {
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

function query(input: HeadlessInput, extra: Record<string, string>): string {
  const params = new URLSearchParams({ ...extra });
  if (input.assetsMode === 'url') params.set('assets', input.assetsPath);
  return `${input.pageUrl}?${params.toString()}`;
}

async function waitForStatus(page: Page, ...statuses: string[]): Promise<string> {
  // Generous: 20 viewers one after another take a while on a shared CI runner.
  await page.waitForFunction(
    (wanted) => wanted.includes(document.documentElement.dataset['dvStatus'] ?? ''),
    statuses,
    { timeout: 300_000 },
  );
  return page.evaluate(() => document.documentElement.dataset['dvStatus'] ?? '');
}

async function expectReady(watched: Watched): Promise<boolean> {
  const status = await waitForStatus(watched.page, 'ready', 'error');
  if (status === 'ready') return true;
  watched.failures.push(
    `viewer failed: ${await watched.page.evaluate(() => window.__dvError ?? 'unknown')}`,
  );
  return false;
}

async function checkHounsfield(watched: Watched, label: string): Promise<void> {
  for (const probe of EXPECTED_HU) {
    const hu = await watched.page.evaluate(
      ([index, row, column]) => window.__dv?.sampleHu(index, row, column) ?? Number.NaN,
      [MID_SLICE_INDEX, probe.row, probe.column] as const,
    );
    if (hu !== probe.hu) {
      watched.failures.push(
        `${label}: ${probe.name} is ${String(hu)} HU, expected ${probe.hu.toString()}`,
      );
    }
  }
}

async function viewportCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#viewport').boundingBox();
  if (box === null) throw new Error('the viewport has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function scenarioDicomWeb(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    input.mock.requestLog.length = 0;
    // No `series` in the query: the page lists the study and picks a CT series itself.
    await page.goto(query(input, { wadoRoot: input.mock.url, study: input.studyUid }), {
      waitUntil: 'load',
      timeout: 180_000,
    });
    if (!(await expectReady(watched))) return failures;

    const buttons = await page.locator('#series button').evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        series: String((node as HTMLElement).dataset['series']),
        disabled: (node as HTMLButtonElement).disabled,
      })),
    );
    if (buttons.length !== 3)
      failures.push(`expected 3 series in the list, got ${buttons.length.toString()}`);
    const seg = buttons.find((button) => button.series === input.segSeriesUid);
    if (seg?.disabled !== true) failures.push('the SEG series should be listed but not selectable');
    if ((await page.evaluate(() => window.__dv?.imageCount)) !== 64)
      failures.push('the default CT does not have 64 images');

    // Switch to the J2K series from the list, as a user would.
    await page.locator(`#series button[data-series="${input.j2kSeriesUid}"]`).click();
    await page.waitForFunction(
      (uid) =>
        window.__dvViewer?.getState().viewports[0]?.seriesInstanceUID === uid &&
        window.__dv?.imageCount === 64,
      input.j2kSeriesUid,
    );
    await checkHounsfield(watched, 'J2K decode');

    // Scroll by API, then with the real mouse wheel.
    await page.evaluate(() => window.__dv?.setImageIndex(10));
    if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== 10)
      failures.push('setImageIndex(10) did not move the stack');
    const centre = await viewportCentre(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, 240);
    await page
      .waitForFunction(() => window.__dv?.getImageIndex() !== 10, undefined, { timeout: 10_000 })
      .catch(() => {
        failures.push('the mouse wheel did not scroll the stack');
      });
    await page.waitForTimeout(500);
    if ((await litFraction(page)) < 0.05) failures.push('the viewport looks blank');

    // The address now describes the viewer. Copy it, reload, and the same slice is back.
    const before = await page.evaluate(() => ({
      state: window.__dvViewer?.getState(),
      hash: location.hash,
    }));
    if (before.hash.length < 10) failures.push('the page address does not carry the viewer state');
    await page.reload({ waitUntil: 'load' });
    if (!(await expectReady(watched))) return failures;
    const after = await page.evaluate(() => window.__dvViewer?.getState());
    const wanted = before.state?.viewports[0];
    const got = after?.viewports[0];
    if (
      got?.seriesInstanceUID !== wanted?.seriesInstanceUID ||
      got?.imageIndex !== wanted?.imageIndex
    ) {
      failures.push(`the link restored ${JSON.stringify(got)}, expected ${JSON.stringify(wanted)}`);
    }
    await checkHounsfield(watched, 'after restoring the link');

    // SEG through the same viewer.
    const labels = await page.evaluate(async (uid) => {
      const handle = await window.__dv?.loadSegmentation(uid);
      return handle?.segments
        .map((segment) => `${segment.number.toString()}:${segment.label}`)
        .join(',');
    }, input.segSeriesUid);
    if (labels !== '1:Body,2:Bone insert') failures.push(`SEG segments are ${String(labels)}`);

    const expectedWorker =
      input.assetsMode === 'inline' ? 'blob:' : `${input.assetsPath}/decode.worker.js`;
    if (
      !watched.workerUrls.some(
        (url) => url.includes(expectedWorker) || url.startsWith(expectedWorker),
      )
    ) {
      failures.push(`no decode worker started from ${expectedWorker}`);
    }
    for (const entry of input.mock.requestLog) {
      if (entry.status >= 400)
        failures.push(`mock saw ${entry.status.toString()} for ${entry.path}`);
    }
    // QIDO must stay scoped to the study, as the proxy requires.
    if (
      input.mock.requestLog.some((entry) => entry.path === '/studies' || entry.path === '/series')
    ) {
      failures.push('an unscoped search was sent');
    }
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

interface View {
  window: { center: number; width: number };
  defaultWindow: { center: number; width: number };
  invert: boolean;
  zoom: number;
}

const view = (page: Page): Promise<View | undefined> => page.evaluate(() => window.__dv?.getView());

async function drag(
  page: Page,
  button: 'left' | 'middle' | 'right',
  dx: number,
  dy: number,
): Promise<void> {
  const centre = await viewportCentre(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down({ button });
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 8 });
  await page.mouse.up({ button });
  await page.waitForTimeout(150);
}

function frameIndex(path: string, sops: readonly string[]): number {
  const match = /\/instances\/([^/]+)\/frames\//.exec(path);
  return match?.[1] === undefined ? -1 : sops.indexOf(match[1]);
}

/** M3: tools, keyboard, presets, cine, the overlay, navigateTo, and prefetching, against the real engine. */
async function scenarioNavigation(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    input.mock.requestLog.length = 0;
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: input.studyUid, series: input.j2kSeriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    const study = input.studyUid;

    // Prefetching: the slice on screen and then its neighbours, so all 64 are fetched without being asked for.
    const framesOf = (series: string): string[] =>
      input.mock.requestLog
        .filter((entry) => entry.path.includes(series) && entry.path.includes('/frames/'))
        .map((entry) => entry.path);
    const deadline = Date.now() + 60_000;
    while (new Set(framesOf(input.j2kSeriesUid)).size < 64 && Date.now() < deadline) {
      await page.waitForTimeout(250);
    }
    const fetched = new Set(framesOf(input.j2kSeriesUid)).size;
    if (fetched < 64) failures.push(`prefetch loaded ${fetched.toString()} of 64 slices`);

    // The overlay: the slice indicator follows the slice, and the patient is not shown.
    const bottomRight = async (): Promise<string> =>
      (await page.locator('#viewport [data-dv-corner="bottom-right"]').textContent()) ?? '';
    if (!/^Image \d+ \/ 64$/.test(await bottomRight()))
      failures.push(`the slice indicator says "${await bottomRight()}"`);
    await page.evaluate(() => window.__dv?.setImageIndex(9));
    if ((await bottomRight()) !== 'Image 10 / 64')
      failures.push(`after moving to slice 10 the indicator says "${await bottomRight()}"`);
    const overlayText = (await page.locator('#viewport .dv-overlay').textContent()) ?? '';
    const topLeft =
      (await page.locator('#viewport [data-dv-corner="top-left"]').textContent()) ?? '';
    const identity = await page.evaluate(
      async ([studyUid, seriesUid]) => {
        const series = await window.__dvSource?.getSeries(studyUid ?? '', seriesUid ?? '');
        const metadata = series?.stacks[0]?.instances[0]?.metadata ?? {};
        const text = (tag: string): string => {
          const value = metadata[tag]?.Value?.[0];
          if (typeof value === 'string') return value;
          if (typeof value === 'object' && value !== null && 'Alphabetic' in value)
            return String(value.Alphabetic);
          return '';
        };
        return {
          name: text('00100010'),
          id: text('00100020'),
          description: text('0008103E'),
        };
      },
      [study, input.j2kSeriesUid],
    );
    // The series description is allowed; nothing else is in that corner, and the patient is nowhere.
    if (topLeft !== identity.description)
      failures.push(
        `the top left of the overlay says "${topLeft}", expected only the series description`,
      );
    for (const secret of [identity.id, ...identity.name.split('^')]) {
      if (
        secret.length > 2 &&
        overlayText.includes(secret) &&
        !identity.description.includes(secret)
      )
        failures.push(`the overlay shows "${secret}", which is the patient's`);
    }

    // Mouse: the left button changes the window, the right zooms, the middle pans, and the wheel scrolls.
    const first = await view(page);
    if (first === undefined) return [...failures, 'no view'];
    await drag(page, 'left', 90, 40);
    const windowed = await view(page);
    if (
      windowed === undefined ||
      (windowed.window.center === first.window.center &&
        windowed.window.width === first.window.width)
    ) {
      failures.push('dragging with the left button did not change the window');
    }
    const afterWindow = await page.evaluate(() => window.__dvViewer?.getState().viewports[0]);
    if (afterWindow?.window === undefined)
      failures.push('the window the user set is not in the state');

    await drag(page, 'right', 0, -80);
    const zoomed = await view(page);
    if (zoomed === undefined || Math.abs(zoomed.zoom - 1) < 0.05)
      failures.push('dragging with the right button did not zoom');

    const pictureBefore = await page.locator('#viewport').screenshot();
    await drag(page, 'middle', 60, 30);
    if (pictureBefore.equals(await page.locator('#viewport').screenshot()))
      failures.push('dragging with the middle button did not pan');

    // The tool on the left button can be changed: pan with the left button, then zoom.
    await page.locator('#tools button[data-tool="pan"]').click();
    const panBefore = await page.locator('#viewport').screenshot();
    await drag(page, 'left', -50, -20);
    if (panBefore.equals(await page.locator('#viewport').screenshot()))
      failures.push('with the pan tool, dragging with the left button did not pan');
    await page.locator('#tools button[data-tool="zoom"]').click();
    const zoomBefore = (await view(page))?.zoom ?? 0;
    await drag(page, 'left', 0, 60);
    const zoomAfter = (await view(page))?.zoom ?? 0;
    if (Math.abs(zoomAfter - zoomBefore) < 0.05)
      failures.push(
        `with the zoom tool, dragging with the left button did not zoom (${zoomBefore.toString()} to ${zoomAfter.toString()})`,
      );
    // Back to window / level: the left button must have been given back, not shared with the zoom tool.
    await page.locator('#tools button[data-tool="window-level"]').click();
    const beforeBack = await view(page);
    await drag(page, 'left', 70, 0);
    const afterBack = await view(page);
    if (
      beforeBack === undefined ||
      afterBack === undefined ||
      (afterBack.window.center === beforeBack.window.center &&
        afterBack.window.width === beforeBack.window.width)
    ) {
      failures.push(
        'after going back to window / level, the left button did not change the window',
      );
    } else if (Math.abs(afterBack.zoom - beforeBack.zoom) > 1e-6) {
      failures.push('after going back to window / level, the left button still zoomed');
    }

    // Reset puts everything back, state included.
    await page.locator('#tools button[data-action="reset"]').click();
    await page.waitForTimeout(150);
    const reset = await view(page);
    if (
      reset === undefined ||
      Math.abs(reset.zoom - 1) > 1e-6 ||
      Math.abs(reset.window.width - reset.defaultWindow.width) > 1e-6
    ) {
      failures.push(`reset left the view at ${JSON.stringify(reset)}`);
    }
    const afterReset = await page.evaluate(() => window.__dvViewer?.getState().viewports[0]);
    if (afterReset?.window !== undefined || afterReset?.zoom !== undefined)
      failures.push('reset left the window or the zoom in the state');

    // Keyboard, after a click gave the viewport the focus.
    await page.locator('#viewport').click();
    await page.evaluate(() => window.__dv?.setImageIndex(20));
    await page.keyboard.press('ArrowDown');
    await page
      .waitForFunction(() => window.__dv?.getImageIndex() === 21, undefined, {
        timeout: 10_000,
      })
      .catch(() => {
        failures.push('ArrowDown did not scroll to the next slice');
      });
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    const lung = (await view(page))?.window;
    if (lung?.center !== -600 || lung.width !== 1500)
      failures.push(`key 1 set the window to ${JSON.stringify(lung)}`);
    await page.keyboard.press('i');
    await page.waitForTimeout(150);
    if ((await view(page))?.invert !== true) failures.push('key i did not invert');
    await page.keyboard.press('r');
    await page.waitForTimeout(150);
    const afterKeys = await view(page);
    if (
      afterKeys?.invert !== false ||
      Math.abs(afterKeys.window.width - afterKeys.defaultWindow.width) > 1e-6
    )
      failures.push('key r did not reset the view');

    // Cine plays slices and stops when asked.
    await page.evaluate(() => window.__dv?.setImageIndex(0));
    await page.locator('#tools button[data-action="cine"]').click();
    const seen = new Set<number | undefined>();
    for (let tick = 0; tick < 12; tick += 1) {
      await page.waitForTimeout(100);
      seen.add(await page.evaluate(() => window.__dv?.getImageIndex()));
    }
    if (seen.size < 5) failures.push(`cine showed only ${seen.size.toString()} different slices`);
    await page.locator('#tools button[data-action="cine"]').click();
    const stoppedAt = await page.evaluate(() => window.__dv?.getImageIndex());
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== stoppedAt)
      failures.push('cine kept going after it was stopped');
    if (await page.evaluate(() => window.__dv?.cine.playing))
      failures.push('cine still says it is playing');

    // The window, the inversion, and the zoom are in the link, and a reload restores them.
    await page.evaluate(async () => {
      await window.__dv?.applyWindowPreset('bone');
      await window.__dv?.setZoom(2);
    });
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'load' });
    if (!(await expectReady(watched))) return failures;
    const restored = await view(page);
    if (
      restored?.window.center !== 480 ||
      restored.window.width !== 2500 ||
      Math.abs(restored.zoom - 2) > 1e-6
    ) {
      failures.push(`the link restored ${JSON.stringify(restored)}, expected bone and zoom 2`);
    }

    // navigateTo: a series that was never loaded, at slice 40. That slice is fetched first and its
    // neighbours next, nearest first.
    const sops = await page.evaluate(
      async ([studyUid, seriesUid]) => {
        const series = await window.__dvSource?.getSeries(studyUid ?? '', seriesUid ?? '');
        return series?.stacks[0]?.instances.map((instance) => instance.sopInstanceUID) ?? [];
      },
      [study, input.evrleSeriesUid],
    );
    if (sops.length !== 64) {
      failures.push(`the EVRLE series has ${sops.length.toString()} instances`);
      return failures;
    }
    input.mock.requestLog.length = 0;
    const target = sops[40];
    if (target === undefined) return failures;
    const result = await page.evaluate((arguments_) => window.__dvViewer?.navigateTo(arguments_), {
      seriesInstanceUID: input.evrleSeriesUid,
      sopInstanceUID: target,
    });
    if (result?.imageIndex !== 40) failures.push(`navigateTo landed on ${JSON.stringify(result)}`);
    if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== 40)
      failures.push('navigateTo did not put slice 40 on screen');
    await page.waitForTimeout(1500);
    const order = input.mock.requestLog
      .filter((entry) => entry.path.includes('/frames/'))
      .map((entry) => frameIndex(entry.path, sops));
    if (order[0] !== 40)
      failures.push(`the first frame fetched was slice ${String(order[0])}, not the target 40`);
    const far = order.slice(0, 6).filter((index) => Math.abs(index - 40) > 4);
    if (far.length > 0)
      failures.push(
        `the first frames fetched were ${JSON.stringify(order.slice(0, 6))}, not its neighbours`,
      );
    if (new Set(order).size < 60)
      failures.push(
        `only ${new Set(order).size.toString()} slices of the series were fetched after navigateTo`,
      );

    for (const entry of input.mock.requestLog) {
      if (entry.status >= 400)
        failures.push(`mock saw ${entry.status.toString()} for ${entry.path}`);
    }
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

async function scenarioAuth(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  const { authMock } = input;
  watched.expectStatus(401);
  let nextToken = 't1';
  try {
    authMock.requestLog.length = 0;
    authMock.auth.accept('t1');
    await page.exposeFunction('__refreshToken', () => {
      authMock.auth.accept(nextToken);
      return nextToken;
    });
    await page.goto(
      query(input, {
        wadoRoot: authMock.url,
        study: input.studyUid,
        series: input.j2kSeriesUid,
        token: 't1',
        // The scenario revokes the token and expects the next frame it asks for to fail, so no
        // frame may be fetched ahead of time.
        prefetch: '0',
      }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    await checkHounsfield(watched, 'with a token');
    if ((await page.evaluate(() => window.__dvRefreshes ?? 0)) !== 0) {
      failures.push('the token was refreshed although it was valid');
    }
    if (authMock.requestLog.some((entry) => entry.status === 401)) {
      failures.push('the first requests were sent without the token');
    }

    // The token expires. The next frame that has to be fetched gets a 401, refreshes, and retries.
    authMock.auth.revoke('t1');
    nextToken = 't2';
    await page.evaluate(() => window.__dv?.setImageIndex(63));
    if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== 63)
      failures.push('the last slice did not load after the token expired');
    const afterFrame = await page.evaluate(() => window.__dvRefreshes ?? 0);
    if (afterFrame !== 1)
      failures.push(`expected one refresh for the frame request, saw ${afterFrame.toString()}`);

    // It expires again. A series request (metadata) gets a 401, refreshes, and retries.
    authMock.auth.revoke('t2');
    nextToken = 't3';
    await page.locator(`#series button[data-series="${input.evrleSeriesUid}"]`).click();
    await page.waitForFunction(
      (uid) =>
        window.__dvViewer?.getState().viewports[0]?.seriesInstanceUID === uid &&
        window.__dv?.imageCount === 64,
      input.evrleSeriesUid,
      { timeout: 60_000 },
    );
    const afterSeries = await page.evaluate(() => window.__dvRefreshes ?? 0);
    if (afterSeries !== 2)
      failures.push(`expected two refreshes in all, saw ${afterSeries.toString()}`);
    const unauthorized = authMock.requestLog.filter((entry) => entry.status === 401).length;
    if (unauthorized < 2)
      failures.push(`the server never answered 401 (${unauthorized.toString()})`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

async function scenarioRetry(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  watched.expectStatus(503);
  try {
    input.mock.requestLog.length = 0;
    // The study list fails twice, then answers: the page's retry setting allows two retries.
    input.mock.failNext(503, 2);
    await page.goto(
      query(input, {
        wadoRoot: input.mock.url,
        study: input.studyUid,
        series: input.j2kSeriesUid,
        prefetch: '0',
      }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    const statuses = input.mock.requestLog.map((entry) => entry.status);
    if (statuses.filter((status) => status === 503).length !== 2) {
      failures.push(`expected two injected 503s, saw ${JSON.stringify(statuses.slice(0, 5))}`);
    }
    await checkHounsfield(watched, 'after retries');
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

async function scenarioLocalFiles(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    input.mock.requestLog.length = 0;
    await page.goto(query(input, { local: '1', series: input.j2kSeriesUid }), {
      waitUntil: 'load',
      timeout: 180_000,
    });
    await waitForStatus(page, 'waiting-for-files');
    const folder = join(input.fixturesDir, 'ct-j2k');
    const files = readdirSync(folder)
      .filter((name) => name.endsWith('.dcm'))
      .sort()
      .map((name) => join(folder, name));
    // Playwright takes paths or payloads, not a mix, so everything is a payload.
    const payload = (path: string): { name: string; mimeType: string; buffer: Buffer } => ({
      name: path.split('/').slice(-2).join('-'),
      mimeType: 'application/dicom',
      buffer: readFileSync(path),
    });
    await page
      .locator('#files')
      .setInputFiles([
        ...files.map(payload),
        payload(join(input.fixturesDir, 'seg-body-bone', '0001.dcm')),
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not dicom') },
      ]);
    if (!(await expectReady(watched))) return failures;

    if ((await page.evaluate(() => window.__dv?.imageCount)) !== 64)
      failures.push('expected 64 local images');
    await checkHounsfield(watched, 'local J2K decode');
    const skipped = await page.evaluate(() => window.__dvSkipped?.map((entry) => entry.name));
    if (JSON.stringify(skipped) !== JSON.stringify(['notes.txt'])) {
      failures.push(`expected only notes.txt to be skipped, got ${JSON.stringify(skipped)}`);
    }
    await page.evaluate(() => window.__dv?.setImageIndex(12));
    if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== 12)
      failures.push('scrolling local files did not work');
    const seg = await page.evaluate(async (uid) => {
      const handle = await window.__dv?.loadSegmentation(uid);
      return handle === undefined
        ? undefined
        : {
            labels: handle.segments
              .map((segment) => `${segment.number.toString()}:${segment.label}`)
              .join(','),
            frames: handle.labelmapFrameCount,
            bone: handle.sample(31, 64, 92),
          };
    }, input.segSeriesUid);
    if (seg?.labels !== '1:Body,2:Bone insert' || seg.frames !== 64 || seg.bone !== 2) {
      failures.push(`local SEG came out as ${JSON.stringify(seg)}`);
    }
    if (input.mock.requestLog.length > 0) failures.push('local files made DICOMweb requests');
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

interface Counters {
  readonly nodes: number;
  readonly listeners: number;
  readonly heapMb: number;
}

async function sample(session: CDPSession): Promise<Counters> {
  // Garbage that merely has not been collected yet is not a leak.
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  const counters = await session.send('Memory.getDOMCounters');
  const heap = await session.send('Runtime.getHeapUsage');
  return {
    nodes: counters.nodes,
    listeners: counters.jsEventListeners,
    heapMb: heap.usedSize / (1024 * 1024),
  };
}

async function scenarioLifecycle(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser, true);
  const { page, failures } = watched;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.enable');
    await page.goto(
      query(input, {
        cycles: String(input.cycles),
        wadoRoot: input.mock.url,
        study: input.studyUid,
        series: input.j2kSeriesUid,
      }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    // The first cycles warm things up (lazy chunks, caches that stay by design). Compare after those.
    const WARM_UP = Math.min(3, Math.max(1, input.cycles - 1));
    await page.waitForFunction((count) => (window.__dvCycles?.length ?? 0) >= count, WARM_UP, {
      timeout: 180_000,
    });
    const warm = await sample(session);
    const status = await waitForStatus(page, 'cycles-done', 'error');
    if (status !== 'cycles-done') {
      failures.push(`cycles failed: ${await page.evaluate(() => window.__dvError ?? 'unknown')}`);
      return failures;
    }
    const done = await sample(session);

    const cycles = await page.evaluate(() => window.__dvCycles ?? []);
    if (cycles.length !== input.cycles)
      failures.push(`ran ${cycles.length.toString()} cycles, expected ${input.cycles.toString()}`);
    for (const { cycle, diagnostics } of cycles) {
      if (diagnostics === undefined) {
        failures.push(`cycle ${cycle.toString()}: no diagnostics`);
        continue;
      }
      const left = Object.entries(diagnostics).filter(([, value]) => value !== 0);
      if (left.length > 0) {
        failures.push(
          `cycle ${cycle.toString()}: left behind ${JSON.stringify(Object.fromEntries(left))}`,
        );
        break;
      }
    }
    if (page.workers().length !== 0) {
      failures.push(`${page.workers().length.toString()} worker thread(s) are still alive`);
    }
    const alive = await page.evaluate(
      () =>
        (window.__dvGl ?? []).filter((ref) => {
          const context = ref.deref();
          return context !== undefined && !context.isContextLost();
        }).length,
    );
    const created = await page.evaluate(() => window.__dvGl?.length ?? 0);
    if (alive > 1)
      failures.push(`${alive.toString()} of ${created.toString()} WebGL contexts are still alive`);

    // Allow a little noise (the browser's own bookkeeping), but nothing that grows with the cycles.
    if (done.nodes - warm.nodes > 50)
      failures.push(`DOM nodes grew from ${warm.nodes.toString()} to ${done.nodes.toString()}`);
    if (done.listeners - warm.listeners > 50)
      failures.push(
        `event listeners grew from ${warm.listeners.toString()} to ${done.listeners.toString()}`,
      );
    if (done.heapMb - warm.heapMb > 30)
      failures.push(
        `the heap grew from ${warm.heapMb.toFixed(1)} MB to ${done.heapMb.toFixed(1)} MB`,
      );
    console.log(
      `   lifecycle: nodes ${warm.nodes.toString()} -> ${done.nodes.toString()}, listeners ${warm.listeners.toString()} -> ${done.listeners.toString()}, heap ${warm.heapMb.toFixed(1)} -> ${done.heapMb.toFixed(1)} MB, WebGL alive ${alive.toString()} of ${created.toString()}`,
    );
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/** Viewers one after another with different assets modes: allowed once the previous one is gone. */
async function scenarioAssetSwitch(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    // The page switches between `inline` and `url` itself, so this needs the url-mode assets.
    const params = new URLSearchParams({
      cycles: '4',
      alternate: '1',
      assets: input.assetsPath,
      wadoRoot: input.mock.url,
      study: input.studyUid,
      series: input.j2kSeriesUid,
    });
    await page.goto(`${input.pageUrl}?${params.toString()}`, {
      waitUntil: 'load',
      timeout: 180_000,
    });
    const status = await waitForStatus(page, 'cycles-done', 'error');
    if (status !== 'cycles-done') {
      failures.push(`cycles failed: ${await page.evaluate(() => window.__dvError ?? 'unknown')}`);
      return failures;
    }
    const urls = watched.workerUrls;
    if (!urls.some((url) => url.startsWith('blob:')))
      failures.push('no inline (blob:) decode worker started');
    if (!urls.some((url) => url.endsWith('/decode.worker.js')))
      failures.push('no url-mode decode worker started');
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

export async function smokeHeadless(
  browser: Browser,
  input: HeadlessInput,
): Promise<ScenarioResult[]> {
  const scenarios: readonly [string, (b: Browser, i: HeadlessInput) => Promise<string[]>][] = [
    ['dicomweb', scenarioDicomWeb],
    ['navigation', scenarioNavigation],
    ['auth', scenarioAuth],
    ['retry', scenarioRetry],
    ['local files', scenarioLocalFiles],
    ['lifecycle', scenarioLifecycle],
    ['switching assets', scenarioAssetSwitch],
  ];
  const results: ScenarioResult[] = [];
  // DV_SCENARIO=navigation runs one scenario, for working on it.
  const only = process.env['DV_SCENARIO'];
  for (const [scenario, run] of scenarios) {
    if (only !== undefined && only !== scenario) continue;
    console.log(`   scenario: ${scenario}`);
    results.push({ scenario, failures: await run(browser, input) });
  }
  return results;
}
