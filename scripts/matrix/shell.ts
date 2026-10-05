// Scenario for the styled shell (`<dv-viewer>` and the React and Vue adapters around it), run in every
// framework example: accessibility with axe, and everything a person can do from the keyboard and
// the mouse, against the real engine. The viewport is a light-DOM child shown through a slot, so
// this is also the evidence that Cornerstone's input works across that boundary (ADR 0007).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { type Browser, type ConsoleMessage, type Page } from 'playwright';
import { isIgnorableRequest, litFraction, type SmokeInput } from './smoke.ts';

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
    const broken = await page.evaluate(() => {
      const images = [...document.querySelectorAll('dv-viewer *')].flatMap((element) => [
        ...(element.shadowRoot?.querySelectorAll('img') ?? []),
      ]);
      return images.filter((image) => image.naturalWidth === 0).length;
    });
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
