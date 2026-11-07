// M10: a DICOM Structured Report written by highdicom (fixtures/phantom/sr-measurements), read by
// the real engine in a browser, and the PDF report of what it made. The shapes of the report are
// at places of the phantom whose numbers are known exactly.
import type { Browser } from 'playwright';
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
  if (actual === undefined || Math.abs(actual - expected) > TOLERANCE) {
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
  } catch (error) {
    failures.push(`scenario aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await watched.close();
  }
  return failures;
}
