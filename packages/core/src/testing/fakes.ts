import { DataSourceError } from '../data/errors';
import type {
  DataSource,
  LoadedSeriesData,
  SeriesInstance,
  SeriesStack,
  StudyData,
} from '../data/types';
import type {
  EngineMeasurement,
  MeasurementChange,
  PixelSlice,
  RenderingPort,
  RenderStackOptions,
  SegmentationHandle,
  StackPort,
  ViewSnapshot,
} from '../rendering-port';
import type { SegmentationDisplay } from '../segmentations/display';
import type { SegmentationHeader } from '../segmentations/header';
import type { SegmentIndexEntry, SegmentIndexResult } from '../segmentations/segment-index';
import type { PrimaryTool } from '../tools';

export const STUDY = '1.2.3';
export const CT = '1.2.3.1';
export const CT_TWO_STACKS = '1.2.3.2';
/** A SEG of the CT with two segments, `Body` (1) and `Lesion` (2). */
export const SEG = '1.2.3.9';
/** A second SEG of the CT, with three segments. */
export const SEG_SECOND = '1.2.3.10';
/** A SEG of the CT whose segments 1 and 2 share pixels, so it has two layers. */
export const SEG_OVERLAP = '1.2.3.11';
/** A SEG of the CT that is in another frame of reference. */
export const SEG_OFF = '1.2.3.12';
/** A SEG of the second stack of `CT_TWO_STACKS`, which has three images. */
export const SEG_ON_SECOND_STACK = '1.2.3.13';
/** A SEG whose bytes cannot be read. */
export const SEG_UNREADABLE = '1.2.3.14';
/** A study whose only series is the SEG: nothing in it can be shown. */
export const ONLY_SEG_STUDY = '1.2.5';
/** A series that is not a SEG or an SR but has no image with rows and columns, so nothing can be shown. */
export const NO_PIXELS = '1.2.3.8';
/** The frame of reference every fake instance is in. */
export const FRAME_OF_REFERENCE = '1.2.3.77';

/** The window every fake stack starts with, as if the images had asked for it. */
export const FAKE_DEFAULT_WINDOW = { center: 40, width: 400 } as const;

function instances(series: string, stack: number, count: number): SeriesInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    sopInstanceUID: `${series}.${stack.toString()}.${index.toString()}`,
    instanceNumber: index + 1,
    imageId: `fake:${series}/${stack.toString()}/${index.toString()}`,
    metadata: {
      '00280010': { vr: 'US', Value: [256] },
      '00280011': { vr: 'US', Value: [512] },
      '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JANE^^^' }] },
      '00100020': { vr: 'LO', Value: ['ID-7'] },
      // Axial slices 2.5 mm apart, 1 mm pixels, and the first pixel's centre at x = y = 0.
      '00200032': { vr: 'DS', Value: [0, 0, index * 2.5] },
      '00200037': { vr: 'DS', Value: [1, 0, 0, 0, 1, 0] },
      '00280030': { vr: 'DS', Value: [1, 1] },
      '00200052': { vr: 'UI', Value: [FRAME_OF_REFERENCE] },
    },
  }));
}

function stackOf(series: string, index: number, count: number): SeriesStack {
  const members = instances(series, index, count);
  return {
    index,
    instances: members,
    imageIds: members.map((member) => member.imageId),
    reconstructable: { ok: true, spacingMm: 1 },
  };
}

interface FakeSegmentSpec {
  readonly number: number;
  readonly label: string;
  readonly layer?: number;
}

function sopsOf(series: string, stack: number, count: number): string[] {
  return instances(series, stack, count).map((instance) => instance.sopInstanceUID);
}

