import { DataSourceError } from '../data/errors';
import type {
  DataSource,
  LoadedSeriesData,
  SeriesInstance,
  SeriesStack,
  StudyData,
} from '../data/types';
import type {
  RenderingPort,
  RenderStackOptions,
  SegmentationHandle,
  StackPort,
  ViewSnapshot,
} from '../rendering-port';
import type { PrimaryTool } from '../tools';

export const STUDY = '1.2.3';
export const CT = '1.2.3.1';
export const CT_TWO_STACKS = '1.2.3.2';
export const SEG = '1.2.3.9';

/** The window every fake stack starts with, as if the images had asked for it. */
export const FAKE_DEFAULT_WINDOW = { center: 40, width: 400 } as const;

function instances(series: string, stack: number, count: number): SeriesInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    sopInstanceUID: `${series}.${stack.toString()}.${index.toString()}`,
    instanceNumber: index + 1,
    imageId: `fake:${series}/${stack.toString()}/${index.toString()}`,
    metadata: {},
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
    [SEG]: {
      studyInstanceUID: STUDY,
      seriesInstanceUID: SEG,
      modality: 'SEG',
      description: 'SEG',
      instances: instances(SEG, 0, 1),
      stacks: [],
    },
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
        if (studyInstanceUID !== STUDY && studyInstanceUID !== '1.2.4') {
          throw new DataSourceError('no such study', 404);
        }
        return {
          studyInstanceUID,
          series: Object.values(series).map((item) => ({
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
      return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
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
  /** The tool the left mouse button drives, as the host last set it. */
  primaryTool: PrimaryTool | undefined;
}

export interface FakePort extends RenderingPort {
  readonly stacks: FakeStackPort[];
  readonly log: string[];
  destroyed: boolean;
  /** Holds every `renderStack` until `release()`, to test what happens while one is in flight. */
  hold(): { release(): void };
  readonly segmentationCalls: { imageIds: readonly string[]; bytes: ArrayBuffer }[];
}

export function fakePort(): FakePort {
  const stacks: FakeStackPort[] = [];
  const log: string[] = [];
  const segmentationCalls: FakePort['segmentationCalls'] = [];
  let gate: Promise<void> | undefined;

  const port: FakePort = {
    stacks,
    log,
    destroyed: false,
    segmentationCalls,
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
      const fake: FakeStackPort = {
        element,
        stack,
        destroyed: false,
        samples: [],
        viewCalls: [],
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
        destroy(): void {
          fake.destroyed = true;
          log.push(`destroy ${stack.imageIds[0] ?? '?'}`);
        },
      };
      stacks.push(fake);
      return fake;
    },
    loadSegmentation(imageIds, bytes): Promise<SegmentationHandle> {
      segmentationCalls.push({ imageIds, bytes });
      return Promise.resolve({
        segments: [{ number: 1, label: 'Body' }],
        labelmapFrameCount: imageIds.length,
        layerCount: 1,
        sample: () => 1,
        sampleAll: () => [1],
      });
    },
    destroy(): void {
      port.destroyed = true;
    },
  };
  return port;
}
