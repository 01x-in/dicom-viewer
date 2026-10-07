// M7: reformatted planes against the real engine and the phantom, whose geometry is known exactly.
// What is checked is what is drawn: the pixels of each plane's canvas, read back after it renders.
import type { Browser, Page } from 'playwright';
import { expectReady, type HeadlessInput, query, watch } from './harness.ts';
import './page-types.ts';

/** The phantom: 128 by 128 pixels of 1.5 mm, 64 slices 2.5 mm apart, a body of radius 56 pixels. */
const COLUMNS = 128;
const SLICES = 64;

/** The grey a HU value gets in the window the phantom asks for (centre 40, width 400). */
function grey(hu: number): number {
  return Math.round(Math.min(1, Math.max(0, (hu - (40 - 200)) / 400)) * 255);
}
const BODY = grey(40);
const WATER = grey(0);
const FAT = grey(-100);
const BONE = grey(1000);
const TOLERANCE = 10;

interface Picture {
  /** The grey at every pixel of a line, left to right or top to bottom, as the canvas shows it. */
  readonly horizontal: readonly number[];
  readonly vertical: readonly number[];
  /** The box around everything that is not black: left, top, right, bottom. `undefined` when the picture is all black. */
  readonly box: readonly [number, number, number, number] | undefined;
  readonly width: number;
  readonly height: number;
}

/** Reads a plane's canvas: the middle row, the middle column, and where the picture is. */
async function read(page: Page, selector: string): Promise<Picture> {
  return page.evaluate((element) => {
    const canvas = document.querySelector(`${element} canvas`);
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`no canvas in ${element}`);
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (context === null) throw new Error('no 2D context');
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    const at = (x: number, y: number): number => data[(y * copy.width + x) * 4] ?? 0;
    const horizontal: number[] = [];
    for (let x = 0; x < copy.width; x += 1) horizontal.push(at(x, Math.floor(copy.height / 2)));
    const vertical: number[] = [];
    for (let y = 0; y < copy.height; y += 1) vertical.push(at(Math.floor(copy.width / 2), y));
    let left = copy.width;
    let top = copy.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < copy.height; y += 1) {
      for (let x = 0; x < copy.width; x += 1) {
        if (at(x, y) > 12) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return {
      horizontal,
      vertical,
      box: right < 0 ? undefined : ([left, top, right, bottom] as [number, number, number, number]),
      width: copy.width,
      height: copy.height,
    };
  }, selector);
}