/** The header the fake port reads for each fake SEG: what a real SEG of these images would say. */
function fakeHeader(
  uid: string,
  target: { series: string; stack: number; count: number },
  segments: readonly FakeSegmentSpec[],
  frameOfReference = FRAME_OF_REFERENCE,
): SegmentationHeader {
  const referenced = sopsOf(target.series, target.stack, target.count);
  return {
    sopInstanceUID: `${uid}.1`,
    seriesInstanceUID: uid,
    studyInstanceUID: STUDY,
    seriesDescription: uid === SEG ? 'SEG' : `SEG ${uid}`,
    frameOfReferenceUID: frameOfReference,
    rows: 256,
    columns: 512,
    segments: segments.map(({ number, label }) => ({ number, label })),
    referencedSeriesInstanceUID: target.series,
    referencedSopInstanceUIDs: referenced,
    frames: referenced.flatMap((sop, imageIndex) =>
      segments.map(({ number }) => ({
        segmentNumber: number,
        referencedSopInstanceUID: sop,
        position: [0, 0, imageIndex * 2.5] as const,
      })),
    ),
    orientation: [1, 0, 0, 0, 1, 0],
    pixelSpacing: [1, 1],
  };
}

const ON_CT = { series: CT, stack: 0, count: 10 } as const;
const BODY_AND_LESION: readonly FakeSegmentSpec[] = [
  { number: 1, label: 'Body' },
  { number: 2, label: 'Lesion' },
];

export const FAKE_SEGMENTATION_HEADERS: ReadonlyMap<string, SegmentationHeader> = new Map([
  [SEG, fakeHeader(SEG, ON_CT, BODY_AND_LESION)],
  [
    SEG_SECOND,
    fakeHeader(SEG_SECOND, ON_CT, [
      { number: 1, label: 'Air' },
      { number: 2, label: 'Water' },
      { number: 3, label: 'Fat' },
    ]),
  ],
  [
    SEG_OVERLAP,
    fakeHeader(SEG_OVERLAP, ON_CT, [
      { number: 1, label: 'Slab', layer: 0 },
      { number: 2, label: 'Disc', layer: 1 },
    ]),
  ],
  [SEG_OFF, fakeHeader(SEG_OFF, ON_CT, BODY_AND_LESION, '1.2.3.78')],
  [
    SEG_ON_SECOND_STACK,
    fakeHeader(SEG_ON_SECOND_STACK, { series: CT_TWO_STACKS, stack: 1, count: 3 }, [
      { number: 1, label: 'Small' },
    ]),
  ],
]);

/**
 * Where the fake handle says each segment is: segment n has 10n, 30n, and 20n pixels on three
 * images in a row, so the second of them is the largest and the middle of the three is its centre.
 * The images are 3 to 5 of the CT, or 0 to 2 of a stack that has three.
 */
export function fakeIndexOf(header: SegmentationHeader): SegmentIndexResult {
  const first = header.referencedSopInstanceUIDs.length === 3 ? 0 : 3;
  const segments: SegmentIndexEntry[] = header.segments.map((segment) => {
    const counts = [10 * segment.number, 30 * segment.number, 20 * segment.number];
    const voxelCount = counts.reduce((sum, count) => sum + count, 0);
    return {
      number: segment.number,
      layer: header.seriesInstanceUID === SEG_OVERLAP ? segment.number - 1 : 0,
      voxelCount,
      imageIndices: [first, first + 1, first + 2],
      imageVoxelCounts: counts,
      sumRow: voxelCount * 100,
      sumColumn: voxelCount * 200,
      sumImageIndex: counts.reduce((sum, count, at) => sum + count * (first + at), 0),
    };
  });
  return {
    segments,
    overlaps: header.seriesInstanceUID === SEG_OVERLAP ? [{ a: 1, b: 2, voxelCount: 5 }] : [],
  };
}

export interface FakeSegmentationHandle extends SegmentationHandle {
  readonly id: string;
  readonly header: SegmentationHeader;
  disposed: boolean;
}

export interface FakeSource extends DataSource {
  readonly calls: string[];
  /** Makes the next getSeries or getStudy fail with this status. */
  failNext(status: number): void;
}

