import { optionalString } from '../data/dicom-json';
import type { LoadedSeriesData, SeriesStack } from '../data/types';
import { isNotFound } from '../data/errors';
import { assertDicomUid } from '../data/uid';
import type { MeasurementChange, RenderingPort, StackPort } from '../rendering-port';
import { measurementValues, type MeasurementValues } from './describe';
import { planeOf } from './geometry';
import { newId } from './ids';
import { fromEngineShape, toEngineShape } from './mappers';
import {
  MAX_LABEL_LENGTH,
  MEASUREMENTS_FORMAT,
  type Measurement,
  type MeasurementReference,
  type MeasurementsDocumentV1,
  parseMeasurement,
  parseMeasurementsDocument,
  type Point3,
  type RoiStats,
} from './model';
import { buildReport, type ReportContext } from './report';
import { measurementsFromSr, type SrSkip } from './sr';
import { probeHu, roiStats } from './stats';

/** Who changed a measurement: the person with the mouse, the host's code, or an import. */
export type MeasurementOrigin = 'user' | 'api' | 'import';

export interface MeasurementEvents {
  'measurement:added': { readonly measurement: Measurement; readonly origin: MeasurementOrigin };
  /** The label or the handles changed, or the pixels inside it were read. */
  'measurement:updated': {
    readonly measurement: Measurement;
    readonly previous: Measurement;
    readonly origin: MeasurementOrigin;
  };
  'measurement:removed': { readonly measurement: Measurement; readonly origin: MeasurementOrigin };
  'measurement:selected': {
    readonly id: string | undefined;
    readonly previous: string | undefined;
  };
}

type Distribute<T> = T extends unknown ? Omit<T, 'id'> & { readonly id?: string } : never;

/** A measurement to add. Leave out `id` and the viewer makes one. */
export type NewMeasurement = Distribute<Measurement>;

export interface MeasurementFilter {
  readonly studyInstanceUID?: string;
  readonly seriesInstanceUID?: string;
  readonly sopInstanceUID?: string;
}

export interface MeasurementChanges {
  /** The name. `null` or an empty string takes it away. */
  readonly label?: string | null;
  /** The handles, as many as the measurement's type has. */
  readonly points?: readonly Point3[];
}

/** What `exportJson` returns: the document `importJson` reads, with the numbers worked out for each measurement. */
export interface MeasurementsExportV1 extends MeasurementsDocumentV1 {
  readonly measurements: readonly (Measurement & { readonly values: MeasurementValues })[];
}

export interface ImportOptions {
  /** `merge` (the default) keeps what is there, and a measurement with the same id is replaced. `replace` starts empty. */
  readonly mode?: 'merge' | 'replace';
}

export interface ImportResult {
  readonly added: number;
  readonly replaced: number;
}

export interface SrLoadResult {
  /** Measurements the report made that were not there before. */
  readonly added: number;
  /** Measurements that an earlier load of the same report made, and this one replaced. */
  readonly replaced: number;
  /** What was left out, by reason. Empty when every shape in the report is kept. */
  readonly skipped: readonly SrSkip[];
}

/** A title longer than this would not fit above the table on a page. */
export const MAX_REPORT_TITLE_LENGTH = 120;

export interface PdfOptions {
  /** The name of the report, at the top of the first page, of at most 120 characters. Default `Measurement report`. */
  readonly title?: string;
}

export interface JumpOptions {
  /** Default `vp-0`. */
  readonly viewportId?: string;
}