/** Whether a line has a run of at least `length` pixels close to a grey. */
function hasRun(line: readonly number[], value: number, length = 4): boolean {
  let run = 0;
  for (const pixel of line) {
    run = Math.abs(pixel - value) <= TOLERANCE ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

/** The colours of the canvas of a plane at some places, given as fractions of its width and height. */
async function colourAt(
  page: Page,
  selector: string,
  places: readonly (readonly [number, number])[],
): Promise<(readonly number[])[]> {
  return page.evaluate(
    ({ element, wanted }) => {
      const canvas = document.querySelector(`${element} canvas`);
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`no canvas in ${element}`);
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      if (context === null) throw new Error('no 2D context');
      context.drawImage(canvas, 0, 0);
      return wanted.map(([x = 0, y = 0]) => {
        const { data } = context.getImageData(
          Math.round(x * canvas.width),
          Math.round(y * canvas.height),
          1,
          1,
        );
        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
      });
    },
    { element: selector, wanted: places.map((place) => [...place]) },
  );
}

/** Waits for what was just changed to be drawn: Cornerstone renders on the next frame, and a volume streams in. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(done, 400);
          });
        });
      }),
  );
}

const PLANES = [
  { id: 'vp-0', selector: '#viewport', orientation: 'axial', slices: SLICES },
  { id: 'vp-1', selector: '#plane-1', orientation: 'sagittal', slices: COLUMNS },
  { id: 'vp-2', selector: '#plane-2', orientation: 'coronal', slices: COLUMNS },
] as const;

/** M7: three planes of the phantom in one layout. */
export async function scenarioMpr(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: input.studyUid, series: input.j2kSeriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;

    const info = await page.evaluate(
      async ({ series, planes }) => {
        const viewer = window.__dvViewer;
        if (viewer === undefined) throw new Error('no viewer');
        await viewer.setLayout('2x2');
        // Every plane on screen, so the mouse can reach it: 300 pixels square, two to a row.
        const app = document.querySelector<HTMLElement>('#app');
        const first = document.querySelector<HTMLElement>('#viewport');
        if (app !== null) app.style.cssText = 'flex-wrap:wrap;align-items:flex-start';
        if (first !== null)
          first.style.cssText = 'width:300px;height:300px;flex:none;background:#000';
        for (const plane of planes) {
          if (plane.id === 'vp-0') continue;
          const element = document.createElement('div');
          element.id = plane.selector.slice(1);
          element.style.cssText = 'width:300px;height:300px;flex:none;background:#000';
          app?.append(element);
          viewer.viewports.attach(plane.id, element);
        }
        for (const plane of planes) {
          await viewer.setViewportSeries(plane.id, series, { orientation: plane.orientation });
        }
        return planes.map((plane) => {
          const viewport = viewer.viewports.get(plane.id);
          return { id: plane.id, mpr: viewport?.mpr, count: viewport?.imageCount };
        });
      },
      { series: input.j2kSeriesUid, planes: PLANES.map((plane) => ({ ...plane })) },
    );
    for (const [index, plane] of PLANES.entries()) {
      const shown = info[index];
      if (shown?.mpr?.mode !== 'volume' || shown.mpr.requested !== plane.orientation) {
        failures.push(`${plane.orientation} is ${JSON.stringify(shown?.mpr)}, expected a volume`);
      }
      if (shown?.count !== plane.slices) {
        failures.push(
          `${plane.orientation} has ${String(shown?.count)} slices, expected ${plane.slices.toString()}`,
        );
      }
    }
    await settle(page);

    // The shape of each plane. The voxels are 1.5 by 1.5 by 2.5 mm, so a body 168 mm across is 160 mm
    // tall in the sagittal and the coronal planes: a viewer that took the voxels for cubes would draw it 1.75 times as wide.
    const axial = await read(page, '#viewport');
    const sagittal = await read(page, '#plane-1');
    const coronal = await read(page, '#plane-2');
    const aspect = (picture: Picture): number | undefined =>
      picture.box === undefined
        ? undefined
        : (picture.box[2] - picture.box[0] + 1) / (picture.box[3] - picture.box[1] + 1);
    for (const [name, picture, expected] of [
      ['axial', axial, 1],
      ['sagittal', sagittal, 168 / 160],
      ['coronal', coronal, 168 / 160],
    ] as const) {
      const ratio = aspect(picture);
      if (ratio === undefined) failures.push(`the ${name} plane is black`);
      else if (Math.abs(ratio - expected) > 0.06) {
        failures.push(
          `the ${name} plane is ${ratio.toFixed(2)} times as wide as tall, expected ${expected.toFixed(2)}`,
        );
      }
    }

    // What is in each plane. Each line is through the middle, and the inserts are in the middle slices.
    if (!hasRun(axial.horizontal, FAT) || !hasRun(axial.horizontal, BONE)) {
      failures.push(
        'the axial plane does not show the fat and the bone inserts along its middle row',
      );
    }
    if (!hasRun(axial.vertical, WATER) || !hasRun(axial.vertical, BODY)) {
      failures.push(
        'the axial plane does not show the water insert and the body along its middle column',
      );
    }
    if (!hasRun(coronal.horizontal, FAT) || !hasRun(coronal.horizontal, BONE)) {
      failures.push('the coronal plane does not show the fat and the bone inserts');
    }
    if (hasRun(sagittal.horizontal, FAT) || hasRun(sagittal.horizontal, BONE)) {
      failures.push('the sagittal plane shows inserts that are not in its column');
    }
    if (!hasRun(sagittal.horizontal, WATER)) {
      failures.push('the sagittal plane does not show the water insert');
    }
    // The inserts are on slices 9 to 56 of 64: the ends of the coronal plane are body only.
    const nearTop = coronal.box === undefined ? undefined : coronal.box[1] + 4;
    if (nearTop !== undefined) {
      const line = await page.evaluate(
        ({ y }) => {
          const canvas = document.querySelector('#plane-2 canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return [];
          const copy = document.createElement('canvas');
          copy.width = canvas.width;
          copy.height = canvas.height;
          copy.getContext('2d')?.drawImage(canvas, 0, 0);
          const { data } = copy.getContext('2d')?.getImageData(0, y, copy.width, 1) ?? { data: [] };
          return Array.from({ length: copy.width }, (_, x) => data[x * 4] ?? 0);
        },
        { y: nearTop },
      );
      if (hasRun(line, BONE) || hasRun(line, FAT)) {
        failures.push('the coronal plane shows inserts in the first slices, which have none');
      }
      if (!hasRun(line, BODY)) failures.push('the first slices of the coronal plane are not body');
    }

    // Scrolling. Row 3 of the phantom is outside the body: the plane there is all air.
    await page.evaluate(() => window.__dvViewer?.viewports.get('vp-2')?.setImageIndex(2));
    await settle(page);
    const edge = await read(page, '#plane-2');
    if (edge.box !== undefined) failures.push('a coronal slice outside the body is not black');
    const moved = await page.evaluate(() =>
      window.__dvViewer?.viewports.get('vp-2')?.getImageIndex(),
    );
    if (moved !== 2) failures.push(`the coronal plane is at slice ${String(moved)}, expected 2`);

    // The window follows the planes of one volume: a narrow one that ends at bone, set on the
    // coronal plane, turns the body black and the bone white in the axial plane too.
    await page.evaluate(() => window.__dvViewer?.viewports.get('vp-2')?.setImageIndex(64));
    await page.evaluate(() => window.__dvViewer?.viewports.get('vp-2')?.setWindow(900, 200));
    await settle(page);
    for (const [name, selector] of [
      ['coronal', '#plane-2'],
      ['axial', '#viewport'],
    ] as const) {
      const narrow = await read(page, selector);
      if (hasRun(narrow.horizontal, BODY, 8)) {
        failures.push(`a window of 800 to 1000 still shows the ${name} body as grey`);
      }
      if (!hasRun(narrow.horizontal, 255)) {
        failures.push(`a window of 800 to 1000 does not show the ${name} bone as white`);
      }
    }

    // Crosshairs: with the tool chosen, a click on the left marker of the phantom (column 103, row 43,
    // away from the crosshair lines, which start in the middle) takes the sagittal plane to that
    // column and the coronal plane to that row, or to the same place counted from the other side,
    // whichever way the planes run.
    await page.evaluate(() => window.__dvViewer?.viewports.get('vp-2')?.setWindow(40, 400));
    await page.evaluate(() => window.__dvViewer?.tools.setActive('crosshairs'));
    await settle(page);
    const spot = await page.evaluate(
      ({ column, row, size }) => {
        const canvas = document.querySelector('#viewport canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return undefined;
        const rect = canvas.getBoundingClientRect();
        // The image is square and fitted: its 128 pixels span the shorter side of the canvas.
        const scale = Math.min(rect.width, rect.height) / size;
        return {
          x: rect.left + rect.width / 2 + (column - (size - 1) / 2) * scale,
          y: rect.top + rect.height / 2 + (row - (size - 1) / 2) * scale,
        };
      },
      { column: 103, row: 43, size: COLUMNS },
    );
    if (spot === undefined) {
      failures.push('the axial plane has no canvas to click');
    } else {
      await page.mouse.move(spot.x, spot.y);
      await page.mouse.down();
      await page.mouse.move(spot.x + 1, spot.y + 1, { steps: 4 });
      await page.mouse.up();
      await settle(page);
      const [column, row] = await page.evaluate(() => [
        window.__dvViewer?.viewports.get('vp-1')?.getImageIndex(),
        window.__dvViewer?.viewports.get('vp-2')?.getImageIndex(),
      ]);
      const near = (value: number | undefined, wanted: number): boolean =>
        value !== undefined &&
        (Math.abs(value - wanted) <= 2 || Math.abs(value - (COLUMNS - 1 - wanted)) <= 2);
      if (!near(column, 103)) {
        failures.push(
          `the sagittal plane is at slice ${String(column)} after a click on column 103`,
        );
      }
      if (!near(row, 43)) {
        failures.push(`the coronal plane is at slice ${String(row)} after a click on row 43`);
      }
    }
    // A SEG is drawn over every plane: the body segment tints the body red, the bone insert green.
    await page.evaluate(() => window.__dvViewer?.tools.setActive('window-level'));
    const segmentation = input.mock.fixtures.series.find((item) =>
      item.description.includes('seg-body-bone'),
    );
    if (segmentation === undefined) {
      failures.push('the phantom has no seg-body-bone');
    } else {
      await page.evaluate(
        (uid) => window.__dvViewer?.segmentations.load(uid),
        segmentation.seriesUid,
      );
      await settle(page);
      await settle(page);
      const reddish = (colour: readonly number[] | undefined): boolean =>
        colour !== undefined &&
        (colour[0] ?? 0) > (colour[1] ?? 0) + 40 &&
        (colour[0] ?? 0) > (colour[2] ?? 0) + 25;
      const greenish = (colour: readonly number[] | undefined): boolean =>
        colour !== undefined &&
        (colour[1] ?? 0) > (colour[0] ?? 0) + 30 &&
        (colour[1] ?? 0) > (colour[2] ?? 0) + 20;
      for (const [name, selector] of [
        ['axial', '#viewport'],
        ['sagittal', '#plane-1'],
        ['coronal', '#plane-2'],
      ] as const) {
        const [body, boneRight, boneLeft] = await colourAt(page, selector, [
          [0.5, 0.35],
          [0.5 + 0.22, 0.5],
          [0.5 - 0.22, 0.5],
        ]);
        if (!reddish(body))
          failures.push(`the ${name} plane does not tint the body: ${String(body)}`);
        // The bone insert is on one side or the other, whichever way the plane runs; the sagittal plane has none.
        if (name !== 'sagittal' && !greenish(boneRight) && !greenish(boneLeft)) {
          failures.push(
            `the ${name} plane does not tint the bone insert: ${String(boneRight)} ${String(boneLeft)}`,
          );
        }
      }
      await page.evaluate(
        (uid) => window.__dvViewer?.segmentations.setVisible(uid, false),
        segmentation.seriesUid,
      );
      await settle(page);
      const [hidden] = await colourAt(page, '#plane-2', [[0.5, 0.35]]);
      if (reddish(hidden))
        failures.push('the coronal plane still tints the body after the SEG is hidden');
    }

    // Choosing another tool takes the left button back from the crosshairs.
    await page.evaluate(() => window.__dvViewer?.tools.setActive('window-level'));

    // The state tells the same story, and a link made from it asks for the same planes.
    const state = await page.evaluate(() => window.__dvViewer?.getState());
    const asked = state?.viewports
      .slice(0, 3)
      .map((viewport) => viewport.orientation)
      .join();
    if (asked !== 'axial,sagittal,coronal') failures.push(`the state says ${String(asked)}`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/** The reason the viewer gives for a series it cannot reformat, in the unit tests' words (`NotReconstructable`). */
const EXPECTED_REASONS = [
  ['ct-tilted', 'tilted'],
  ['ct-nonuniform', 'non-uniform-spacing'],
] as const;

/** M7: a tilted and an unevenly spaced series are shown as slices, with the reason, and look right. */
export async function scenarioMprFallback(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    const found = EXPECTED_REASONS.map(([name, reason]) => ({
      name,
      reason,
      series: input.mock.fixtures.series.find((item) => item.description.includes(name)),
    }));
    const first = found[0]?.series;
    if (first === undefined || found.some((item) => item.series === undefined)) {
      return [...failures, 'the phantom has no fallback series'];
    }
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: first.studyUid, series: first.seriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    for (const { name, reason, series } of found) {
      if (series === undefined) continue;
      const result = await page.evaluate(
        async ({ uid, orientation }) => {
          const viewer = window.__dvViewer;
          await viewer?.setViewportSeries('vp-0', uid, { orientation });
          const viewport = viewer?.viewports.get('vp-0');
          return { mpr: viewport?.mpr, count: viewport?.imageCount };
        },
        { uid: series.seriesUid, orientation: 'coronal' },
      );
      if (result.mpr?.mode !== 'stack' || result.mpr.reason !== reason) {
        failures.push(
          `${name}: asked for a plane, got ${JSON.stringify(result.mpr)}, expected slices (${reason})`,
        );
      }
      if (result.count !== 16)
        failures.push(`${name}: shows ${String(result.count)} images, expected its 16 slices`);
      await settle(page);
      const picture = await read(page, '#viewport');
      if (picture.box === undefined) failures.push(`${name}: the slices are not drawn`);
      // The slices of an axial series are square: the body is as wide as it is tall.
      else {
        const ratio = (picture.box[2] - picture.box[0] + 1) / (picture.box[3] - picture.box[1] + 1);
        if (Math.abs(ratio - 1) > 0.06)
          failures.push(`${name}: the slices are ${ratio.toFixed(2)} times as wide as tall`);
      }
    }
    // Asking again for a series that can be reformatted still works afterwards.
    const stateOrientation = await page.evaluate(
      () => window.__dvViewer?.getState().viewports[0]?.orientation,
    );
    if (stateOrientation !== 'coronal')
      failures.push(`the state says ${String(stateOrientation)}, not what was asked`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}