/** A study with a 10-slice CT, a CT that splits into stacks of 6 and 3, and a one-instance SEG. */
export function fakeSource(): FakeSource {
  const calls: string[] = [];
  let failure: number | undefined;
  function maybeFail(): void {
    if (failure === undefined) return;
    const status = failure;
    failure = undefined;
    throw new DataSourceError(`HTTP ${status.toString()}`, status);
  }
  const series: Record<string, LoadedSeriesData> = {
    [NO_PIXELS]: {
      studyInstanceUID: STUDY,
      seriesInstanceUID: NO_PIXELS,
      modality: 'OT',
      description: 'Other',
      instances: instances(NO_PIXELS, 0, 2),
      stacks: [],
    },
    [CT]: {
      studyInstanceUID: STUDY,
      seriesInstanceUID: CT,
      modality: 'CT',
      description: 'CT',
      instances: instances(CT, 0, 10),
      stacks: [stackOf(CT, 0, 10)],
    },
    [CT_TWO_STACKS]: {
      studyInstanceUID: STUDY,
      seriesInstanceUID: CT_TWO_STACKS,
      modality: 'CT',
      description: 'CT in two stacks',
      instances: [...instances(CT_TWO_STACKS, 0, 6), ...instances(CT_TWO_STACKS, 1, 3)],
      stacks: [stackOf(CT_TWO_STACKS, 0, 6), stackOf(CT_TWO_STACKS, 1, 3)],
    },
    ...Object.fromEntries(
      [SEG, SEG_SECOND, SEG_OVERLAP, SEG_OFF, SEG_ON_SECOND_STACK, SEG_UNREADABLE].map((uid) => [
        uid,
        {
          studyInstanceUID: STUDY,
          seriesInstanceUID: uid,
          modality: 'SEG',
          description: uid === SEG ? 'SEG' : `SEG ${uid}`,
          instances: instances(uid, 0, 1),
          stacks: [],
        } satisfies LoadedSeriesData,
      ]),
    ),
  };
  return {
    calls,
    failNext(status): void {
      failure = status;
    },
    capabilities: { instanceRetrieve: 'seg-sr-only' },
    frameRequests: undefined,
    getStudy(studyInstanceUID): Promise<StudyData> {
      calls.push(`getStudy ${studyInstanceUID}`);
      return Promise.resolve().then(() => {
        maybeFail();
        if (
          studyInstanceUID !== STUDY &&
          studyInstanceUID !== '1.2.4' &&
          studyInstanceUID !== ONLY_SEG_STUDY
        ) {
          throw new DataSourceError('no such study', 404);
        }
        return {
          studyInstanceUID,
          series: Object.values(series)
            .filter((item) => studyInstanceUID !== ONLY_SEG_STUDY || item.modality === 'SEG')
            .map((item) => ({
              seriesInstanceUID: item.seriesInstanceUID,
              modality: item.modality,
              description: item.description,
              seriesNumber: undefined,
              instanceCount: item.instances.length,
            })),
        };
      });
    },
    getSeries(studyInstanceUID, seriesInstanceUID): Promise<LoadedSeriesData> {
      calls.push(`getSeries ${studyInstanceUID} ${seriesInstanceUID}`);
      return Promise.resolve().then(() => {
        maybeFail();
        const found = series[seriesInstanceUID];
        if (found === undefined) throw new DataSourceError('no such series', 404);
        return found;
      });
    },
    getInstanceBytes(_study, seriesInstanceUID, _sop, modality): Promise<ArrayBuffer> {
      calls.push(`getInstanceBytes ${seriesInstanceUID} ${modality}`);
      // The fake port reads the series back out of these bytes to know which SEG it is.
      return Promise.resolve(new TextEncoder().encode(seriesInstanceUID).buffer);
    },
  };
}

