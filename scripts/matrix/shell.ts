// Scenario for the styled shell (`<dv-viewer>` and the React and Vue adapters around it), run in every
// framework example: accessibility with axe, and everything a person can do from the keyboard and
// the mouse, against the real engine. The viewport is a light-DOM child shown through a slot, so
// this is also the evidence that Cornerstone's input works across that boundary (ADR 0007).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type Browser, type ConsoleMessage, type Page } from 'playwright';
import {
  isIgnorableRequest,
  litFraction,
  type SmokeInput,
  waitForRed,
  waitForTint,
} from './smoke.ts';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeNode {
  readonly target: readonly unknown[];
  readonly failureSummary?: string;
}
interface AxeViolation {
  readonly id: string;
  readonly impact?: string | null;
  readonly nodes: readonly AxeNode[];
}
declare global {
  interface Window {
    axe?: {
      run(
        context: Element,
        options: { runOnly: { type: 'tag'; values: string[] } },
      ): Promise<{ violations: AxeViolation[] }>;
    };
  }
}

const VIEWPORT = 'dv-viewer [data-viewport-id="vp-0"]';

async function label(page: Page): Promise<string> {
  return (await page.locator(VIEWPORT).getAttribute('aria-label')) ?? '';
}

/** What has the keyboard focus, through open shadow roots, as the data attribute that names it. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active === null) return 'nothing';
    const data = active as HTMLElement;
    return (
      data.dataset['tool'] ??
      data.dataset['action'] ??
      (data.dataset['menuId'] === undefined ? undefined : `menu:${data.dataset['menuId']}`) ??
      (data.dataset['series'] === undefined ? undefined : `series:${data.dataset['series']}`) ??
      (data.dataset['measurement'] === undefined ? undefined : 'measurement') ??
      (data.dataset['segment'] === undefined ? undefined : 'segment') ??
      (data.dataset['viewportId'] === undefined
        ? undefined
        : `viewport:${data.dataset['viewportId']}`) ??
      active.tagName.toLowerCase()
    );
  });
}

async function runAxe(page: Page, when: string, failures: string[]): Promise<void> {
  const violations = await page.evaluate(async () => {
    const root = document.querySelector('dv-viewer');
    if (root === null || window.axe === undefined) return undefined;
    const result = await window.axe.run(root, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? '?',
      nodes: violation.nodes.map(
        (node) => `${node.target.join(' ')} -- ${node.failureSummary ?? ''}`,
      ),
    }));
  });
  if (violations === undefined) {
    failures.push(`${when}: axe did not run`);
    return;
  }
  for (const violation of violations) {
    failures.push(
      `${when}: axe ${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).join(' | ')}`,
    );
  }
}

async function waitFor(
  page: Page,
  what: string,
  condition: () => Promise<boolean>,
  failures: string[],
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await page.waitForTimeout(100);
  }
  failures.push(`timed out waiting for ${what}`);
  return false;
}

export async function smokeShell(browser: Browser, input: SmokeInput): Promise<string[]> {
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
    await page.addScriptTag({ content: AXE_SOURCE });

    // The viewport is named for what it shows.
    const first = await label(page);
    if (!/image \d+ of 64$/.test(first)) failures.push(`the viewport is labelled "${first}"`);
    if ((await page.locator(VIEWPORT).getAttribute('role')) !== 'img')
      failures.push('the viewport is not role=img');

    // Thumbnails: every series with pictures gets one; the SEG does not.
    const rows = page.locator('dv-series-browser [role="option"]');
    await waitFor(
      page,
      'thumbnails',
      async () => (await page.locator('dv-series-browser [role="option"] img').count()) >= 2,
      failures,
      30_000,
    );
    const total = await rows.count();
    let withPicture = 0;
    let disabled = 0;
    for (let at = 0; at < total; at += 1) {
      const row = rows.nth(at);
      if ((await row.getAttribute('aria-disabled')) === 'true') {
        disabled += 1;
        if ((await row.locator('img').count()) !== 0) failures.push('a SEG row has a thumbnail');
      } else if ((await row.locator('img').count()) > 0) {
        withPicture += 1;
      }
    }
    if (withPicture < 2)
      failures.push(`${withPicture.toString()} series have a thumbnail, expected 2 or more`);
    if (disabled < 1) failures.push('the SEG row is not marked unavailable');
    // Every thumbnail in every open shadow root under the viewer: all there, all decoded.
    const pictures = await page.evaluate(async () => {
      const images: HTMLImageElement[] = [];
      const walk = (root: ParentNode): void => {
        for (const element of root.querySelectorAll('*')) {
          if (element instanceof HTMLImageElement) images.push(element);
          if (element.shadowRoot !== null) walk(element.shadowRoot);
        }
      };
      const shell = document.querySelector('dv-viewer')?.shadowRoot;
      if (shell !== null && shell !== undefined) walk(shell);
      // An image that is present may still be decoding: only one that fails to decode is broken.
      const decoded = await Promise.all(
        images.map((image) =>
          image.decode().then(
            () => image.naturalWidth > 0,
            () => false,
          ),
        ),
      );
      return { count: images.length, broken: decoded.filter((ok) => !ok).length };
    });
    if (pictures.count < 2)
      failures.push(`found ${pictures.count.toString()} thumbnail images in the shadow roots`);
    const { broken } = pictures;
    if (broken > 0) failures.push(`${broken.toString()} thumbnails did not decode`);

    await runAxe(page, 'dark theme', failures);

    // Toolbar: one tab stop, arrows move, Enter chooses.
    await page.locator('dv-toolbar [data-tool="window-level"]').focus();
    await page.keyboard.press('ArrowRight');
    if ((await focused(page)) !== 'pan')
      failures.push(`ArrowRight in the toolbar focused ${await focused(page)}`);
    await page.keyboard.press('Enter');
    if (
      (await page.locator('dv-toolbar [data-tool="pan"]').getAttribute('aria-pressed')) !== 'true'
    )
      failures.push('Enter on Pan did not make it the active tool');
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    if (
      (await page.locator('dv-toolbar [data-tool="window-level"]').getAttribute('aria-pressed')) !==
      'true'
    )
      failures.push('Space on Window / level did not make it the active tool');

    // The mouse drives the left-button tool through the slot into Cornerstone.
    const box = await page.locator(VIEWPORT).boundingBox();
    if (box === null) throw new Error('the viewport has no box');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 60, centre.y - 40, { steps: 8 });
    await page.mouse.up();
    await waitFor(
      page,
      'the window label after a drag',
      async () => /window \d+/.test(await label(page)),
      failures,
    );

    // The keyboard reaches the viewport once it has the focus: scroll, reset.
    await page.mouse.click(centre.x, centre.y);
    if ((await focused(page)) !== 'viewport:vp-0')
      failures.push(`clicking the viewport focused ${await focused(page)}`);
    const before = await label(page);
    const index = Number(/image (\d+) of/.exec(before)?.[1] ?? '0');
    await page.keyboard.press('ArrowDown');
    await waitFor(
      page,
      'the slice to advance',
      async () => (await label(page)).includes(`image ${(index + 1).toString()} of`),
      failures,
    );
    await page.keyboard.press('r');
    await waitFor(
      page,
      'reset to clear the window',
      async () => !/window \d+/.test(await label(page)),
      failures,
    );

    // The live region says it, once, after the picture has been still.
    await waitFor(
      page,
      'the live region to speak',
      async () =>
        (
          (await page.locator('dv-viewer .dv-visually-hidden[role="status"]').textContent()) ?? ''
        ).includes('image'),
      failures,
      5000,
    );

    // The presets menu from the keyboard: Lung, Soft tissue, Bone.
    await page.locator('dv-toolbar [data-menu-id="presets"]').focus();
    await page.keyboard.press('ArrowDown');
    if ((await focused(page)) !== 'preset-lung')
      failures.push(`the menu opened on ${await focused(page)}`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await waitFor(
      page,
      'the bone window',
      async () => (await label(page)).includes('window 2500, level 480'),
      failures,
    );
    if ((await focused(page)) !== 'menu:presets')
      failures.push(`the menu returned the focus to ${await focused(page)}`);

    // Measurements: the Measure menu from the keyboard, a line drawn with the mouse through the
    // slot, then the list in the right-hand panel: name it, leave, come back to it, remove it.
    const windowBeforeMeasuring = (await label(page)).includes('window 2500, level 480');
    await page.locator('dv-toolbar [data-menu-id="measure"]').focus();
    await page.keyboard.press('ArrowDown');
    if ((await focused(page)) !== 'tool-length')
      failures.push(`the Measure menu opened on ${await focused(page)}`);
    // Open, with its entries: no violations here either.
    await runAxe(page, 'measure menu open', failures);
    await page.keyboard.press('Enter');
    if ((await focused(page)) !== 'menu:measure')
      failures.push(`the Measure menu returned the focus to ${await focused(page)}`);
    // The choice is made in the viewer's queue, so the menu shows it a moment after Enter.
    await waitFor(
      page,
      'the Measure menu to show Length',
      async () =>
        (await page.locator('dv-toolbar [data-menu-id="measure"]').getAttribute('data-active')) ===
        'true',
      failures,
      5000,
    );
    const measureBox = await page.locator(VIEWPORT).boundingBox();
    if (measureBox === null) throw new Error('the viewport has no box');
    const middle = {
      x: measureBox.x + measureBox.width / 2,
      y: measureBox.y + measureBox.height / 2,
    };
    const sliceWhenDrawn = /image (\d+) of/.exec(await label(page))?.[1];
    await page.mouse.move(middle.x - 60, middle.y);
    await page.mouse.down();
    await page.mouse.move(middle.x + 60, middle.y, { steps: 8 });
    await page.mouse.up();
    const entries = page.locator('dv-measurement-list [role="option"]');
    if (
      await waitFor(
        page,
        'the measurement to be listed',
        async () => (await entries.count()) === 1,
        failures,
      )
    ) {
      const described = (await entries.first().getAttribute('aria-label')) ?? '';
      if (!/^Length 1, Length \d+\.\d mm$/.test(described))
        failures.push(`the measurement is listed as "${described}"`);
      if (windowBeforeMeasuring && !(await label(page)).includes('window 2500, level 480'))
        failures.push('drawing a line with the mouse changed the window');
      await runAxe(page, 'a measurement in the list', failures);

      // Rename it from the keyboard: F2, type, Enter.
      await entries.first().focus();
      await page.keyboard.press('F2');
      if ((await focused(page)) !== 'input')
        failures.push(`F2 on a measurement focused ${await focused(page)}`);
      await runAxe(page, 'renaming a measurement', failures);
      await page.keyboard.type('Aorta');
      await page.keyboard.press('Enter');
      await waitFor(
        page,
        'the new name',
        async () => ((await entries.first().getAttribute('aria-label')) ?? '').startsWith('Aorta,'),
        failures,
      );
      if ((await focused(page)) !== 'measurement')
        failures.push(`after renaming the focus is on ${await focused(page)}`);

      // Leave the slice, then come back to it from the list.
      await page.locator(VIEWPORT).focus();
      for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowDown');
      await waitFor(
        page,
        'the slice to move away',
        async () => !(await label(page)).includes(`image ${sliceWhenDrawn ?? '?'} of`),
        failures,
      );
      await entries.first().focus();
      await page.keyboard.press('Enter');
      await waitFor(
        page,
        'the list to bring the slice back',
        async () => (await label(page)).includes(`image ${sliceWhenDrawn ?? '?'} of`),
        failures,
      );
      if ((await entries.first().getAttribute('aria-selected')) !== 'true')
        failures.push('jumping to a measurement did not pick it in the list');

      // Remove it with the Delete key.
      await entries.first().focus();
      await page.keyboard.press('Delete');
      await waitFor(
        page,
        'the measurement to be removed',
        async () => (await entries.count()) === 0,
        failures,
      );
      if ((await page.locator('dv-measurement-list [role="status"]').count()) !== 1)
        failures.push('the empty list does not say so');
    }
    // Segments: the second tab of the right-hand dock. Load a SEG, change how a segment looks,
    // go to it, load one that does not fit the images, and unload them.
    const segmentsTab = page.locator('dv-panel-dock[placement="right"] [role="tab"]', {
      hasText: 'Segments',
    });
    await segmentsTab.click();
    const seg = (uid: string): ReturnType<Page['locator']> =>
      page.locator(`dv-segmentation-list [data-segmentation="${uid}"]`);
    if (
      await waitFor(
        page,
        'the SEGs to be listed',
        async () => (await page.locator('dv-segmentation-list [data-segmentation]').count()) >= 5,
        failures,
      )
    ) {
      await runAxe(page, 'the Segments tab, nothing loaded', failures);
      const loadButton = seg(input.segSeriesUid).locator('[data-action="load"]');
      if ((await loadButton.getAttribute('aria-label')) === null)
        failures.push('the Load button has no name');
      await loadButton.click();
      if (
        await waitFor(
          page,
          'the segments to be listed',
          async () => (await seg(input.segSeriesUid).locator('[data-segment]').count()) === 2,
          failures,
        )
      ) {
        const names = await seg(input.segSeriesUid).locator('.segment-name').allTextContents();
        if (names.map((name) => name.trim()).join() !== 'Body,Bone insert')
          failures.push(`the segments are listed as ${names.join()}`);
        const redShown = await waitForRed(page, (fraction) => fraction > 0.02);
        if (redShown <= 0.02)
          failures.push(
            `the SEG is not drawn: ${(redShown * 100).toFixed(1)}% of the image is red`,
          );
        await runAxe(page, 'a SEG loaded, with its segments', failures);

        // The checkbox of a segment from the keyboard, and from the mouse.
        const bodyBox = seg(input.segSeriesUid).locator(
          '[data-segment="1"] input[type="checkbox"]',
        );
        await bodyBox.focus();
        if ((await focused(page)) !== 'segment' && (await focused(page)) !== 'input')
          failures.push(`the segment checkbox took the focus as ${await focused(page)}`);
        await page.keyboard.press('Space');
        const redHidden = await waitForRed(page, (fraction) => fraction < 0.001);
        if (redHidden >= 0.001)
          failures.push(`hiding the body left ${(redHidden * 100).toFixed(1)}% of the image red`);
        await bodyBox.check();
        const redBack = await waitForRed(page, (fraction) => fraction > 0.02);
        if (redBack <= 0.02) failures.push('showing the body again did not draw it');

        // Colour and opacity.
        await seg(input.segSeriesUid)
          .locator('[data-segment="1"] input[type="color"]')
          .fill('#00ff00');
        const green = await waitForTint(page, 'green', (fraction) => fraction > 0.02);
        if (green <= 0.02)
          failures.push(`recolouring the body green left ${(green * 100).toFixed(1)}% green`);
        if ((await waitForRed(page, (fraction) => fraction < 0.001)) >= 0.001)
          failures.push('the body is still red after it was made green');
        await seg(input.segSeriesUid).locator('.seg-opacity input[type="range"]').fill('0');
        const clear = await waitForTint(page, 'green', (fraction) => fraction < 0.001);
        if (clear >= 0.001)
          failures.push(`at 0% opacity ${(clear * 100).toFixed(1)}% of the image is still green`);
        await seg(input.segSeriesUid).locator('.seg-opacity input[type="range"]').fill('50');
        if ((await waitForTint(page, 'green', (fraction) => fraction > 0.02)) <= 0.02)
          failures.push('at 50% opacity the SEG is not drawn');

        // Highlight toggles; Go to shows the segment's largest image (the first, for a disc as long as the insert).
        const highlight = seg(input.segSeriesUid).locator(
          '[data-segment="2"] [data-action="highlight"]',
        );
        await highlight.click();
        await waitFor(
          page,
          'the highlight button to be pressed',
          async () => (await highlight.getAttribute('aria-pressed')) === 'true',
          failures,
          5000,
        );
        await highlight.click();
        await waitFor(
          page,
          'the highlight to be taken away',
          async () => (await highlight.getAttribute('aria-pressed')) === 'false',
          failures,
          5000,
        );
        await page.locator(VIEWPORT).focus();
        for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowDown');
        await seg(input.segSeriesUid).locator('[data-segment="2"] [data-action="jump"]').click();
        await waitFor(
          page,
          'Go to to show the first image of the bone insert',
          async () => (await label(page)).includes('image 9 of 64'),
          failures,
        );

        // A SEG that does not lie on the images says so, where a person reads it.
        const off = page.locator('dv-segmentation-list [data-segmentation]', {
          hasText: 'seg-mismatch',
        });
        await off.locator('[data-action="load"]').click();
        if (
          await waitFor(
            page,
            'the warnings of the mismatch SEG',
            async () => (await off.locator('.warnings li').count()) === 2,
            failures,
          )
        ) {
          const warned = (await off.locator('.warnings').textContent()) ?? '';
          if (!warned.includes('another frame of reference') || !warned.includes('12.0 mm'))
            failures.push(`the warnings read "${warned}"`);
        }
        await runAxe(page, 'a SEG with warnings', failures);
        await off.locator('[data-action="unload"]').click();
        await waitFor(
          page,
          'the mismatch SEG to be unloaded',
          async () => (await off.locator('[data-segment]').count()) === 0,
          failures,
        );
      }
    }
    // Window / level has the left button again.
    await page.locator('dv-toolbar [data-tool="window-level"]').click();

    // The series list from the keyboard: pick another series.
    const other = page
      .locator(
        'dv-series-browser [role="option"][aria-selected="false"]:not([aria-disabled="true"])',
      )
      .first();
    const otherUid = await other.getAttribute('data-series');
    const nameBefore = (await label(page)).split(',')[0];
    await other.focus();
    await page.keyboard.press('Enter');
    await waitFor(
      page,
      'the other series to be shown',
      async () =>
        (await page
          .locator(`dv-series-browser [data-series="${otherUid ?? ''}"]`)
          .getAttribute('aria-selected')) === 'true' &&
        (await label(page)).split(',')[0] !== nameBefore,
      failures,
    );
    await page.waitForTimeout(500);
    const lit = await litFraction(page);
    if (lit < 0.05)
      failures.push(
        `after choosing a series the viewport looks blank (${(lit * 100).toFixed(1)}% lit)`,
      );

    // The light theme is as clean.
    await page.evaluate(() => {
      const element = document.querySelector('dv-viewer');
      if (element !== null) element.setAttribute('theme', 'light');
    });
    await page.waitForTimeout(300);
    // The pieces inside follow: the toolbar and the series list are light too, not dark in a light shell.
    const surfaces = await page.evaluate(() => {
      const shell = document.querySelector('dv-viewer')?.shadowRoot;
      const toolbar = shell?.querySelector('dv-toolbar');
      const browser = shell
        ?.querySelector('dv-panel-dock')
        ?.shadowRoot?.querySelector('dv-series-browser');
      return [toolbar, browser].map((element) =>
        element === null || element === undefined
          ? 'missing'
          : getComputedStyle(element).backgroundColor,
      );
    });
    if (surfaces.some((colour) => colour !== 'rgb(255, 255, 255)'))
      failures.push(
        `in the light theme the toolbar and the series list are ${surfaces.join(' and ')}, not white`,
      );
    await runAxe(page, 'light theme', failures);
  } catch (error) {
    failures.push(
      `shell scenario aborted: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await context.close();
  }
  return failures;
}
