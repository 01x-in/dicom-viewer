// M6: SEG overlays against the real engine and the phantom, whose pixels and segments are known
// exactly. Colours are read back from the viewport's canvas, so what is checked is what is drawn.
import type { Browser, Page } from 'playwright';
import { expectReady, type HeadlessInput, query, watch } from './harness.ts';
import './page-types.ts';

type Rgb = readonly [number, number, number];

// The palette of packages/core/src/segmentations/model.ts, which segments with no colour of their own get.
const RED: Rgb = [230, 25, 75];
const GREEN: Rgb = [60, 180, 75];
const DEEP_BLUE: Rgb = [0, 130, 200];
const PURE_BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];

/** The image of the phantom that every pixel position below is on. */
const SLICE = 31;
/** The phantom is 128 by 128 pixels of 1.5 mm. */
const SIZE = 128;
const PIXEL_MM = 1.5;

interface Point {
  readonly row: number;
  readonly column: number;
}

const BODY: Point = { row: 64, column: 64 };
const MARKER: Point = { row: 43, column: 103 };
const BONE: Point = { row: 64, column: 92 };
const AIR: Point = { row: 36, column: 64 };
const WATER: Point = { row: 92, column: 64 };
const FAT: Point = { row: 64, column: 36 };
const OUTSIDE: Point = { row: 5, column: 5 };
// Where the slab of seg-overlap is alone, where its disc is alone, and (the body's centre) where they meet.
const SLAB: Point = { row: 64, column: 20 };
const DISC: Point = { row: 50, column: 64 };

/** Reads the colours of pixels of the phantom image from the canvas of a viewport element. */
async function colours(page: Page, selector: string, points: readonly Point[]): Promise<Rgb[]> {
  return page.evaluate(
    ({ element, wanted, size }) => {
      const canvas = document.querySelector(`${element} canvas`);
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`no canvas in ${element}`);
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      if (context === null) throw new Error('no 2D context');
      context.drawImage(canvas, 0, 0);
      // The image is fitted to the viewport and centred: the shorter side holds all `size` pixels.
      const scale = Math.min(canvas.width, canvas.height) / size;
      return wanted.map(({ row, column }): [number, number, number] => {
        const x = canvas.width / 2 + (column + 0.5 - size / 2) * scale;
        const y = canvas.height / 2 + (row + 0.5 - size / 2) * scale;
        const { data } = context.getImageData(Math.round(x), Math.round(y), 1, 1);
        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
      });
    },
    { element: selector, wanted: [...points], size: SIZE },
  );
}

/** Waits for what was just changed to be drawn: Cornerstone renders on the next frame. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(done, 120);
          });
        });
      }),
  );
}

/** What a colour looks like laid over a base at an opacity. */
function over(base: Rgb, colour: Rgb, alpha: number): Rgb {
  const mix = (at: 0 | 1 | 2): number => Math.round(base[at] * (1 - alpha) + colour[at] * alpha);
  return [mix(0), mix(1), mix(2)];
}

/**
 * What two layers over one pixel look like. Cornerstone draws each layer as its own image, and the
 * two do not stack one over the other: they share the overlay equally, so the base keeps what
 * neither covers and the two colours count the same.
 */
function overTwice(base: Rgb, first: Rgb, second: Rgb, alpha: number): Rgb {
  const kept = (1 - alpha) ** 2;
  const mix = (at: 0 | 1 | 2): number =>
    Math.round(base[at] * kept + ((first[at] + second[at]) / 2) * (1 - kept));
  return [mix(0), mix(1), mix(2)];
}

const TOLERANCE = 8;

function close(actual: Rgb | undefined, expected: Rgb): boolean {
  return (
    actual?.every((channel, at) => Math.abs(channel - (expected[at] ?? 0)) <= TOLERANCE) === true
  );
}

const show = (colour: Rgb | undefined): string =>
  colour === undefined ? 'nothing' : colour.join(',');

interface Run {
  readonly page: Page;
  readonly failures: string[];
  /** Which viewport element the colours are read from. */
  readonly selector: string;
}

interface Expectation {
  readonly at: Point;
  readonly name: string;
  readonly colour: Rgb;
}

/** Waits for the drawing, then checks the colours at some points against what they should be. */
async function expectColours(
  run: Run,
  label: string,
  wanted: readonly Expectation[],
): Promise<void> {
  await settle(run.page);
  const read = await colours(
    run.page,
    run.selector,
    wanted.map((item) => item.at),
  );
  wanted.forEach((item, index) => {
    if (!close(read[index], item.colour)) {
      run.failures.push(
        `${label}: ${item.name} is ${show(read[index])}, expected about ${show(item.colour)}`,
      );
    }
  });
}