export interface FakeStackPort extends StackPort {
  readonly element: HTMLElement;
  readonly stack: SeriesStack;
  destroyed: boolean;
  /** Every pixel sample this stack served, so a test can tell which stack answered. */
  readonly samples: { imageIndex: number; row: number; column: number }[];
  /** Simulates the image changing without the host asking, as the mouse wheel does. */
  emitImage(index: number): void;
  /** Simulates the view changing without the host asking, as dragging with the mouse does. */
  emitView(change: Partial<ViewSnapshot>): void;
  /** Every change the host asked for, in order, such as `window 40/400` or `zoom 2`. */
  readonly viewCalls: string[];
  /** What the viewer asked the engine for when it drew this stack. */
  readonly renderOptions: RenderStackOptions;
  /** The tool the left mouse button drives, as the host last set it. */
  primaryTool: PrimaryTool | undefined;
  /** The shapes the engine draws now, by id. */
  readonly measurements: Map<string, EngineMeasurement>;
  /** Every shape call the viewer made, such as `add m-1`, `update m-1`, `remove m-1`, or `select m-1`. */
  readonly measurementCalls: string[];
  /** Simulates the person drawing, moving, picking, or removing a shape. Drawing and moving change what is drawn. */
  emitMeasurement(change: MeasurementChange): void;
  /** The slices the viewer decoded for their pixels, by index. */
  readonly slicesRead: number[];
  /** The SEGs this stack draws now, with what is asked of each. */
  readonly segmentations: Map<FakeSegmentationHandle, SegmentationDisplay>;
  /** Every SEG call the viewer made, such as `draw seg-1` or `hide seg-1`. */
  readonly segmentationCalls: string[];
}

export interface FakePort extends RenderingPort {
  readonly stacks: FakeStackPort[];
  readonly log: string[];
  destroyed: boolean;
  /** Holds every `renderStack` until `release()`, to test what happens while one is in flight. */
  hold(): { release(): void };
  /** Every SEG the viewer asked the engine to parse, and what it gave. */
  readonly segmentationLoads: { imageIds: readonly string[]; header: SegmentationHeader }[];
  /** The handles the engine gave out, in order. */
  readonly segmentationHandles: FakeSegmentationHandle[];
  /** Makes the next `loadSegmentation` fail. */
  failNextSegmentationLoad(): void;
  /** Holds every `loadSegmentation` until `release()`. */
  holdSegmentationLoads(): { release(): void };
  /** Every thumbnail asked for, as `imageId@size`. */
  readonly thumbnailCalls: string[];
  /** Makes the next `renderThumbnail` fail. */
  failNextThumbnail(): void;
  /** Holds every `renderThumbnail` until `release()`. Reports how many are in flight at most at once. */
  holdThumbnails(): { release(): void; readonly peak: () => number };
  /** What `readSlice` returns, by image id. By default every pixel is `imageIndex * 1000 + row * 10 + column`. */
  sliceOf: (imageId: string, imageIndex: number) => PixelSlice;
}

