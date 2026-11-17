// Scenarios for a series that is one Enhanced CT instance of 64 frames (the phantom's
// `multiframe-ct`, in a study of its own): over DICOMweb in the OncoTrace proxy mode, from a local
// file, and 20 times over for the leak check. The picture is the one of `ct-j2k`, so every value the
// other scenarios check holds here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { expectReady, type HeadlessInput, query, waitForStatus, watch } from './harness.ts';
import {
  BODY,
  BONE,
  close,
  colours,
  GREEN,
  OUTSIDE,
  over,
  RED,
  segOf,
  settle,
  show,
} from './segmentation.ts';
import { EXPECTED_HU } from './smoke.ts';

const FRAMES = 64;
const LOOP_FRAMES = 24;
/** The frame (0-based image) every colour of the SEG scenario is read on, and one at each end, which have no bone insert. */
const SEG_IMAGE = 31;
const IMAGES_WITHOUT_BONE = [0, 2, 63] as const;
/** Frames (1-based) that have the inserts: slices 9 to 56 of the phantom. */
const FRAMES_WITH_INSERTS = [10, 32, 55] as const;

interface MultiFrameSeries {
  readonly studyUid: string;
  readonly seriesUid: string;
}

function multiFrameSeries(input: HeadlessInput): MultiFrameSeries | undefined {
  const found = input.mock.fixtures.series.find((item) =>
    item.description.includes('multiframe-ct'),
  );
  return found === undefined ? undefined : { studyUid: found.studyUid, seriesUid: found.seriesUid };
}

async function checkFrames(
  watched: Awaited<ReturnType<typeof watch>>,
  label: string,
): Promise<void> {
  for (const frame of FRAMES_WITH_INSERTS) {
    for (const probe of EXPECTED_HU) {
      const hu = await watched.page.evaluate(
        ([index, row, column]) => window.__dv?.sampleHu(index, row, column) ?? Number.NaN,
        [frame - 1, probe.row, probe.column] as const,
      );
      if (hu !== probe.hu) {
        watched.failures.push(
          `${label}: frame ${frame.toString()}, ${probe.name} is ${String(hu)} HU, expected ${probe.hu.toString()}`,
        );
      }
    }
  }
  // Without the inserts, the same place in the end frames is the body.
  for (const frame of [1, FRAMES]) {
    const hu = await watched.page.evaluate(
      ([index]) => window.__dv?.sampleHu(index, 64, 92) ?? Number.NaN,
      [frame - 1] as const,
    );
    if (hu !== 40) {
      watched.failures.push(
        `${label}: frame ${frame.toString()} has ${String(hu)} HU where the bone insert would be, expected the body (40)`,
      );
    }
  }
}