export interface MeasurementsApi {
  /** Every measurement, in the order they were made, or those on one study, series, or instance. */
  list(filter?: MeasurementFilter): readonly Measurement[];
  get(id: string): Measurement | undefined;
  /**
   * Adds a measurement. It is drawn when the image it is on is on screen, and its pixels are read
   * then too. Rejects with a `RangeError` for one that is not valid or whose id is taken.
   */
  add(measurement: NewMeasurement): Promise<Measurement>;
  /** Renames a measurement or moves its handles. Rejects with a `RangeError` for an id that is not there or points that do not fit. */
  update(id: string, changes: MeasurementChanges): Promise<Measurement>;
  /** Resolves to whether there was one to remove. */
  remove(id: string): Promise<boolean>;
  /** Removes every measurement, or those on one study, series, or instance. Resolves to how many. */
  clear(filter?: MeasurementFilter): Promise<number>;
  /** The measurement picked now, on the image or in a list. */
  getSelected(): string | undefined;
  /** Picks one measurement, or none with `undefined`. Rejects with a `RangeError` for an id that is not there. */
  select(id: string | undefined): Promise<void>;
  /** Shows the image a measurement is on, and picks it. */
  jumpTo(id: string, options?: JumpOptions): Promise<void>;
  /** Plain data, so `JSON.stringify` works on it. */
  exportJson(): MeasurementsExportV1;
  /**
   * Reads what `exportJson` made, as the document or its JSON text. All or nothing: a document with
   * anything wrong in it adds nothing, and rejects.
   */
  importJson(input: unknown, options?: ImportOptions): Promise<ImportResult>;
  /**
   * Reads a DICOM Structured Report of the study on screen (a TID 1500 measurement report) and
   * keeps its shapes as measurements, as an import does. Lengths, bidirectional measurements,
   * ellipses, rectangles, probes, and angles are kept, each on the image the report puts it on;
   * the numbers are worked out again from the pixels. A shape that cannot be kept is counted in
   * `skipped`. Loading a report again replaces what it made. Rejects with a `RangeError` for a
   * series that is not an SR, and with an `Error` for a report that is not TID 1500.
   */
  loadSr(seriesInstanceUID: string): Promise<SrLoadResult>;
  /**
   * A PDF report of the measurements of the study on screen: one row each, with its numbers, its
   * series and slice, and whether it was drawn, added by code, or imported. It is made in the
   * browser, and it leaves out who the patient is unless the viewer is set to show that, as its
   * overlay is. Text the PDF's standard font cannot draw is shown as `?`, and the report says so.
   * Rejects with a `RangeError` when there are no measurements.
   */
  exportPdf(options?: PdfOptions): Promise<Blob>;
}

/** A stack on screen, with the engine drawing it. */
export interface ShownStack {
  readonly seriesInstanceUID: string;
  readonly stack: SeriesStack;
  readonly port: StackPort;
}

export interface MeasurementDeps {
  /** Runs a change in the viewer's queue, so it comes after the calls made before it. */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  assertAlive(): void;
  emit<K extends keyof MeasurementEvents>(event: K, payload: MeasurementEvents[K]): void;
  /** The study on screen, which a measurement the person draws belongs to. */
  study(): string | undefined;
  /** Shows an instance. Called from inside the queue, so it must not queue itself. */
  navigateNow(target: {
    readonly seriesInstanceUID: string;
    readonly sopInstanceUID: string;
    readonly viewportId?: string;
  }): Promise<unknown>;
  getSeries(studyInstanceUID: string, seriesInstanceUID: string): Promise<LoadedSeriesData>;
  getInstanceBytes(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    modality: string,
  ): Promise<ArrayBuffer>;
  port(): Promise<RenderingPort>;
  /** What the report says about the study, and the series that are named. */
  reportContext(
    studyInstanceUID: string,
    seriesInstanceUIDs: readonly string[],
  ): Promise<ReportContext>;
  /** A failure nobody is waiting for, such as a slice that could not be read for its pixels. */
  fail(error: Error): void;
}

export interface MeasurementsRegistry {
  readonly api: MeasurementsApi;
  /**
   * A stack is on screen: draws what is kept for it, and listens to what the person does to it.
   * Returns what stops that, for when the stack goes away.
   */
  attach(shown: ShownStack): () => void;
  /** Stops the timers. Call it once, from `destroy()`. */
  destroy(): void;
}