/** The series UID of a phantom SEG, by the name of its directory. */
function segOf(input: HeadlessInput, name: string): string {
  const found = input.mock.fixtures.series.find((item) => item.description.includes(name));
  if (found === undefined) throw new Error(`the phantom has no ${name}`);
  return found.seriesUid;
}

/** M6: what the viewer draws for each SEG of the phantom, and what each call to change it does. */
export async function scenarioSegmentation(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  const bodyBone = segOf(input, 'seg-body-bone');
  const inserts = segOf(input, 'seg-inserts');
  const overlap = segOf(input, 'seg-overlap');
  const mismatch = segOf(input, 'seg-mismatch');
  const fractional = segOf(input, 'seg-fractional');
  const run: Run = { page, failures, selector: '#viewport' };
  const unload = (uid: string): Promise<boolean | undefined> =>
    page.evaluate((id) => window.__dvViewer?.segmentations.unload(id), uid);
  const showImage = async (index: number): Promise<void> => {
    await page.evaluate((at) => window.__dv?.setImageIndex(at), index);
  };
  try {
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: input.studyUid, series: input.j2kSeriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    await showImage(SLICE);
    await settle(page);

    // What the image looks like with no SEG: every colour below is worked out from these.
    const [plainBody, plainMarker, plainBone, plainAir, plainOutside] = await colours(
      page,
      run.selector,
      [BODY, MARKER, BONE, AIR, OUTSIDE],
    );
    if (
      plainBody === undefined ||
      plainMarker === undefined ||
      plainBone === undefined ||
      plainAir === undefined ||
      plainOutside === undefined
    ) {
      return [...failures, 'the image could not be read'];
    }
    if (plainBody.some((channel) => Math.abs(channel - plainBody[0]) > 3)) {
      failures.push(`the image is not grey before a SEG is drawn: ${show(plainBody)}`);
    }

    // Load: where each segment is, as numbers the phantom's SEG fixes.
    const info = await page.evaluate((uid) => window.__dvViewer?.segmentations.load(uid), bodyBone);
    if (info === undefined) return [...failures, 'the SEG did not load'];
    const [body, bone] = info.segments;
    const names = info.segments.map((segment) => `${segment.number.toString()}:${segment.label}`);
    if (names.join() !== '1:Body,2:Bone insert') failures.push(`segments are ${names.join()}`);
    if (body?.voxelCount !== 618640 || bone?.voxelCount !== 12144)
      failures.push(`pixels are ${String(body?.voxelCount)}, ${String(bone?.voxelCount)}`);
    if (body?.imageCount !== 64 || bone?.imageCount !== 48)
      failures.push(`images are ${String(body?.imageCount)}, ${String(bone?.imageCount)}`);
    if (info.warnings.length !== 0)
      failures.push(`a SEG that fits has warnings: ${JSON.stringify(info.warnings)}`);
    if (info.opacity !== 0.5 || body?.opacity !== 1)
      failures.push(`opacity starts at ${info.opacity.toString()} and ${String(body?.opacity)}`);
    if (body?.color.join() !== RED.join() || bone?.color.join() !== GREEN.join())
      failures.push(`colours start as ${String(body?.color)} and ${String(bone?.color)}`);
    // The bone insert is a disc centred on column 92, row 64, on images 8 to 55.
    const expectedCentre = [-95.25 + 92 * PIXEL_MM, -95.25 + 64 * PIXEL_MM, 31.5 * 2.5];
    const centre = bone?.centroid;
    if (
      centre === undefined ||
      centre.some((value, at) => Math.abs(value - (expectedCentre[at] ?? 0)) > 0.1)
    ) {
      failures.push(
        `the bone insert's centre is ${String(centre)}, expected ${expectedCentre.join()}`,
      );
    }
    if (body?.centroid === undefined || Math.abs((body.centroid[2] ?? 0) - 78.75) > 0.1)
      failures.push(`the body's centre is ${String(body?.centroid)}`);

    // Drawn: where the SEG is, over the image, and nowhere else.
    await expectColours(run, 'drawn', [
      { at: BODY, name: 'the body', colour: over(plainBody, RED, 0.5) },
      { at: MARKER, name: 'the marker', colour: over(plainMarker, RED, 0.5) },
      { at: BONE, name: 'the bone insert', colour: over(plainBone, GREEN, 0.5) },
      { at: OUTSIDE, name: 'outside the body', colour: plainOutside },
    ]);

    // Colour, opacity, and visibility, one segment at a time.
    await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.setSegmentColor(uid, 2, '#0000ff'),
      bodyBone,
    );
    await expectColours(run, 'colour', [
      { at: BONE, name: 'the bone insert in blue', colour: over(plainBone, PURE_BLUE, 0.5) },
      { at: BODY, name: 'the body, still red', colour: over(plainBody, RED, 0.5) },
    ]);
    await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.setSegmentOpacity(uid, 2, 0),
      bodyBone,
    );
    await expectColours(run, 'segment opacity 0', [
      { at: BONE, name: 'the bone insert', colour: plainBone },
    ]);
    await page.evaluate(async (uid) => {
      await window.__dvViewer?.segmentations.setSegmentOpacity(uid, 2, 1);
      await window.__dvViewer?.segmentations.setOpacity(uid, 1);
    }, bodyBone);
    await expectColours(run, 'opacity 1', [
      { at: BODY, name: 'the body at full strength', colour: RED },
      { at: BONE, name: 'the bone insert at full strength', colour: PURE_BLUE },
    ]);
    await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.setSegmentVisible(uid, 1, false),
      bodyBone,
    );
    await expectColours(run, 'segment hidden', [
      { at: BODY, name: 'the hidden body', colour: plainBody },
      { at: BONE, name: 'the bone insert, still shown', colour: PURE_BLUE },
    ]);
    await page.evaluate((uid) => window.__dvViewer?.segmentations.setVisible(uid, false), bodyBone);
    await expectColours(run, 'SEG hidden', [
      { at: BONE, name: 'the bone insert of a hidden SEG', colour: plainBone },
    ]);
    await page.evaluate(async (uid) => {
      await window.__dvViewer?.segmentations.setVisible(uid, true);
      await window.__dvViewer?.segmentations.setSegmentVisible(uid, 1, true);
      await window.__dvViewer?.segmentations.setOpacity(uid, 0.5);
      await window.__dvViewer?.segmentations.setSegmentColor(uid, 2, [60, 180, 75]);
    }, bodyBone);
    await expectColours(run, 'restored', [
      { at: BODY, name: 'the body', colour: over(plainBody, RED, 0.5) },
      { at: BONE, name: 'the bone insert', colour: over(plainBone, GREEN, 0.5) },
    ]);

    // Highlight: the others fade, or the chosen segment gets an outline.
    await page.evaluate((uid) => window.__dvViewer?.segmentations.highlight(uid, [2]), bodyBone);
    await expectColours(run, 'dim others', [
      { at: BODY, name: 'the body, dimmed', colour: over(plainBody, RED, 0.1) },
      { at: BONE, name: 'the highlighted bone insert', colour: over(plainBone, GREEN, 0.5) },
    ]);
    await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.highlight(uid, undefined),
      bodyBone,
    );
    await expectColours(run, 'highlight cleared', [
      { at: BODY, name: 'the body', colour: over(plainBody, RED, 0.5) },
    ]);
    // The edge of the bone insert is nine pixels from its centre: sample all round it.
    const ring: Point[] = Array.from({ length: 12 }, (_, step) => {
      const angle = (step / 12) * 2 * Math.PI;
      return {
        row: Math.round(BONE.row + 8.6 * Math.sin(angle)),
        column: Math.round(BONE.column + 8.6 * Math.cos(angle)),
      };
    });
    const before = await colours(page, run.selector, ring);
    await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.highlight(uid, [2], { mode: 'outline' }),
      bodyBone,
    );
    await settle(page);
    const outlined = await colours(page, run.selector, ring);
    const changed = outlined.filter((colour, at) =>
      colour.some((channel, channelAt) => Math.abs(channel - (before[at]?.[channelAt] ?? 0)) > 20),
    ).length;
    if (changed < 6)
      failures.push(`the outline changed ${changed.toString()} of 12 pixels round the bone insert`);
    await expectColours(run, 'outline', [
      { at: BONE, name: 'the inside of the outlined segment', colour: over(plainBone, GREEN, 0.5) },
      { at: BODY, name: 'the body, which keeps its fill', colour: over(plainBody, RED, 0.5) },
    ]);
    await page.evaluate((uid) => window.__dvViewer?.segmentations.highlight(uid, []), bodyBone);

    // Jumping to a segment shows one of its images.
    const slices = await page.evaluate(
      async ({ study, series }) => {
        const loaded = await window.__dvSource?.getSeries(study, series);
        return (loaded?.stacks[0]?.instances ?? []).map((instance) => instance.sopInstanceUID);
      },
      { study: input.studyUid, series: input.j2kSeriesUid },
    );
    // Every image of the bone insert has the same number of pixels, so the first of them is the largest.
    for (const [segment, strategy, expected, from] of [
      [2, 'largestSlice', 8, SLICE],
      [2, 'centroid', 31, 0],
      [2, 'nearestTo', 55, 60],
      [2, 'nearestTo', 8, 0],
      // The body is whole on the first image and has the hole of the bone insert on the middle ones.
      [1, 'largestSlice', 0, SLICE],
    ] as const) {
      await showImage(from);
      const result = await page.evaluate(
        ({ uid, number, how }) =>
          window.__dvViewer?.segmentations.jumpToSegment(uid, number, { strategy: how }),
        { uid: bodyBone, number: segment, how: strategy },
      );
      const shown = await page.evaluate(() => window.__dv?.getImageIndex());
      if (
        result?.imageIndex !== expected ||
        shown !== expected ||
        result.sopInstanceUID !== slices[expected]
      ) {
        failures.push(
          `${strategy} to segment ${segment.toString()} from ${from.toString()} went to ${String(result?.imageIndex)} (shown ${String(shown)}), expected ${expected.toString()}`,
        );
      }
    }
    await showImage(8);
    await expectColours(run, 'after a jump', [
      {
        at: BONE,
        name: 'the bone insert on the image jumped to',
        colour: over(plainBone, GREEN, 0.5),
      },
    ]);
    await unload(bodyBone);

    // A SEG is drawn only over the images it has pixels on.
    await page.evaluate((uid) => window.__dvViewer?.segmentations.load(uid), inserts);
    await showImage(SLICE);
    await expectColours(run, 'inserts', [
      { at: AIR, name: 'the air insert', colour: over(plainAir, RED, 0.5) },
      { at: BONE, name: 'the bone insert', colour: over(plainBone, DEEP_BLUE, 0.5) },
      { at: BODY, name: 'the body, which this SEG does not have', colour: plainBody },
    ]);
    await showImage(2);
    await expectColours(run, 'inserts outside their images', [
      { at: AIR, name: 'where the air insert would be', colour: plainBody },
    ]);
    await unload(inserts);

    // navigateTo loads, highlights, and shows the image.
    const navigated = await page.evaluate(
      ({ series, sop, seg }) =>
        window.__dvViewer?.navigateTo({
          seriesInstanceUID: series,
          sopInstanceUID: sop,
          segmentations: [{ seriesInstanceUID: seg, visible: true, highlightSegments: [4] }],
        }),
      { series: input.j2kSeriesUid, sop: slices[20] ?? '', seg: inserts },
    );
    if (navigated?.imageIndex !== 20 || (navigated.failedSegmentations ?? []).length !== 0)
      failures.push(`navigateTo with a SEG gave ${JSON.stringify(navigated)}`);
    const highlighted = await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.get(uid)?.highlight,
      inserts,
    );
    if (highlighted?.segments.join() !== '4')
      failures.push(`the highlight is ${JSON.stringify(highlighted)}`);
    await expectColours(run, 'navigateTo', [
      { at: BONE, name: 'the highlighted bone insert', colour: over(plainBone, DEEP_BLUE, 0.5) },
      { at: AIR, name: 'the air insert, dimmed', colour: over(plainAir, RED, 0.1) },
    ]);
    await unload(inserts);

    // A SEG that does not lie on the CT is drawn, and says so.
    await showImage(30);
    const off = await page.evaluate((uid) => window.__dvViewer?.segmentations.load(uid), mismatch);
    const codes = off?.warnings.map((warning) => warning.code).join();
    if (codes !== 'frame-of-reference,plane-position')
      failures.push(`the mismatch SEG has warnings ${String(codes)}`);
    if (
      off?.warnings[1]?.message !==
      '21 frames of the SEG are not on the plane of the image they name, by up to 12.0 mm.'
    )
      failures.push(`the mismatch SEG says ${String(off?.warnings[1]?.message)}`);
    await expectColours(run, 'mismatch', [
      { at: BODY, name: 'the disc of the mismatch SEG', colour: over(plainBody, RED, 0.5) },
    ]);
    await unload(mismatch);

    // Segments that share pixels are two layers, and both show.
    const [plainSlab, plainDisc] = await colours(page, run.selector, [SLAB, DISC]);
    const overlapInfo = await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.load(uid),
      overlap,
    );
    if (overlapInfo?.warnings.map((warning) => warning.code).join() !== 'overlapping-segments')
      failures.push(`the overlap SEG has warnings ${JSON.stringify(overlapInfo?.warnings)}`);
    if (plainSlab !== undefined && plainDisc !== undefined) {
      await expectColours(run, 'overlap', [
        { at: SLAB, name: 'the slab alone', colour: over(plainSlab, RED, 0.5) },
        { at: DISC, name: 'the disc alone', colour: over(plainDisc, GREEN, 0.5) },
        {
          at: BODY,
          name: 'where they meet',
          colour: overTwice(plainBody, RED, GREEN, 0.5),
        },
      ]);
    }
    await unload(overlap);

    // A SEG of the fractional type goes through the Cornerstone adapters, and comes out the same.
    const [plainWater, plainFat] = await colours(page, run.selector, [WATER, FAT]);
    const fraction = await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.load(uid),
      fractional,
    );
    const counts = fraction?.segments.map((segment) => segment.voxelCount).join();
    if (counts !== '5313,5313')
      failures.push(`the fractional SEG has ${String(counts)} pixels, expected 5313,5313`);
    if (plainWater !== undefined && plainFat !== undefined) {
      await expectColours(run, 'fractional', [
        { at: WATER, name: 'the water insert', colour: over(plainWater, RED, 0.5) },
        { at: FAT, name: 'the fat insert', colour: over(plainFat, GREEN, 0.5) },
      ]);
    }

    // A SEG loads when the series it names is not the one on screen, and is drawn when that series comes.
    await unload(fractional);
    await page.evaluate(
      (series) => window.__dvViewer?.setViewportSeries('vp-0', series),
      input.evrleSeriesUid,
    );
    await settle(page);
    const unseen = await page.evaluate(
      (uid) =>
        window.__dvViewer?.segmentations.load(uid).then(
          (loaded) => loaded.segments.length,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      inserts,
    );
    if (unseen !== 4) failures.push(`the SEG of a series that is not on screen: ${String(unseen)}`);
    await page.evaluate(
      (series) => window.__dvViewer?.setViewportSeries('vp-0', series),
      input.j2kSeriesUid,
    );
    await showImage(SLICE);
    await expectColours(run, 'a SEG loaded before its series was shown', [
      { at: AIR, name: 'the air insert', colour: over(plainAir, RED, 0.5) },
    ]);

    // Everything the engine held for the SEGs goes with them.
    await unload(inserts);
    const held = await page.evaluate(() => window.__dvDiagnostics?.());
    if (held?.segmentations !== 0)
      failures.push(`${String(held?.segmentations)} segmentations are held after unloading all`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/** Visibility, colour, and highlight are the same in every viewport that shows the series. */
export async function scenarioSegmentationViewports(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  const bodyBone = segOf(input, 'seg-body-bone');
  const viewports = ['#viewport', '#viewport2'].map(
    (selector): Run => ({ page, failures, selector }),
  );
  const forEachViewport = async (
    label: string,
    plain: readonly (readonly [Rgb, Rgb])[],
    wanted: (plainBody: Rgb, plainBone: Rgb) => readonly Expectation[],
  ): Promise<void> => {
    for (const [index, current] of viewports.entries()) {
      const colours = plain[index];
      if (colours === undefined) continue;
      await expectColours(
        current,
        `viewport ${(index + 1).toString()} ${label}`,
        wanted(...colours),
      );
    }
  };
  try {
    await page.goto(
      query(input, {
        wadoRoot: input.mock.url,
        study: input.studyUid,
        series: input.j2kSeriesUid,
        second: '1',
      }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    await page.waitForSelector('#viewport2 canvas');
    await page.evaluate(async (index) => {
      await window.__dvViewer?.viewports.get('vp-0')?.setImageIndex(index);
      await window.__dvViewer?.viewports.get('vp-1')?.setImageIndex(index);
    }, SLICE);
    await settle(page);

    const plain: (readonly [Rgb, Rgb])[] = [];
    for (const current of viewports) {
      const [plainBody, plainBone] = await colours(page, current.selector, [BODY, BONE]);
      plain.push([plainBody ?? [0, 0, 0], plainBone ?? [0, 0, 0]]);
    }

    await page.evaluate((uid) => window.__dvViewer?.segmentations.load(uid), bodyBone);
    await forEachViewport('drawn', plain, (plainBody, plainBone) => [
      { at: BODY, name: 'the body', colour: over(plainBody, RED, 0.5) },
      { at: BONE, name: 'the bone insert', colour: over(plainBone, GREEN, 0.5) },
    ]);

    // One call, both viewports.
    await page.evaluate(async (uid) => {
      await window.__dvViewer?.segmentations.setSegmentVisible(uid, 2, false);
      await window.__dvViewer?.segmentations.setSegmentColor(uid, 1, '#ffff00');
    }, bodyBone);
    await forEachViewport('changed', plain, (plainBody, plainBone) => [
      { at: BODY, name: 'the body in yellow', colour: over(plainBody, YELLOW, 0.5) },
      { at: BONE, name: 'the hidden bone insert', colour: plainBone },
    ]);

    // A viewport that comes later draws what is loaded, as it looks now.
    await page.evaluate(() => {
      const element = document.querySelector('#viewport2');
      if (!(element instanceof HTMLElement)) throw new Error('no second viewport');
      window.__dvViewer?.viewports.detach('vp-1');
      window.__dvViewer?.viewports.attach('vp-1', element);
    });
    await page.waitForSelector('#viewport2 canvas');
    await page.waitForTimeout(500);
    const [, later] = viewports;
    const [, laterPlain] = plain;
    if (later !== undefined && laterPlain !== undefined) {
      await expectColours(later, 'a viewport attached later', [
        { at: BODY, name: 'the body in yellow', colour: over(laterPlain[0], YELLOW, 0.5) },
      ]);
    }

    await page.evaluate((uid) => window.__dvViewer?.segmentations.setVisible(uid, false), bodyBone);
    await forEachViewport('hidden', plain, (plainBody) => [
      { at: BODY, name: 'the body', colour: plainBody },
    ]);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/** What docs/plan.md asks of a SEG: 512 by 512 by 300 pixels with 100 segments, read in under 3 s. */
const BUDGET_MS = Number(process.env['DV_SEG_BUDGET_MS'] ?? '3000');
/** The pixels of the 100 spheres of tools/phantom/perf.py, which are the same on every run. */
const PERF_PIXELS = 4_447_300;

/**
 * The performance budget, on the largest SEG the plan names. The time is the whole call: the
 * request for the file (149 MB, from a server on this machine), reading its header, decoding it on
 * the compute worker, finding where each segment is, and handing it to Cornerstone.
 */
export async function scenarioSegmentationBudget(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  const { perf } = input;
  try {
    await page.goto(
      query(input, { wadoRoot: perf.mock.url, study: perf.studyUid, series: perf.ctSeriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    const result = await page.evaluate(async (uid) => {
      const started = performance.now();
      const info = await window.__dvViewer?.segmentations.load(uid);
      const elapsed = performance.now() - started;
      return {
        elapsed,
        segments: info?.segments.length,
        pixels: info?.segments.reduce((sum, segment) => sum + segment.voxelCount, 0),
        warnings: info?.warnings.length,
      };
    }, perf.segSeriesUid);
    console.log(
      `   segmentation budget: ${String(result.segments)} segments, 512 by 512 by 300, ${Math.round(result.elapsed).toString()} ms (budget ${BUDGET_MS.toString()} ms)`,
    );
    if (result.segments !== 100) failures.push(`the SEG has ${String(result.segments)} segments`);
    if (result.pixels !== PERF_PIXELS)
      failures.push(
        `the SEG has ${String(result.pixels)} pixels, expected ${PERF_PIXELS.toString()}`,
      );
    if (result.warnings !== 0) failures.push(`the SEG has ${String(result.warnings)} warnings`);
    if (result.elapsed > BUDGET_MS)
      failures.push(
        `loading the SEG took ${Math.round(result.elapsed).toString()} ms, over the budget of ${BUDGET_MS.toString()} ms`,
      );
    await page.evaluate((uid) => window.__dvViewer?.segmentations.unload(uid), perf.segSeriesUid);
    const held = await page.evaluate(() => window.__dvDiagnostics?.());
    if (held?.segmentations !== 0)
      failures.push(`${String(held?.segmentations)} segmentations are held after unloading`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}
