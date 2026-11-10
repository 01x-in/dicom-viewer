// M10: a DICOM Structured Report written by highdicom (fixtures/phantom/sr-measurements), read by
// the real engine in a browser, and the PDF report of what it made. The shapes of the report are
// at places of the phantom whose numbers are known exactly.
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright';
import { expectReady, type HeadlessInput, query, watch } from './harness.ts';
import './page-types.ts';

/** The tolerance for a length or an angle worked out from points that were written to 0.01 mm. */
const TOLERANCE = 0.05;

function within(
  failures: string[],
  name: string,
  actual: number | undefined,
  expected: number,
): void {
  if (actual === undefined || !Number.isFinite(actual) || Math.abs(actual - expected) > TOLERANCE) {
    failures.push(`${name} is ${String(actual)}, expected ${expected.toString()}`);
  }
}

/** Loads the report, checks what it made, and makes a PDF of it. */
export async function scenarioReport(browser: Browser, input: HeadlessInput): Promise<string[]> {
  const watched = await watch(browser);
  const { page, failures } = watched;
  try {
    const report = input.mock.fixtures.series.find((item) => item.modality === 'SR');
    if (report === undefined) return ['the phantom has no SR'];
    await page.goto(
      query(input, { wadoRoot: input.mock.url, study: input.studyUid, series: input.j2kSeriesUid }),
      { waitUntil: 'load', timeout: 180_000 },
    );
    if (!(await expectReady(watched))) return failures;
    const before = await page.evaluate(() => window.__dvDiagnostics?.());

    const first = await page.evaluate(
      (uid) => window.__dvViewer?.measurements.loadSr(uid),
      report.seriesUid,
    );
    if (first === undefined) return [...failures, 'the report did not load'];
    if (first.added !== 5 || first.replaced !== 0) {
      failures.push(
        `the report added ${first.added.toString()}, replaced ${first.replaced.toString()}`,
      );
    }
    const skipped = first.skipped.map((skip) => `${skip.reason} (${skip.count.toString()})`);
    if (skipped.length !== 1 || !skipped[0]?.includes('CircleROI')) {
      failures.push(`the report left out: ${skipped.join('; ')}`);
    }

    // Where each shape is, and what the viewer works out for it.
    await page.waitForFunction(
      () => {
        const all = window.__dvViewer?.measurements.list() ?? [];
        return (
          all.length === 5 &&
          all.every((m) =>
            m.type === 'probe'
              ? m.hu !== undefined
              : m.type !== 'ellipse' && m.type !== 'rectangle'
                ? true
                : m.stats !== undefined,
          )
        );
      },
      undefined,
      { timeout: 30_000 },
    );
    const exported = await page.evaluate(() => window.__dvViewer?.measurements.exportJson());
    const byType = new Map((exported?.measurements ?? []).map((m) => [m.type, m]));
    if ([...byType.keys()].sort().join() !== 'angle,ellipse,length,probe,rectangle') {
      failures.push(`the report made ${[...byType.keys()].sort().join()}`);
    }
    within(failures, 'the length', byType.get('length')?.values['lengthMm'], 27);
    within(failures, 'the angle', byType.get('angle')?.values['degrees'], 90);
    within(failures, 'the probe (the water insert, in HU)', byType.get('probe')?.values['hu'], 0);
    within(
      failures,
      'the ellipse mean (the bone insert, in HU)',
      byType.get('ellipse')?.values['meanHu'],
      1000,
    );
    within(
      failures,
      'the rectangle mean (the fat insert, in HU)',
      byType.get('rectangle')?.values['meanHu'],
      -100,
    );
    // The ellipse is 16 by 10 pixels of 1.5 mm, so its area is pi * 12 * 7.5 square millimetres.
    within(
      failures,
      'the ellipse area',
      byType.get('ellipse')?.values['areaMm2'],
      Math.PI * 12 * 7.5,
    );
    within(failures, 'the rectangle area', byType.get('rectangle')?.values['areaMm2'], 225);
    // The names are the findings of the report.
    const names = (exported?.measurements ?? [])
      .map((m) => m.label)
      .sort()
      .join();
    if (names !== 'Body angle,Bone insert,Fat insert,Water centre,Water insert') {
      failures.push(`the measurements are named ${names}`);
    }

    // Again: the same measurements, replaced.
    const second = await page.evaluate(
      (uid) => window.__dvViewer?.measurements.loadSr(uid),
      report.seriesUid,
    );
    if (second?.added !== 0 || second.replaced !== 5) {
      failures.push(
        `loading again added ${String(second?.added)}, replaced ${String(second?.replaced)}`,
      );
    }
    const count = await page.evaluate(() => window.__dvViewer?.measurements.list().length);
    if (count !== 5) failures.push(`there are ${String(count)} measurements after loading twice`);

    // The report engine hands back what it took: no image is held for it.
    const after = await page.evaluate(() => window.__dvDiagnostics?.());
    if (before !== undefined && after !== undefined && after.imagesInUse !== before.imagesInUse) {
      failures.push(
        `${String(after.imagesInUse)} images are held after reading the report, ${String(before.imagesInUse)} before`,
      );
    }

    // The PDF: a file, with the measurements and the footer in it, and no patient.
    const pdf = await page.evaluate(async () => {
      const blob = await window.__dvViewer?.measurements.exportPdf();
      if (blob === undefined) return undefined;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return { type: blob.type, text };
    });
    if (pdf === undefined) return [...failures, 'no PDF was made'];
    if (pdf.type !== 'application/pdf') failures.push(`the PDF has the type ${pdf.type}`);
    if (!pdf.text.startsWith('%PDF-1.4')) failures.push('the file is not a PDF');
    for (const expected of [
      'Water insert',
      'Bone insert',
      'Fat insert',
      'Water centre',
      'Body angle',
      'Imported',
      'Not for diagnosis',
    ]) {
      if (!pdf.text.includes(expected)) failures.push(`the PDF does not say ${expected}`);
    }
    if (pdf.text.includes('Patient'))
      failures.push('the PDF names the patient without being asked');

    // M11: the text, and the SR another tool must read.
    failures.push(...(await checkExports(page, input, report.studyUid, before?.imagesInUse)));
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}

const run = promisify(execFile);
const REPO = new URL('../../', import.meta.url).pathname;

/** What the viewer holds for each measurement, as the checker should find it in the file. */
interface Held {
  readonly type: string;
  readonly label?: string | undefined;
  readonly reference: { readonly sopInstanceUID: string };
  readonly values: Readonly<Record<string, number | undefined>>;
}

const GRAPHIC: Readonly<Record<string, string>> = {
  length: 'POLYLINE',
  probe: 'POINT',
  ellipse: 'ELLIPSE',
  rectangle: 'POLYLINE',
  angle: 'POLYLINE',
};

function expectedGroup(held: Held): Record<string, unknown> {
  const mm = { unit: 'mm' };
  const hu = { unit: "[hnsf'U]" };
  const numbers: Record<string, { value: number; unit: string }> = {};
  const put = (name: string, value: number | undefined, unit: { unit: string }): void => {
    if (value !== undefined) numbers[name] = { value, ...unit };
  };
  const { values } = held;
  if (held.type === 'length') put('Length', values['lengthMm'], mm);
  if (held.type === 'probe') put('Center', values['hu'], hu);
  if (held.type === 'angle') put('Cobb angle', values['degrees'], { unit: 'deg' });
  if (held.type === 'ellipse' || held.type === 'rectangle') {
    put('Area', values['areaMm2'], { unit: 'mm2' });
    put('Mean', values['meanHu'], hu);
    put('Standard Deviation', values['stdDevHu'], hu);
    put('Minimum', values['minHu'], hu);
    put('Maximum', values['maxHu'], hu);
  }
  return {
    label: held.label,
    graphic_type: GRAPHIC[held.type],
    sop: held.reference.sopInstanceUID,
    numbers,
  };
}

/**
 * M11. The text of the report; the SR made twice, with no image held afterwards; the SR read by
 * highdicom (a tool that is not ours) and checked against what the viewer holds; and the SR served
 * back as a series and loaded again, which must give the same measurements.
 */
async function checkExports(
  page: Page,
  input: HeadlessInput,
  studyUid: string,
  imagesBefore: number | undefined,
): Promise<string[]> {
  const failures: string[] = [];
  const text = await page.evaluate(() => window.__dvViewer?.measurements.exportText());
  if (text === undefined) return ['no text was made'];
  for (const expected of [
    'Measurement report',
    'Water insert',
    'Bone insert',
    'Fat insert',
    'Water centre',
    'Body angle',
    '(Imported)',
    'Not for diagnosis',
  ]) {
    if (!text.includes(expected)) failures.push(`the text does not say ${expected}`);
  }
  if (text.includes('Patient')) failures.push('the text names the patient without being asked');

  const held = (await page.evaluate(() => window.__dvViewer?.measurements.exportJson()))
    ?.measurements;
  if (held === undefined) return [...failures, 'no measurements to write'];

  const files = await page.evaluate(async () => {
    const viewer = window.__dvViewer;
    if (viewer === undefined) return undefined;
    const encode = async (blob: Blob): Promise<string> => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    };
    const first = await viewer.measurements.exportSr();
    const second = await viewer.measurements.exportSr({ seriesDescription: 'Second' });
    return { type: first.type, first: await encode(first), second: await encode(second) };
  });
  if (files === undefined) return [...failures, 'no SR was made'];
  if (files.type !== 'application/dicom') failures.push(`the SR has the type ${files.type}`);

  // The engine hands back what it took, in the writer as in the reader.
  const after = await page.evaluate(() => window.__dvDiagnostics?.());
  if (imagesBefore !== undefined && after !== undefined && after.imagesInUse !== imagesBefore) {
    failures.push(
      `${String(after.imagesInUse)} images are held after writing the SR, ${String(imagesBefore)} before`,
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'dv-sr-export-'));
  const firstPath = join(dir, 'first.dcm');
  const secondPath = join(dir, 'second.dcm');
  const expectPath = join(dir, 'expect.json');
  writeFileSync(firstPath, Buffer.from(files.first, 'base64'));
  writeFileSync(secondPath, Buffer.from(files.second, 'base64'));
  writeFileSync(
    expectPath,
    JSON.stringify({
      sop_class: '1.2.840.10008.5.1.4.1.1.88.33',
      utf8: true,
      planar: held.length,
      groups: held.map((measurement) => expectedGroup(measurement)),
    }),
  );
  const sources = ['ct-evrle', 'ct-j2k'].map((name) => join(input.fixturesDir, name));
  try {
    await run(
      'uv',
      [
        'run',
        '--quiet',
        '--project',
        join(REPO, 'tools/phantom'),
        'python',
        join(REPO, 'tools/phantom/check_sr_export.py'),
        firstPath,
        '--expect',
        expectPath,
        '--source',
        ...sources,
        '--same-as',
        secondPath,
      ],
      { timeout: 120_000 },
    );
  } catch (error) {
    const out = error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error);
    for (const line of out.split('\n').filter((entry) => entry !== '')) {
      failures.push(`highdicom: ${line}`);
    }
    if (out === '') failures.push(`the check of the SR did not run: ${String(error)}`);
  }

  // Served back, as a server that was sent it would, and loaded again.
  const seriesUid = input.mock.fixtures.addInstance(
    Buffer.from(files.first, 'base64').buffer.slice(0),
  );
  const again = await page.evaluate(
    async ({ uid, study }) => {
      const viewer = window.__dvViewer;
      if (viewer === undefined) return undefined;
      await viewer.loadStudy(study);
      const before = viewer.measurements.exportJson().measurements;
      await viewer.measurements.clear();
      const loaded = await viewer.measurements.loadSr(uid);
      return { before, loaded, after: viewer.measurements.exportJson().measurements };
    },
    { uid: seriesUid, study: studyUid },
  );
  if (again === undefined) return [...failures, 'the SR could not be loaded again'];
  if (again.loaded.added !== held.length || again.loaded.skipped.length !== 0) {
    failures.push(
      `loading the SR gave ${String(again.loaded.added)} measurements, left out ${JSON.stringify(again.loaded.skipped)}`,
    );
  }
  for (const [at, was] of again.before.entries()) {
    const now = again.after[at];
    if (now === undefined) {
      failures.push(`measurement ${String(at)} did not come back`);
      continue;
    }
    if (now.type !== was.type || now.label !== was.label) {
      failures.push(`measurement ${String(at)} came back as ${now.type} ${String(now.label)}`);
    }
    if (now.reference.sopInstanceUID !== was.reference.sopInstanceUID) {
      failures.push(`measurement ${String(at)} came back on another image`);
    }
    for (const [pointAt, point] of was.points.entries()) {
      const back = now.points[pointAt];
      if (
        back === undefined ||
        point.some((value, axis) => Math.abs(value - (back[axis] ?? Number.NaN)) > 0.01)
      ) {
        failures.push(
          `measurement ${String(at)} point ${String(pointAt)} moved: ${JSON.stringify(point)} to ${JSON.stringify(back)}`,
        );
      }
    }
  }
  return failures;
}
