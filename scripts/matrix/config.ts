// M6.6: one settings file, `examples/viewer-config.json`, fetched by the page with `config-url`, gives
// the same viewer in every framework: the look, the toolbar, the keys, the window presets, the lines
// over the picture, and the panels. Against the real engine and the phantom.
import { type Browser, type ConsoleMessage, type Page } from 'playwright';
import { isIgnorableRequest, type SmokeInput } from './smoke.ts';
import './page-types.ts';

const VIEWPORT = 'dv-viewer [data-viewport-id="vp-0"]';
const CORNER = (name: string): string => `dv-viewer [data-dv-corner="${name}"]`;

export interface ConfigInput extends SmokeInput {
  /** Where the settings file is served: the same server as the images, so its origin is listed by the page. */
  readonly configUrl: string;
}

async function waitFor(
  page: Page,
  what: string,
  check: () => Promise<boolean>,
  failures: string[],
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await page.waitForTimeout(100);
  }
  failures.push(`timed out waiting for ${what}`);
  return false;
}

const activeTool = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__dvViewer?.tools.getActive());

export async function smokeConfig(browser: Browser, input: ConfigInput): Promise<string[]> {
  const failures: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
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

  const query = new URLSearchParams({
    wadoRoot: input.wadoRoot,
    study: input.studyUid,
    series: input.seriesUid,
    config: input.configUrl,
  });
  if (input.assetsMode === 'url') query.set('assets', input.assetsPath);

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
    if ((await page.evaluate(() => document.documentElement.dataset['dvStatus'])) !== 'ready') {
      failures.push(`viewer failed: ${await page.evaluate(() => window.__dvError ?? 'unknown')}`);
      return failures;
    }

    // The look.
    const look = await page.evaluate(() => {
      const element = document.querySelector('dv-viewer');
      return {
        palette: element?.getAttribute('data-palette'),
        theme: element?.getAttribute('data-theme'),
      };
    });
    if (look.palette !== 'navy') failures.push(`the palette is ${String(look.palette)}, not navy`);
    if (look.theme !== 'light') failures.push(`the theme is ${String(look.theme)}, not light`);

    // The toolbar the file describes, with the names beside the pictures.
    const move = page.locator('dv-toolbar [data-tool="pan"]');
    if (!((await move.textContent()) ?? '').includes('Move'))
      failures.push('the Pan button is not named Move');
    for (const selector of [
      'dv-toolbar [data-tool="window-level"]',
      'dv-toolbar [data-action="zoom-in"]',
      'dv-toolbar [data-menu-id="windows"]',
    ]) {
      if ((await page.locator(selector).count()) !== 1)
        failures.push(`the toolbar has no ${selector}`);
    }
    if ((await page.locator('dv-toolbar [data-action="cine"]').count()) !== 0)
      failures.push('the built-in toolbar is still there next to the one in the file');

    // The panels: the Segments tab is hidden, the others stay.
    if (
      (await page.locator('dv-panel-dock [role="tab"][data-panel="segmentations"]').count()) !== 0
    )
      failures.push('the Segments tab is shown');
    if ((await page.locator('dv-panel-dock [role="tab"][data-panel="measurements"]').count()) !== 1)
      failures.push('the Measurements tab is missing');

    // The lines over the picture: Columns from a tag, the size taken out, no patient.
    const topRight = (await page.locator(CORNER('top-right')).textContent()) ?? '';
    if (topRight !== 'CT\nColumns 128') failures.push(`the top right corner says "${topRight}"`);
    const topLeft = (await page.locator(CORNER('top-left')).textContent()) ?? '';
    if (topLeft.includes('\n'))
      failures.push(`the top left corner shows a patient line: "${topLeft}"`);

    // The keys of the file, on top of the usual ones.
    await page.locator(VIEWPORT).focus();
    await page.keyboard.press('m');
    if (
      !(await waitFor(
        page,
        'M to choose the pan tool',
        async () => (await activeTool(page)) === 'pan',
        failures,
      ))
    )
      return failures;
    await waitFor(
      page,
      'the Move button to be pressed',
      async () => (await move.getAttribute('aria-pressed')) === 'true',
      failures,
    );
    await page.keyboard.press('n');
    await waitFor(
      page,
      'N to invert the image',
      async () =>
        (await page.evaluate(() => window.__dvViewer?.getState().viewports[0]?.invert)) === true,
      failures,
    );
    // The overlay says so too: the engine tells the viewer when invert alone changes.
    await waitFor(
      page,
      'the overlay to say Inverted',
      async () =>
        ((await page.locator(CORNER('bottom-left')).textContent()) ?? '').includes('Inverted'),
      failures,
    );
    await page.keyboard.press('w');
    await waitFor(
      page,
      'a usual key (W) to still work',
      async () => (await activeTool(page)) === 'window-level',
      failures,
    );

    // The window presets of the file: the menu, and the digit.
    await page.locator('dv-toolbar [data-menu-id="windows"]').click();
    const mine = page.locator('dv-toolbar [role="menu"] [data-action="mine"]');
    await mine.click();
    const windowOf = (): Promise<{ center: number; width: number } | undefined> =>
      page.evaluate(() => window.__dv?.getView()?.window);
    await waitFor(
      page,
      'the menu to apply My window',
      async () => {
        const view = await windowOf();
        return view?.center === 300 && view.width === 900;
      },
      failures,
    );
    await page.locator('dv-toolbar [data-menu-id="windows"]').click();
    await page.locator('dv-toolbar [role="menu"] [data-action="bone"]').click();
    await page.locator(VIEWPORT).focus();
    await page.keyboard.press('1');
    await waitFor(
      page,
      'the key 1 to apply the first preset of the file',
      async () => {
        const view = await windowOf();
        return view?.center === 300 && view.width === 900;
      },
      failures,
    );

    // A command button of the file.
    const before = await page.evaluate(() => window.__dv?.getView()?.zoom ?? 1);
    await page.locator('dv-toolbar [data-action="zoom-in"]').click();
    await waitFor(
      page,
      'the Zoom in button to zoom',
      async () => ((await page.evaluate(() => window.__dv?.getView()?.zoom)) ?? 1) > before,
      failures,
    );

    if (await page.evaluate(() => window.__dvError)) {
      failures.push(`the viewer reported: ${await page.evaluate(() => window.__dvError ?? '')}`);
    }
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
  return failures;
}