/** How long after the last change of a shape its pixels are read again. A drag changes it many times a second. */
export const STATS_DELAY_MS = 150;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** A UID that is not one is the caller's mistake, as a measurement that is not valid is. */
function toRangeOrError(error: unknown): Error {
  const found = toError(error);
  return found instanceof RangeError ? found : new RangeError(found.message);
}

function samePoints(a: readonly Point3[], b: readonly Point3[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (point, index) =>
        b[index]?.[0] === point[0] && b[index][1] === point[1] && b[index][2] === point[2],
    )
  );
}

function sameStats(a: RoiStats | undefined, b: RoiStats | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.pixelCount === b.pixelCount &&
    a.meanHu === b.meanHu &&
    a.stdDevHu === b.stdDevHu &&
    a.minHu === b.minHu &&
    a.maxHu === b.maxHu
  );
}

/** Whether the pixels inside a measurement are still to be read. */
function needsPixels(measurement: Measurement): boolean {
  switch (measurement.type) {
    case 'ellipse':
    case 'rectangle':
      return measurement.stats === undefined;
    case 'probe':
      return measurement.hu === undefined;
    default:
      return false;
  }
}

function matches(measurement: Measurement, filter: MeasurementFilter | undefined): boolean {
  if (filter === undefined) return true;
  const { reference } = measurement;
  return (
    (filter.studyInstanceUID === undefined ||
      filter.studyInstanceUID === reference.studyInstanceUID) &&
    (filter.seriesInstanceUID === undefined ||
      filter.seriesInstanceUID === reference.seriesInstanceUID) &&
    (filter.sopInstanceUID === undefined || filter.sopInstanceUID === reference.sopInstanceUID)
  );
}

function checked(input: unknown): Measurement {
  const parsed = parseMeasurement(input);
  if (!parsed.ok) throw new RangeError(`Not a valid measurement: ${parsed.error}`);
  return parsed.measurement;
}

/**
 * The measurements of one viewer. They live here, as plain data, whatever is on screen; the engine
 * draws the ones whose image is shown, and the person's changes come back from it as events.
 */