export async function scenarioMultiFrame(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    const series = multiFrameSeries(input);
    if (series === undefined) return [...failures, 'the phantom has no multiframe-ct series'];
    input.mock.requestLog.length = 0;
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: series.studyUid, series: series.seriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;

    const count = await page.evaluate(() => window.__dv?.imageCount);
    if (count !== FRAMES)
      failures.push(`shows ${String(count)} images, expected the ${FRAMES.toString()} frames`);
    await checkFrames(watched, 'DICOMweb frames');

    // Scrolling reaches the last frame, which is a request for frame 64 of the one instance.
    await page.evaluate((last) => window.__dv?.setImageIndex(last), FRAMES - 1);
    if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== FRAMES - 1) {
      failures.push('scrolling to the last frame did not work');
    }

    // The frames are named in the requests, one frame each, and the proxy refused none of them.
    const frameRequests = input.mock.requestLog.filter((entry) =>
      /\/frames\/\d+$/.test(entry.path),
    );
    if (frameRequests.length < FRAMES) {
      failures.push(
        `asked for ${frameRequests.length.toString()} frames, expected at least ${FRAMES.toString()}`,
      );
    }
    for (const entry of input.mock.requestLog) {
      if (entry.status >= 400)
        failures.push(`the mock saw ${entry.status.toString()} for ${entry.path}`);
    }

    // A measurement on frame 40 is on frame 40, and only there.
    const result = await page.evaluate(
      async ({ study, seriesUid }) => {
        const viewer = window.__dvViewer;
        if (viewer === undefined) return undefined;
        const loaded = await viewer.loadStudy(study);
        const loadedSeries = await (window.__dvSource?.getSeries(study, seriesUid) ??
          Promise.reject(new Error('no source')));
        const sop = loadedSeries.stacks[0]?.instances[0]?.sopInstanceUID ?? '';
        // Axial frame 40 is 39 slices of 2.5 mm up; the phantom's first pixel is at x = y = -95.25.
        await viewer.measurements.add({
          type: 'length',
          reference: {
            studyInstanceUID: study,
            seriesInstanceUID: seriesUid,
            sopInstanceUID: sop,
            frameNumber: 40,
          },
          points: [
            [-50.25, -50.25, 97.5],
            [-20.25, -50.25, 97.5],
          ],
        });
        await viewer.setViewportSeries('vp-0', seriesUid, { imageIndex: 0 });
        const [measurement] = viewer.measurements.list();
        if (measurement === undefined) return undefined;
        await viewer.measurements.jumpTo(measurement.id);
        const landed = viewer.getState().viewports[0]?.imageIndex;
        const slices = await viewer.measurements.slices();
        const tooFar = await viewer
          .navigateTo({ seriesInstanceUID: seriesUid, sopInstanceUID: sop, frameNumber: 65 })
          .then(
            () => 'accepted',
            (error: unknown) => (error instanceof Error ? error.message : String(error)),
          );
        return {
          series: loaded.series.length,
          frame: measurement.reference.frameNumber,
          landed,
          slice: slices.get(measurement.id),
          tooFar,
        };
      },
      { study: series.studyUid, seriesUid: series.seriesUid },
    );
    if (result === undefined) {
      failures.push('could not make a measurement on frame 40');
    } else {
      if (result.frame !== 40)
        failures.push(`the measurement is on frame ${String(result.frame)}, expected 40`);
      if (result.landed !== 39)
        failures.push(
          `jumping to it showed image ${String(result.landed)}, expected image 39 (frame 40)`,
        );
      if (result.slice !== 40) failures.push(`its slice is ${String(result.slice)}, expected 40`);
      if (!result.tooFar.includes('64 frames'))
        failures.push(`frame 65 was answered with: ${result.tooFar}`);
    }

    // The frames reform into planes, because each has its own position.
    const mpr = await page.evaluate(async (seriesUid) => {
      await window.__dvViewer?.setViewportSeries('vp-0', seriesUid, { orientation: 'coronal' });
      const viewport = window.__dvViewer?.viewports.get('vp-0');
      return { mpr: viewport?.mpr, count: viewport?.imageCount };
    }, series.seriesUid);
    if (mpr.mpr?.mode !== 'volume') {
      failures.push(`asked for a plane, got ${JSON.stringify(mpr.mpr)}, expected a volume`);
    }
    if (mpr.count !== 128)
      failures.push(`the coronal plane has ${String(mpr.count)} images, expected 128`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/**
 * A SEG of the frames of one Enhanced CT instance: each of its frames names a frame of the one
 * instance. The SEG is the labelmap of `seg-body-bone`, so its numbers are those of the SEG of the
 * single-frame series, and the bone insert is on frames 9 to 56 only.
 */
export async function scenarioMultiFrameSegmentation(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    const series = multiFrameSeries(input);
    if (series === undefined) return [...failures, 'the phantom has no multiframe-ct series'];
    const seg = segOf(input, 'multiframe-seg');
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: series.studyUid, series: series.seriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    const showImage = async (index: number): Promise<void> => {
      await page.evaluate((at) => window.__dv?.setImageIndex(at), index);
      await settle(page);
    };
    const read = (points: Parameters<typeof colours>[2]): ReturnType<typeof colours> =>
      colours(page, '#viewport', points);

    await showImage(SEG_IMAGE);
    const [plainBody, plainBone, plainOutside] = await read([BODY, BONE, OUTSIDE]);
    if (plainBody === undefined || plainBone === undefined || plainOutside === undefined) {
      return [...failures, 'the image could not be read'];
    }

    const info = await page.evaluate((uid) => window.__dvViewer?.segmentations.load(uid), seg);
    if (info === undefined) return [...failures, 'the SEG did not load'];
    if (info.referencedSeriesInstanceUID !== series.seriesUid)
      failures.push(`the SEG is on ${info.referencedSeriesInstanceUID}, expected the Enhanced CT`);
    const [body, bone] = info.segments;
    // The numbers of seg-body-bone: the same labelmap, on the frames of one instance.
    if (body?.voxelCount !== 618640 || bone?.voxelCount !== 12144)
      failures.push(`pixels are ${String(body?.voxelCount)}, ${String(bone?.voxelCount)}`);
    if (body?.imageCount !== FRAMES || bone?.imageCount !== 48)
      failures.push(`frames are ${String(body?.imageCount)}, ${String(bone?.imageCount)}`);
    if (info.warnings.length !== 0)
      failures.push(`a SEG that fits has warnings: ${JSON.stringify(info.warnings)}`);

    // Drawn on this frame: the body red, the bone insert green, nothing outside the body.
    await settle(page);
    const [drawnBody, drawnBone, drawnOutside] = await read([BODY, BONE, OUTSIDE]);
    const wanted = [
      ['the body', drawnBody, over(plainBody, RED, 0.5)],
      ['the bone insert', drawnBone, over(plainBone, GREEN, 0.5)],
      ['outside the body', drawnOutside, plainOutside],
    ] as const;
    for (const [name, actual, expected] of wanted) {
      if (!close(actual, expected))
        failures.push(
          `frame ${(SEG_IMAGE + 1).toString()}: ${name} is ${show(actual)}, expected about ${show(expected)}`,
        );
    }

    // And on the frames that have no bone insert, the body is red and the bone's place is the body:
    // a SEG that put every frame on one would show the bone there too.
    for (const index of IMAGES_WITHOUT_BONE) {
      await showImage(index);
      const [here] = await read([BONE]);
      const expected = over(plainBody, RED, 0.5);
      if (!close(here, expected))
        failures.push(
          `frame ${(index + 1).toString()}: the bone insert's place is ${show(here)}, expected the body, ${show(expected)}`,
        );
    }

    // A jump goes to a frame of the one instance, and says which.
    const jump = await page.evaluate(
      async (uid) => window.__dvViewer?.segmentations.jumpToSegment(uid, 2),
      seg,
    );
    // The bone insert is a disc of the same size on frames 9 to 56: the first of them is the largest.
    if (jump === undefined || jump.frameNumber < 9 || jump.frameNumber > 56)
      failures.push(`jumping to the bone insert gave ${JSON.stringify(jump)}`);
    else if ((await page.evaluate(() => window.__dv?.getImageIndex())) !== jump.frameNumber - 1)
      failures.push('the viewport is not on the frame the jump said');

    // In a plane: the SEG goes into the volume of the frames, and the coronal plane shows it.
    const plane = await page.evaluate(async (seriesUid) => {
      await window.__dvViewer?.setViewportSeries('vp-0', seriesUid, { orientation: 'coronal' });
      return window.__dvViewer?.viewports.get('vp-0')?.mpr?.mode;
    }, series.seriesUid);
    if (plane !== 'volume') failures.push(`the plane is ${String(plane)}, expected a volume`);
    await page.evaluate((index) => window.__dv?.setImageIndex(index), 64);
    await settle(page);
    const [inPlane] = await read([{ row: 64, column: 64 }]);
    if (inPlane === undefined || inPlane[0] <= inPlane[2] + 40)
      failures.push(`the coronal plane does not show the body in red: ${show(inPlane)}`);

    const unloaded = await page.evaluate(
      (uid) => window.__dvViewer?.segmentations.unload(uid),
      seg,
    );
    if (unloaded !== true) failures.push('the SEG did not unload');
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

export async function scenarioMultiFrameLocalFile(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    const series = multiFrameSeries(input);
    if (series === undefined) return [...failures, 'the phantom has no multiframe-ct series'];
    input.mock.requestLog.length = 0;
    await page.goto(query(input, { local: '1', series: series.seriesUid }), {
      waitUntil: 'load',
      timeout: 180_000,
    });
    await waitForStatus(page, 'waiting-for-files');
    await page.locator('#files').setInputFiles({
      name: 'multiframe-ct.dcm',
      mimeType: 'application/dicom',
      buffer: readFileSync(join(input.fixturesDir, 'multiframe-ct', '0001.dcm')),
    });
    if (!(await expectReady(watched))) return failures;
    const count = await page.evaluate(() => window.__dv?.imageCount);
    if (count !== FRAMES)
      failures.push(
        `shows ${String(count)} images, expected the ${FRAMES.toString()} frames of the one file`,
      );
    await checkFrames(watched, 'local frames');
    if (input.mock.requestLog.length > 0) failures.push('local files made DICOMweb requests');
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/** A loop with no position: its frames in the order they were recorded, played at the rate it says. */
export async function scenarioMultiFrameLoop(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    const found = input.mock.fixtures.series.find((item) =>
      item.description.includes('multiframe-loop'),
    );
    if (found === undefined) return [...failures, 'the phantom has no multiframe-loop series'];
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: found.studyUid, series: found.seriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    const count = await page.evaluate(() => window.__dv?.imageCount);
    if (count !== LOOP_FRAMES)
      failures.push(`shows ${String(count)} images, expected the ${LOOP_FRAMES.toString()} frames`);

    // The disc moves 3 pixels to the right in each frame, so frames are in the order they were recorded.
    for (const frame of [0, 11, LOOP_FRAMES - 1]) {
      const column = 24 + 3 * frame;
      const [onDisc, off] = await page.evaluate(
        async ([index, at]) => [
          (await window.__dv?.sampleHu(index, 64, at)) ?? Number.NaN,
          (await window.__dv?.sampleHu(index, 64, 0)) ?? Number.NaN,
        ],
        [frame, column] as const,
      );
      if (onDisc !== 220 || off !== 30) {
        failures.push(
          `frame ${(frame + 1).toString()}: ${String(onDisc)} on the disc and ${String(off)} off it, expected 220 and 30`,
        );
      }
    }

    // With no geometry there is no plane to show: the slices are shown, and the reason is said.
    const plane = await page.evaluate(async (seriesUid) => {
      await window.__dvViewer?.setViewportSeries('vp-0', seriesUid, { orientation: 'coronal' });
      return window.__dvViewer?.viewports.get('vp-0')?.mpr;
    }, found.seriesUid);
    if (plane?.mode !== 'stack' || plane.reason !== 'missing-geometry') {
      failures.push(
        `asked for a plane, got ${JSON.stringify(plane)}, expected slices (missing-geometry)`,
      );
    }
    await page.evaluate(
      async (seriesUid) =>
        window.__dvViewer?.setViewportSeries('vp-0', seriesUid, { imageIndex: 0 }),
      found.seriesUid,
    );

    // Playing with no rate asked for uses the one the loop states: a frame time of 40 ms is 25 a second.
    const rate = await page.evaluate(async () => {
      const viewport = window.__dv;
      await viewport?.cine.play();
      const fps = viewport?.cine.fps;
      viewport?.cine.stop();
      return fps;
    });
    if (rate !== 25)
      failures.push(`the loop played at ${String(rate)} frames a second, expected 25`);
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

/** The viewer shown and destroyed `input.cycles` times with the frames, and a plane of them: nothing is left behind. */
export async function scenarioMultiFrameLifecycle(
  browser: Browser,
  input: HeadlessInput,
): Promise<string[]> {
  const watched = await watch(browser, true);
  const { page, failures } = watched;
  try {
    const series = multiFrameSeries(input);
    if (series === undefined) return [...failures, 'the phantom has no multiframe-ct series'];
    await page.goto(
      query(input, {
        cycles: String(input.cycles),
        wadoRoot: input.mock.url,
        study: series.studyUid,
        series: series.seriesUid,
        mpr: '1',
        seg: segOf(input, 'multiframe-seg'),
      }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    const status = await waitForStatus(page, 'cycles-done', 'error');
    if (status !== 'cycles-done') {
      failures.push(`cycles failed: ${await page.evaluate(() => window.__dvError ?? 'unknown')}`);
      return failures;
    }
    const cycles = await page.evaluate(() => window.__dvCycles ?? []);
    if (cycles.length !== input.cycles) {
      failures.push(`ran ${cycles.length.toString()} cycles, expected ${input.cycles.toString()}`);
    }
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
      }
    }
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}