export function fakePort(): FakePort {
  const stacks: FakeStackPort[] = [];
  const log: string[] = [];
  const segmentationLoads: FakePort['segmentationLoads'] = [];
  const segmentationHandles: FakeSegmentationHandle[] = [];
  let segmentationFailure = false;
  let segmentationGate: Promise<void> | undefined;
  const thumbnailCalls: string[] = [];
  let thumbnailFailure = false;
  let thumbnailGate: Promise<void> | undefined;
  let thumbnailsInFlight = 0;
  let thumbnailPeak = 0;
  let gate: Promise<void> | undefined;

  const port: FakePort = {
    sliceOf: (_imageId, imageIndex) => ({
      rows: 256,
      columns: 512,
      at: (row, column) => imageIndex * 1000 + row * 10 + column,
    }),
    stacks,
    log,
    destroyed: false,
    segmentationLoads,
    segmentationHandles,
    failNextSegmentationLoad(): void {
      segmentationFailure = true;
    },
    holdSegmentationLoads(): { release(): void } {
      let release: () => void = () => undefined;
      segmentationGate = new Promise((resolve) => {
        release = resolve;
      });
      return {
        release: (): void => {
          segmentationGate = undefined;
          release();
        },
      };
    },
    thumbnailCalls,
    failNextThumbnail(): void {
      thumbnailFailure = true;
    },
    holdThumbnails(): { release(): void; readonly peak: () => number } {
      let release: () => void = () => undefined;
      thumbnailGate = new Promise((resolve) => {
        release = resolve;
      });
      return {
        release: (): void => {
          thumbnailGate = undefined;
          release();
        },
        peak: () => thumbnailPeak,
      };
    },
    hold(): { release(): void } {
      let release: () => void = () => undefined;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return {
        release: (): void => {
          gate = undefined;
          release();
        },
      };
    },
    async renderStack(element, stack, options: RenderStackOptions = {}): Promise<StackPort> {
      log.push(`render ${stack.imageIds[0] ?? '?'}`);
      await gate;
      const listeners = new Set<(index: number) => void>();
      const viewListeners = new Set<(view: ViewSnapshot) => void>();
      let view: ViewSnapshot = {
        window: FAKE_DEFAULT_WINDOW,
        defaultWindow: FAKE_DEFAULT_WINDOW,
        invert: false,
        zoom: 1,
      };
      const changeView = (change: Partial<ViewSnapshot>): void => {
        view = { ...view, ...change };
        for (const listener of [...viewListeners]) listener(view);
      };
      const last = stack.imageIds.length - 1;
      let index =
        options.imageIndex === undefined
          ? Math.floor(stack.imageIds.length / 2)
          : Math.min(Math.max(0, options.imageIndex), last);
      const measurementListeners = new Set<(change: MeasurementChange) => void>();
      const fake: FakeStackPort = {
        element,
        stack,
        destroyed: false,
        measurements: new Map(),
        measurementCalls: [],
        slicesRead: [],
        segmentations: new Map(),
        segmentationCalls: [],
        emitMeasurement(change): void {
          if (change.kind === 'completed' || change.kind === 'modified') {
            fake.measurements.set(change.measurement.id, change.measurement);
          } else if (change.kind === 'removed') {
            fake.measurements.delete(change.id);
          }
          for (const listener of [...measurementListeners]) listener(change);
        },
        samples: [],
        viewCalls: [],
        renderOptions: options,
        primaryTool: undefined,
        imageCount: stack.imageIds.length,
        getImageIndex: () => index,
        setImageIndex(next): Promise<void> {
          index = next;
          for (const listener of [...listeners]) listener(next);
          return Promise.resolve();
        },
        emitImage(next): void {
          index = next;
          for (const listener of [...listeners]) listener(next);
        },
        onImageChange(listener): () => void {
          listeners.add(listener);
          return (): void => {
            listeners.delete(listener);
          };
        },
        getView: () => view,
        setWindow(window): void {
          fake.viewCalls.push(`window ${window.center.toString()}/${window.width.toString()}`);
          changeView({ window });
        },
        setInvert(invert): void {
          fake.viewCalls.push(`invert ${String(invert)}`);
          changeView({ invert });
        },
        setZoom(zoom): void {
          fake.viewCalls.push(`zoom ${zoom.toString()}`);
          changeView({ zoom });
        },
        resetView(): void {
          fake.viewCalls.push('reset');
          changeView({ window: view.defaultWindow, invert: false, zoom: 1 });
        },
        setPrimaryTool(tool): void {
          fake.primaryTool = tool;
        },
        emitView: changeView,
        onViewChange(listener): () => void {
          viewListeners.add(listener);
          return (): void => {
            viewListeners.delete(listener);
          };
        },
        sampleHu(imageIndex, row, column): Promise<number> {
          fake.samples.push({ imageIndex, row, column });
          return Promise.resolve(imageIndex * 1000 + row * 10 + column);
        },
        readSlice(imageIndex): Promise<PixelSlice> {
          fake.slicesRead.push(imageIndex);
          const imageId = stack.imageIds[imageIndex];
          if (imageId === undefined) {
            return Promise.reject(new RangeError(`No image at index ${imageIndex.toString()}.`));
          }
          return Promise.resolve(port.sliceOf(imageId, imageIndex));
        },
        addMeasurement(measurement): void {
          fake.measurementCalls.push(`add ${measurement.id}`);
          if (fake.measurements.has(measurement.id)) return;
          if (measurement.imageIndex < 0 || measurement.imageIndex >= stack.imageIds.length) return;
          fake.measurements.set(measurement.id, measurement);
        },
        updateMeasurement(measurement): void {
          fake.measurementCalls.push(`update ${measurement.id}`);
          if (fake.measurements.has(measurement.id)) {
            fake.measurements.set(measurement.id, measurement);
          }
        },
        removeMeasurement(id): void {
          fake.measurementCalls.push(`remove ${id}`);
          fake.measurements.delete(id);
        },
        selectMeasurement(id): void {
          fake.measurementCalls.push(`select ${id ?? 'none'}`);
        },
        onMeasurementChange(listener): () => void {
          measurementListeners.add(listener);
          return (): void => {
            measurementListeners.delete(listener);
          };
        },
        drawSegmentation(handle, display): boolean {
          const fakeHandle = segmentationHandles.find((candidate) => candidate === handle);
          if (
            fakeHandle === undefined ||
            fakeHandle.disposed ||
            fakeHandle.referencedImageIds.length !== stack.imageIds.length ||
            fakeHandle.referencedImageIds.some((imageId, at) => imageId !== stack.imageIds[at])
          ) {
            return false;
          }
          fake.segmentationCalls.push(`draw ${fakeHandle.id}`);
          fake.segmentations.set(fakeHandle, display);
          return true;
        },
        hideSegmentation(handle): void {
          const fakeHandle = segmentationHandles.find((candidate) => candidate === handle);
          if (fakeHandle === undefined) return;
          fake.segmentationCalls.push(`hide ${fakeHandle.id}`);
          fake.segmentations.delete(fakeHandle);
        },
        destroy(): void {
          fake.destroyed = true;
          fake.segmentations.clear();
          fake.measurements.clear();
          measurementListeners.clear();
          log.push(`destroy ${stack.imageIds[0] ?? '?'}`);
        },
      };
      stacks.push(fake);
      return fake;
    },
    async renderThumbnail(stack, imageIndex, size): Promise<string> {
      const imageId = stack.imageIds[imageIndex] ?? '?';
      thumbnailCalls.push(`${imageId}@${size.toString()}`);
      thumbnailsInFlight += 1;
      thumbnailPeak = Math.max(thumbnailPeak, thumbnailsInFlight);
      try {
        await thumbnailGate;
        if (thumbnailFailure) {
          thumbnailFailure = false;
          throw new Error('The picture could not be drawn.');
        }
        return `data:image/fake,${imageId}@${size.toString()}`;
      } finally {
        thumbnailsInFlight -= 1;
      }
    },
    readSegmentationHeader(bytes): SegmentationHeader {
      const uid = new TextDecoder().decode(bytes);
      if (uid === SEG_UNREADABLE) {
        throw new Error('The SEG is not a readable DICOM file: the fake says so.');
      }
      const header = FAKE_SEGMENTATION_HEADERS.get(uid);
      if (header === undefined) throw new Error(`The fake knows no SEG ${uid}.`);
      return header;
    },
    async loadSegmentation(imageIds, _bytes, header): Promise<SegmentationHandle> {
      segmentationLoads.push({ imageIds, header });
      await segmentationGate;
      if (segmentationFailure) {
        segmentationFailure = false;
        throw new Error('The SEG could not be parsed.');
      }
      const index = fakeIndexOf(header);
      const handle: FakeSegmentationHandle = {
        id: `seg-${(segmentationHandles.length + 1).toString()}`,
        header,
        disposed: false,
        referencedImageIds: [...imageIds],
        layerCount: header.seriesInstanceUID === SEG_OVERLAP ? 2 : 1,
        labelmapFrameCount: imageIds.length,
        index,
        sample: () => 1,
        sampleAll: () => [1],
        dispose(): void {
          handle.disposed = true;
        },
      };
      segmentationHandles.push(handle);
      return handle;
    },
    destroy(): void {
      port.destroyed = true;
    },
  };
  return port;
}