export function createMeasurementsRegistry(deps: MeasurementDeps): MeasurementsRegistry {
  const items = new Map<string, Measurement>();
  /** How each measurement came to be. */
  const origins = new Map<string, MeasurementOrigin>();
  const attached = new Set<ShownStack>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let selected: string | undefined;
  let destroyed = false;

  function indexIn(shown: ShownStack, measurement: Measurement): number {
    // A measurement of another study is kept, but never drawn or read on this study's images.
    if (measurement.reference.studyInstanceUID !== deps.study()) return -1;
    if (shown.seriesInstanceUID !== measurement.reference.seriesInstanceUID) return -1;
    return shown.stack.instances.findIndex(
      (instance) => instance.sopInstanceUID === measurement.reference.sopInstanceUID,
    );
  }

  function locate(
    measurement: Measurement,
  ): { readonly shown: ShownStack; readonly imageIndex: number } | undefined {
    for (const shown of attached) {
      const imageIndex = indexIn(shown, measurement);
      if (imageIndex >= 0) return { shown, imageIndex };
    }
    return undefined;
  }

  function draw(measurement: Measurement): void {
    for (const shown of attached) {
      const imageIndex = indexIn(shown, measurement);
      if (imageIndex >= 0) shown.port.addMeasurement(toEngineShape(measurement, imageIndex));
    }
  }

  function redraw(measurement: Measurement): void {
    for (const shown of attached) {
      const imageIndex = indexIn(shown, measurement);
      if (imageIndex >= 0) shown.port.updateMeasurement(toEngineShape(measurement, imageIndex));
    }
  }

  function erase(id: string): void {
    for (const shown of attached) shown.port.removeMeasurement(id);
  }

  function setSelected(id: string | undefined): void {
    if (id === selected) return;
    const previous = selected;
    selected = id;
    deps.emit('measurement:selected', { id, previous });
  }

  /** Picks one measurement on every stack and in the list. Runs in the queue. */
  function pick(id: string | undefined): void {
    for (const shown of attached) shown.port.selectMeasurement(id);
    setSelected(id);
  }

  function replace(next: Measurement, origin: MeasurementOrigin): void {
    const previous = items.get(next.id);
    if (previous === undefined) return;
    items.set(next.id, next);
    deps.emit('measurement:updated', { measurement: next, previous, origin });
  }

  function drop(id: string, origin: MeasurementOrigin): Measurement | undefined {
    const measurement = items.get(id);
    if (measurement === undefined) return undefined;
    items.delete(id);
    origins.delete(id);
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
    if (selected === id) setSelected(undefined);
    deps.emit('measurement:removed', { measurement, origin });
    return measurement;
  }

  /** Reads the pixels a measurement covers, if its image is on screen, and records what they come to. Runs in the queue. */
  async function readPixels(id: string, origin: MeasurementOrigin): Promise<void> {
    const measurement = items.get(id);
    if (measurement === undefined) return;
    if (
      measurement.type !== 'ellipse' &&
      measurement.type !== 'rectangle' &&
      measurement.type !== 'probe'
    ) {
      return;
    }
    const where = locate(measurement);
    const instance = where?.shown.stack.instances[where.imageIndex];
    const plane = instance === undefined ? undefined : planeOf(instance.metadata);
    if (where === undefined || plane === undefined) return;
    const slice = await where.shown.port.readSlice(where.imageIndex);
    // The shape may have been moved, or taken away, while the slice was being decoded.
    const latest = items.get(id);
    if (latest === undefined || !samePoints(latest.points, measurement.points)) return;
    if (latest.type === 'probe') {
      const point = latest.points[0];
      const hu = probeHu(slice, plane, point);
      if (hu !== latest.hu) replace({ ...latest, hu }, origin);
    } else if (latest.type === 'ellipse' || latest.type === 'rectangle') {
      const stats = roiStats(slice, plane, latest);
      if (!sameStats(stats, latest.stats)) replace({ ...latest, stats }, origin);
    }
  }

  function schedulePixels(id: string, origin: MeasurementOrigin, delay: number): void {
    if (destroyed) return;
    const earlier = timers.get(id);
    if (earlier !== undefined) clearTimeout(earlier);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        deps
          .enqueue(() => readPixels(id, origin))
          .catch((error: unknown) => {
            if (!destroyed) deps.fail(toError(error));
          });
      }, delay),
    );
  }

  /** In the queue, for a call that waits for its pixels. A failure to read them is reported, and the call still succeeds. */
  async function readPixelsNow(id: string, origin: MeasurementOrigin): Promise<void> {
    try {
      await readPixels(id, origin);
    } catch (error) {
      if (!destroyed) deps.fail(toError(error));
    }
  }

  function referenceFor(shown: ShownStack, imageIndex: number): MeasurementReference | undefined {
    const study = deps.study();
    const instance = shown.stack.instances[imageIndex];
    if (study === undefined || instance === undefined) return undefined;
    const frameOfReferenceUID = optionalString(instance.metadata, '00200052');
    return {
      studyInstanceUID: study,
      seriesInstanceUID: shown.seriesInstanceUID,
      sopInstanceUID: instance.sopInstanceUID,
      ...(frameOfReferenceUID === undefined ? {} : { frameOfReferenceUID }),
    };
  }

  /** What the person did on a stack. Runs outside the queue, like every report of the mouse. */
  function onEngineChange(shown: ShownStack, change: MeasurementChange): void {
    if (destroyed) return;
    switch (change.kind) {
      case 'completed': {
        const { id, imageIndex } = change.measurement;
        if (items.has(id)) return;
        const reference = referenceFor(shown, imageIndex);
        if (reference === undefined) return;
        const measurement = fromEngineShape(change.measurement, reference);
        if (measurement === undefined) {
          deps.fail(
            new Error(`The engine drew a shape that is not a valid ${change.measurement.type}.`),
          );
          return;
        }
        items.set(id, measurement);
        origins.set(id, 'user');
        deps.emit('measurement:added', { measurement, origin: 'user' });
        schedulePixels(id, 'user', 0);
        return;
      }
      case 'modified': {
        const current = items.get(change.measurement.id);
        // A shape that is still being drawn is not a measurement yet.
        if (current === undefined || samePoints(current.points, change.measurement.points)) return;
        const parsed = parseMeasurement({
          ...current,
          points: change.measurement.points,
          stats: undefined,
          hu: undefined,
        });
        if (!parsed.ok) return;
        replace(parsed.measurement, 'user');
        schedulePixels(current.id, 'user', STATS_DELAY_MS);
        return;
      }
      case 'removed': {
        if (!items.has(change.id)) return;
        drop(change.id, 'user');
        // The engine took it off this stack. Another stack of the same series still shows it.
        erase(change.id);
        return;
      }
      case 'selected':
        if (change.id === undefined || items.has(change.id)) setSelected(change.id);
        return;
    }
  }

  function attach(shown: ShownStack): () => void {
    attached.add(shown);
    for (const measurement of items.values()) {
      if (indexIn(shown, measurement) < 0) continue;
      shown.port.addMeasurement(toEngineShape(measurement, indexIn(shown, measurement)));
      if (needsPixels(measurement)) schedulePixels(measurement.id, 'api', 0);
    }
    if (selected !== undefined) shown.port.selectMeasurement(selected);
    const off = shown.port.onMeasurementChange((change) => {
      onEngineChange(shown, change);
    });
    return (): void => {
      off();
      attached.delete(shown);
    };
  }

  function requireMeasurement(id: string): Measurement {
    const found = items.get(id);
    if (found === undefined) throw new RangeError(`There is no measurement ${id}.`);
    return found;
  }

  /** Runs a call in the queue, turning a throw before the queue into a rejection. */
  function call<T>(task: () => Promise<T>): Promise<T> {
    try {
      deps.assertAlive();
    } catch (error) {
      return Promise.reject(toError(error));
    }
    return deps.enqueue(task);
  }

  /** Keeps measurements that came from outside. A measurement with the same id is replaced. Runs in the queue. */
  function insertImported(incoming: readonly Measurement[]): ImportResult {
    let added = 0;
    let replaced = 0;
    for (const measurement of incoming) {
      if (items.has(measurement.id)) {
        erase(measurement.id);
        replace(measurement, 'import');
        replaced += 1;
      } else {
        items.set(measurement.id, measurement);
        deps.emit('measurement:added', { measurement, origin: 'import' });
        added += 1;
      }
      origins.set(measurement.id, 'import');
      draw(measurement);
      if (needsPixels(measurement)) schedulePixels(measurement.id, 'import', 0);
    }
    return { added, replaced };
  }

  async function exportPdfNow(options: PdfOptions): Promise<Blob> {
    const title = options.title?.trim();
    if (title !== undefined && title.length > MAX_REPORT_TITLE_LENGTH) {
      throw new RangeError(
        `A report title has at most ${MAX_REPORT_TITLE_LENGTH.toString()} characters.`,
      );
    }
    const studyInstanceUID = deps.study();
    if (studyInstanceUID === undefined) {
      throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
    }
    const inStudy = [...items.values()].filter(
      (measurement) => measurement.reference.studyInstanceUID === studyInstanceUID,
    );
    if (inStudy.length === 0) {
      throw new RangeError('There are no measurements of this study to put in a report.');
    }
    const context = await deps.reportContext(studyInstanceUID, [
      ...new Set(inStudy.map((measurement) => measurement.reference.seriesInstanceUID)),
    ]);
    deps.assertAlive();
    const report = buildReport({
      ...context,
      title: title === '' ? undefined : title,
      generatedAt: new Date(),
      studyInstanceUID,
      measurements: inStudy,
      origins,
    });
    // The writer is its own chunk, so a page that never makes a report never loads it.
    const { renderPdf } = await import('../report/pdf');
    return new Blob([renderPdf(report)], { type: 'application/pdf' });
  }

  async function loadSrNow(seriesInstanceUID: string): Promise<SrLoadResult> {
    const studyInstanceUID = deps.study();
    if (studyInstanceUID === undefined) {
      throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
    }
    const report = await deps.getSeries(studyInstanceUID, seriesInstanceUID);
    deps.assertAlive();
    if (report.modality !== 'SR') {
      throw new RangeError(`Series ${seriesInstanceUID} is a ${report.modality}, not an SR.`);
    }
    const srSopInstanceUID = report.instances[0]?.sopInstanceUID;
    if (srSopInstanceUID === undefined) {
      throw new Error(`Series ${seriesInstanceUID} has no instances.`);
    }
    const bytes = await deps.getInstanceBytes(
      studyInstanceUID,
      seriesInstanceUID,
      srSopInstanceUID,
      'SR',
    );
    const port = await deps.port();
    deps.assertAlive();

    // Throws for a file that is not a TID 1500 report, before any image is asked for.
    const referencedSeries = port.readReportReferences(bytes);
    // A series the study does not have (the report may name more than this study holds) is not a
    // reason to refuse the rest: its shapes are counted as left out. Any other failure is.
    const found = await Promise.all(
      referencedSeries.map(async (uid) => {
        try {
          return await deps.getSeries(studyInstanceUID, uid);
        } catch (error) {
          if (isNotFound(error)) return undefined;
          throw error;
        }
      }),
    );
    const referenced = found.filter((series) => series !== undefined);
    deps.assertAlive();
    const references = new Map<string, MeasurementReference>();
    const instances = referenced.flatMap((series) =>
      series.instances.map((instance) => {
        const frameOfReferenceUID = optionalString(instance.metadata, '00200052');
        references.set(instance.sopInstanceUID, {
          studyInstanceUID,
          seriesInstanceUID: series.seriesInstanceUID,
          sopInstanceUID: instance.sopInstanceUID,
          ...(frameOfReferenceUID === undefined ? {} : { frameOfReferenceUID }),
        });
        return instance;
      }),
    );
    const read = await port.readReport(bytes, instances);
    deps.assertAlive();

    const { measurements, skipped } = measurementsFromSr({
      srSopInstanceUID,
      shapes: read.shapes,
      referenceOf: (sopInstanceUID) => references.get(sopInstanceUID),
      unreadable: read.unreadable,
      unsupported: read.unsupported,
    });
    return { ...insertImported(measurements), skipped };
  }

  const api: MeasurementsApi = {
    list: (filter) => [...items.values()].filter((measurement) => matches(measurement, filter)),
    get: (id) => items.get(id),
    add(input): Promise<Measurement> {
      let measurement: Measurement;
      try {
        deps.assertAlive();
        measurement = checked({ ...input, id: input.id ?? newId() });
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return call(async () => {
        if (items.has(measurement.id)) {
          throw new RangeError(`There is already a measurement ${measurement.id}.`);
        }
        items.set(measurement.id, measurement);
        origins.set(measurement.id, 'api');
        draw(measurement);
        deps.emit('measurement:added', { measurement, origin: 'api' });
        if (needsPixels(measurement)) await readPixelsNow(measurement.id, 'api');
        return items.get(measurement.id) ?? measurement;
      });
    },
    update(id, changes): Promise<Measurement> {
      return call(() => {
        const current = requireMeasurement(id);
        const pointsChanged =
          changes.points !== undefined && !samePoints(current.points, changes.points);
        let label = current.label;
        if (changes.label !== undefined) {
          const trimmed = changes.label === null ? '' : changes.label.trim();
          if (trimmed.length > MAX_LABEL_LENGTH) {
            throw new RangeError(`A label has at most ${MAX_LABEL_LENGTH.toString()} characters.`);
          }
          label = trimmed === '' ? undefined : trimmed;
        }
        const next = checked({
          ...current,
          label,
          ...(changes.points === undefined ? {} : { points: changes.points }),
          // New handles make the old numbers wrong until the pixels are read again.
          ...(pointsChanged ? { stats: undefined, hu: undefined } : {}),
        });
        if (next.label === current.label && !pointsChanged) return Promise.resolve(current);
        replace(next, 'api');
        if (pointsChanged) redraw(next);
        return pointsChanged && needsPixels(next)
          ? readPixelsNow(id, 'api').then(() => items.get(id) ?? next)
          : Promise.resolve(next);
      });
    },
    remove(id): Promise<boolean> {
      return call(() => {
        if (!items.has(id)) return Promise.resolve(false);
        erase(id);
        drop(id, 'api');
        return Promise.resolve(true);
      });
    },
    clear(filter): Promise<number> {
      return call(() => {
        let count = 0;
        for (const measurement of [...items.values()]) {
          if (!matches(measurement, filter)) continue;
          erase(measurement.id);
          drop(measurement.id, 'api');
          count += 1;
        }
        return Promise.resolve(count);
      });
    },
    getSelected: () => selected,
    select(id): Promise<void> {
      return call(() => {
        if (id !== undefined) requireMeasurement(id);
        pick(id);
        return Promise.resolve();
      });
    },
    jumpTo(id, options = {}): Promise<void> {
      // One step in the queue: the lookup comes after the calls made before it, and nothing made
      // after it can come between the navigation and the pick.
      return call(async () => {
        const measurement = requireMeasurement(id);
        await deps.navigateNow({
          seriesInstanceUID: measurement.reference.seriesInstanceUID,
          sopInstanceUID: measurement.reference.sopInstanceUID,
          ...(options.viewportId === undefined ? {} : { viewportId: options.viewportId }),
        });
        // The shape may have gone while the image was being shown.
        if (items.has(id)) pick(id);
      });
    },
    exportJson(): MeasurementsExportV1 {
      deps.assertAlive();
      return {
        format: MEASUREMENTS_FORMAT,
        measurements: [...items.values()].map((measurement) => ({
          ...measurement,
          values: measurementValues(measurement),
        })),
      };
    },
    importJson(input, options = {}): Promise<ImportResult> {
      const parsed = parseMeasurementsDocument(input);
      if (!parsed.ok) {
        return Promise.reject(new RangeError(`Not a valid measurements document: ${parsed.error}`));
      }
      const incoming = parsed.measurements;
      return call(() => {
        if (options.mode === 'replace') {
          for (const measurement of [...items.values()]) {
            erase(measurement.id);
            drop(measurement.id, 'import');
          }
        }
        return Promise.resolve(insertImported(incoming));
      });
    },
    exportPdf(options = {}): Promise<Blob> {
      return call(() => exportPdfNow(options));
    },
    loadSr(seriesInstanceUID): Promise<SrLoadResult> {
      try {
        deps.assertAlive();
      } catch (error) {
        return Promise.reject(toError(error));
      }
      try {
        assertDicomUid(seriesInstanceUID, 'seriesInstanceUID');
      } catch (error) {
        return Promise.reject(toRangeOrError(error));
      }
      return call(() => loadSrNow(seriesInstanceUID));
    },
  };

  return {
    api,
    attach,
    destroy(): void {
      destroyed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      attached.clear();
    },
  };
}
