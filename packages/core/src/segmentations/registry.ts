import type { LoadedSeriesData, SeriesStack } from '../data/types';
import { assertDicomUid } from '../data/uid';
import { numbers } from '../data/dicom-json';
import type { RenderingPort, SegmentationHandle, StackPort } from '../rendering-port';
import { displayOf } from './display';
import type { SegmentationHeader } from './header';
import { centroidMm, imageToShow, JUMP_STRATEGIES, type JumpStrategy } from './locate';
import {
  assertFraction,
  DEFAULT_SEGMENT_OPACITY,
  DEFAULT_SEGMENTATION_OPACITY,
  defaultSegmentColor,
  HIGHLIGHT_MODES,
  type HighlightMode,
  parseColor,
  type Rgb,
  type SegmentInfo,
  type SegmentationInfo,
} from './model';
import type { SegmentIndexEntry } from './segment-index';
import { checkSegmentation, type SegmentationWarning } from './validate';

export interface SegmentationEvents {
  /** A SEG was read and is drawn over the series it segments, whenever that is on screen. */
  'segmentation:loaded': { readonly segmentation: SegmentationInfo };
  /** A SEG was unloaded, or dropped because another study was loaded. */
  'segmentation:unloaded': { readonly seriesInstanceUID: string };
  /** Anything about how a loaded SEG is drawn changed: visibility, colour, opacity, or a highlight. */
  'segmentation:updated': {
    readonly segmentation: SegmentationInfo;
    readonly previous: SegmentationInfo;
  };
  /** The SEG, or one of its segments, was shown or hidden. */
  'segmentation:visibility': {
    readonly seriesInstanceUID: string;
    readonly visible: boolean;
    readonly segments: readonly { readonly number: number; readonly visible: boolean }[];
  };
  /** Something about a SEG that was just loaded is doubtful: where it lies, or what it holds. One event for each. */
  'segmentation:warning': {
    readonly seriesInstanceUID: string;
    readonly warning: SegmentationWarning;
  };
}

export interface HighlightOptions {
  /** Default `dim-others`. */
  readonly mode?: HighlightMode;
}

export interface JumpToSegmentOptions {
  /**
   * Which image of the segment to show. `largestSlice` (the default) is the one with most of its
   * pixels. `centroid` is the one nearest the middle of the segment. `nearestTo` is the one nearest
   * the image on screen now.
   */
  readonly strategy?: JumpStrategy;
  /** Default `vp-0`. */
  readonly viewportId?: string;
}

export interface JumpToSegmentResult {
  readonly viewportId: string;
  /** The series that was shown: the one the SEG segments. */
  readonly seriesInstanceUID: string;
  readonly sopInstanceUID: string;
  readonly imageIndex: number;
  readonly strategy: JumpStrategy;
}

/** How a `navigateTo` leaves a SEG. */
export interface NavigateSegmentation {
  /** The SEG's series. It is loaded if it is not yet. */
  readonly seriesInstanceUID: string;
  readonly visible: boolean;
  /** Segment numbers to highlight, and none to take a highlight away. Absent: the highlight is left as it is. */
  readonly highlightSegments?: readonly number[];
}

export interface SegmentationsApi {
  /** The SEGs that are loaded, in the order they were loaded. They belong to the study on screen. */
  list(): readonly SegmentationInfo[];
  get(seriesInstanceUID: string): SegmentationInfo | undefined;
  /**
   * Retrieves a SEG of the study on screen and reads it against the series it names. It is drawn
   * whenever that series is on screen. Loading one that is loaded gives it back. Rejects if the
   * series is not a SEG, cannot be read, or does not fit the images it names.
   */
  load(seriesInstanceUID: string): Promise<SegmentationInfo>;
  /** Resolves to whether there was one to unload. */
  unload(seriesInstanceUID: string): Promise<boolean>;
  /** Shows or hides a whole SEG. Rejects with a `RangeError` for one that is not loaded. */
  setVisible(seriesInstanceUID: string, visible: boolean): Promise<void>;
  setSegmentVisible(
    seriesInstanceUID: string,
    segmentNumber: number,
    visible: boolean,
  ): Promise<void>;
  /** `[red, green, blue]` as whole numbers 0 to 255, or `#rrggbb`. */
  setSegmentColor(
    seriesInstanceUID: string,
    segmentNumber: number,
    color: Rgb | string,
  ): Promise<void>;
  /** 0 to 1. What is drawn is this times the opacity of the whole SEG. */
  setSegmentOpacity(
    seriesInstanceUID: string,
    segmentNumber: number,
    opacity: number,
  ): Promise<void>;
  /** 0 to 1, for the whole SEG. */
  setOpacity(seriesInstanceUID: string, opacity: number): Promise<void>;
  /** Emphasises segments, or with `undefined` or none takes the highlight away. */
  highlight(
    seriesInstanceUID: string,
    segmentNumbers: readonly number[] | undefined,
    options?: HighlightOptions,
  ): Promise<void>;
  /** Shows an image of a segment, in the series the SEG segments. Rejects for a segment that has no pixels. */
  jumpToSegment(
    seriesInstanceUID: string,
    segmentNumber: number,
    options?: JumpToSegmentOptions,
  ): Promise<JumpToSegmentResult>;
}

/** A stack on screen, with the engine drawing it. */
export interface ShownSegmentationStack {
  readonly seriesInstanceUID: string;
  readonly stack: SeriesStack;
  readonly port: StackPort;
}

export interface SegmentationDeps {
  /** Runs a change in the viewer's queue, so it comes after the calls made before it. */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  assertAlive(): void;
  emit<K extends keyof SegmentationEvents>(event: K, payload: SegmentationEvents[K]): void;
  /** The study on screen, which a SEG belongs to. */
  study(): string | undefined;
  getSeries(studyInstanceUID: string, seriesInstanceUID: string): Promise<LoadedSeriesData>;
  getInstanceBytes(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    modality: string,
  ): Promise<ArrayBuffer>;
  port(): Promise<RenderingPort>;
  /** Shows an instance. Called from inside the queue, so it must not queue itself. */
  navigateNow(target: {
    readonly seriesInstanceUID: string;
    readonly sopInstanceUID: string;
    readonly viewportId?: string;
  }): Promise<unknown>;
  /** The image a viewport shows, if it shows this stack of this series. */
  imageIndexOf(
    viewportId: string,
    seriesInstanceUID: string,
    stackIndex: number,
  ): number | undefined;
  /** A failure nobody is waiting for. */
  fail(error: Error): void;
}

export interface SegmentationsRegistry {
  readonly api: SegmentationsApi;
  /**
   * A stack is on screen: draws the SEGs that belong to it. Returns what stops that, for when the
   * stack goes away.
   */
  attach(shown: ShownSegmentationStack): () => void;
  /**
   * What `navigateTo` asks of SEGs. Loads those that are not loaded, and sets what each should look
   * like. Runs inside the queue. Resolves to the SEGs that could not be loaded, which are also
   * reported as errors.
   */
  applyNavigation(
    entries: readonly NavigateSegmentation[],
  ): Promise<readonly { readonly seriesInstanceUID: string; readonly error: Error }[]>;
  /** The study on screen changed: a SEG belongs to one study, so all of them go. */
  studyChanged(): void;
  /** Gives back everything that is held. Call it once, from `destroy()`. */
  destroy(): void;
}

/** Checks the arguments of a `navigateTo` before anything is queued. Throws. */
export function assertNavigateSegmentations(entries: readonly NavigateSegmentation[]): void {
  for (const entry of entries) {
    assertDicomUid(entry.seriesInstanceUID, 'SeriesInstanceUID');
    if (typeof entry.visible !== 'boolean') {
      throw new RangeError(`visible is true or false, not ${String(entry.visible)}.`);
    }
    for (const number of entry.highlightSegments ?? []) assertSegmentNumber(number);
  }
}

function assertSegmentNumber(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`A segment number is a whole number from 1, not ${String(value)}.`);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface Entry {
  info: SegmentationInfo;
  /** Whether `segmentation:loaded` was emitted, so a warning found by drawing is told as an update. */
  announced: boolean;
  readonly handle: SegmentationHandle;
  readonly stack: SeriesStack;
  readonly located: ReadonlyMap<number, SegmentIndexEntry>;
}

/** The stack of the series that holds most of the instances the SEG names. */
function stackOf(series: LoadedSeriesData, header: SegmentationHeader): SeriesStack {
  const named = new Set([
    ...header.referencedSopInstanceUIDs,
    ...header.frames.flatMap((frame) =>
      frame.referencedSopInstanceUID === undefined ? [] : [frame.referencedSopInstanceUID],
    ),
  ]);
  let best: SeriesStack | undefined;
  let most = 0;
  for (const stack of series.stacks) {
    const count = stack.instances.filter((instance) => named.has(instance.sopInstanceUID)).length;
    if (count > most) {
      most = count;
      best = stack;
    }
  }
  if (best === undefined) {
    throw new Error(
      `The SEG names no image of series ${series.seriesInstanceUID}, which has ${series.stacks.length.toString()} stack(s) to show.`,
    );
  }
  return best;
}

function sameVisibility(a: SegmentationInfo, b: SegmentationInfo): boolean {
  return (
    a.visible === b.visible &&
    a.segments.every((segment, at) => segment.visible === b.segments[at]?.visible)
  );
}

export function createSegmentationsRegistry(deps: SegmentationDeps): SegmentationsRegistry {
  const entries = new Map<string, Entry>();
  const attached = new Set<ShownSegmentationStack>();

  function belongsTo(entry: Entry, shown: ShownSegmentationStack): boolean {
    return (
      shown.seriesInstanceUID === entry.info.referencedSeriesInstanceUID &&
      shown.stack.index === entry.info.referencedStackIndex
    );
  }

  /** Said once for a SEG the engine would not draw: the person sees nothing, and needs to be told why. */
  const NOT_DRAWN: SegmentationWarning = {
    code: 'not-drawn',
    message:
      'The SEG is not drawn on screen: the engine could not draw it, which happens when it renders without WebGL.',
  };

  /**
   * Makes every stack on screen draw the SEG as its settings say. Says whether a stack refused. It
   * changes nothing in the registry, so a rollback can call it without side effects.
   */
  function draw(entry: Entry): boolean {
    const display = displayOf(entry.info);
    let refused = false;
    for (const shown of attached) {
      if (belongsTo(entry, shown) && !shown.port.drawSegmentation(entry.handle, display)) {
        refused = true;
      }
    }
    return refused;
  }

  /** Records, once, that a stack refused to draw the SEG, and says so as an update once the SEG is announced. */
  function noteRefused(entry: Entry, refused: boolean): void {
    if (refused && !entry.info.warnings.some((warning) => warning.code === 'not-drawn')) {
      const previous = entry.info;
      entry.info = { ...previous, warnings: [...previous.warnings, NOT_DRAWN] };
      // `loaded` is announced after the first draw, with the warning in it; later, it is an update.
      if (entry.announced) {
        deps.emit('segmentation:updated', { segmentation: entry.info, previous });
        deps.emit('segmentation:warning', {
          seriesInstanceUID: entry.info.seriesInstanceUID,
          warning: NOT_DRAWN,
        });
      }
    }
  }

  function require(seriesInstanceUID: string): Entry {
    const entry = entries.get(seriesInstanceUID);
    if (entry === undefined) {
      throw new RangeError(`The SEG ${seriesInstanceUID} is not loaded. Load it first.`);
    }
    return entry;
  }

  function requireSegment(entry: Entry, segmentNumber: number): SegmentInfo {
    assertSegmentNumber(segmentNumber);
    const segment = entry.info.segments.find((candidate) => candidate.number === segmentNumber);
    if (segment === undefined) {
      throw new RangeError(
        `The SEG ${entry.info.seriesInstanceUID} has no segment ${segmentNumber.toString()}: it has ${entry.info.segments.map((item) => item.number.toString()).join(', ')}.`,
      );
    }
    return segment;
  }

  /** Replaces a SEG's settings, draws it, and says what changed. Nothing happens when nothing did. */
  function change(entry: Entry, next: SegmentationInfo): void {
    const previous = entry.info;
    if (previous === next) return;
    entry.info = next;
    let refused: boolean;
    try {
      refused = draw(entry);
    } catch (error) {
      // The engine did not take it: the settings go back, and so does what is on screen, as far as it can.
      entry.info = previous;
      try {
        draw(entry);
      } catch {
        // Nothing more can be done; the original failure is the one to report.
      }
      throw error;
    }
    deps.emit('segmentation:updated', { segmentation: next, previous });
    if (!sameVisibility(previous, next)) {
      deps.emit('segmentation:visibility', {
        seriesInstanceUID: next.seriesInstanceUID,
        visible: next.visible,
        segments: next.segments.map(({ number, visible }) => ({ number, visible })),
      });
    }
    noteRefused(entry, refused);
  }

  function withSegment(
    info: SegmentationInfo,
    segmentNumber: number,
    patch: Partial<SegmentInfo>,
  ): SegmentationInfo {
    const keys = Object.keys(patch) as (keyof SegmentInfo)[];
    const segments = info.segments.map((segment) => {
      if (segment.number !== segmentNumber) return segment;
      if (keys.every((key) => Object.is(segment[key], patch[key]))) return segment;
      return { ...segment, ...patch };
    });
    return segments.some((segment, at) => segment !== info.segments[at])
      ? { ...info, segments }
      : info;
  }

  /** Takes a SEG off every stack and gives its memory back. */
  function drop(entry: Entry): void {
    entries.delete(entry.info.seriesInstanceUID);
    for (const shown of attached) {
      if (belongsTo(entry, shown)) shown.port.hideSegmentation(entry.handle);
    }
    entry.handle.dispose();
  }

  async function loadNow(seriesInstanceUID: string): Promise<SegmentationInfo> {
    const studyInstanceUID = deps.study();
    if (studyInstanceUID === undefined) {
      throw new Error('Load a study first: call loadStudy, or setState with a studyInstanceUID.');
    }
    const loaded = entries.get(seriesInstanceUID);
    if (loaded !== undefined) return loaded.info;

    const series = await deps.getSeries(studyInstanceUID, seriesInstanceUID);
    deps.assertAlive();
    if (series.modality !== 'SEG') {
      throw new RangeError(`Series ${seriesInstanceUID} is a ${series.modality}, not a SEG.`);
    }
    const sop = series.instances[0]?.sopInstanceUID;
    if (sop === undefined) throw new Error(`Series ${seriesInstanceUID} has no instances.`);
    const bytes = await deps.getInstanceBytes(studyInstanceUID, seriesInstanceUID, sop, 'SEG');
    const port = await deps.port();
    deps.assertAlive();

    const header = port.readSegmentationHeader(bytes);
    const referencedUid = header.referencedSeriesInstanceUID;
    if (referencedUid === undefined) {
      throw new Error('The SEG does not say which series it segments.');
    }
    const referenced = await deps.getSeries(studyInstanceUID, referencedUid);
    deps.assertAlive();
    const stack = stackOf(referenced, header);
    const [first] = stack.instances;
    const rows = numbers(first?.metadata ?? {}, '00280010')[0];
    const columns = numbers(first?.metadata ?? {}, '00280011')[0];
    if (
      rows !== undefined &&
      columns !== undefined &&
      (rows !== header.rows || columns !== header.columns)
    ) {
      throw new Error(
        `The SEG is ${header.rows.toString()} by ${header.columns.toString()} pixels and its images are ${rows.toString()} by ${columns.toString()}, so it cannot be drawn on them.`,
      );
    }

    const handle = await port.loadSegmentation(stack.imageIds, bytes, header);
    try {
      deps.assertAlive();
      // Another call may have loaded it while this one waited for the engine.
      const raced = entries.get(seriesInstanceUID);
      if (raced !== undefined) {
        handle.dispose();
        return raced.info;
      }
      const located = new Map(handle.index.segments.map((segment) => [segment.number, segment]));
      const segments: SegmentInfo[] = [...header.segments]
        .sort((a, b) => a.number - b.number)
        .map((segment) => {
          const entry = located.get(segment.number);
          return {
            number: segment.number,
            label: segment.label,
            description: segment.description,
            color: segment.color ?? defaultSegmentColor(segment.number),
            opacity: DEFAULT_SEGMENT_OPACITY,
            visible: true,
            voxelCount: entry?.voxelCount ?? 0,
            imageCount: entry?.imageIndices.length ?? 0,
            centroid: entry === undefined ? undefined : centroidMm(entry, stack),
          };
        });
      const warnings = checkSegmentation({ header, stack, index: handle.index });
      const info: SegmentationInfo = {
        seriesInstanceUID,
        studyInstanceUID,
        referencedSeriesInstanceUID: referencedUid,
        referencedStackIndex: stack.index,
        label: header.seriesDescription ?? series.description ?? 'SEG',
        visible: true,
        opacity: DEFAULT_SEGMENTATION_OPACITY,
        segments,
        highlight: undefined,
        warnings,
      };
      const entry: Entry = { info, handle, stack, located, announced: false };
      entries.set(seriesInstanceUID, entry);
      noteRefused(entry, draw(entry));
      entry.announced = true;
      deps.emit('segmentation:loaded', { segmentation: entry.info });
      for (const warning of entry.info.warnings) {
        deps.emit('segmentation:warning', { seriesInstanceUID, warning });
      }
      return entry.info;
    } catch (error) {
      // A failure after the SEG was registered must not leave it listed: take it off every stack
      // and give it back, so `list`, `get`, and a later `load` do not see a SEG that is gone.
      const registered = entries.get(seriesInstanceUID);
      if (registered?.handle === handle) drop(registered);
      else handle.dispose();
      throw error;
    }
  }

  const api: SegmentationsApi = {
    list: () => [...entries.values()].map((entry) => entry.info),
    get: (seriesInstanceUID) => entries.get(seriesInstanceUID)?.info,
    load(seriesInstanceUID): Promise<SegmentationInfo> {
      try {
        assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return deps.enqueue(() => loadNow(seriesInstanceUID));
    },
    unload(seriesInstanceUID): Promise<boolean> {
      return deps.enqueue(() => {
        const entry = entries.get(seriesInstanceUID);
        if (entry === undefined) return Promise.resolve(false);
        drop(entry);
        deps.emit('segmentation:unloaded', { seriesInstanceUID });
        return Promise.resolve(true);
      });
    },
    setVisible(seriesInstanceUID, visible): Promise<void> {
      return deps.enqueue(() => {
        const entry = require(seriesInstanceUID);
        change(entry, entry.info.visible === visible ? entry.info : { ...entry.info, visible });
        return Promise.resolve();
      });
    },
    setSegmentVisible(seriesInstanceUID, segmentNumber, visible): Promise<void> {
      return deps.enqueue(() => {
        const entry = require(seriesInstanceUID);
        requireSegment(entry, segmentNumber);
        change(entry, withSegment(entry.info, segmentNumber, { visible }));
        return Promise.resolve();
      });
    },
    setSegmentColor(seriesInstanceUID, segmentNumber, color): Promise<void> {
      let parsed: Rgb;
      try {
        parsed = parseColor(color);
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return deps.enqueue(() => {
        const entry = require(seriesInstanceUID);
        const current = requireSegment(entry, segmentNumber);
        const same = current.color.every((channel, at) => channel === parsed[at]);
        change(
          entry,
          same ? entry.info : withSegment(entry.info, segmentNumber, { color: parsed }),
        );
        return Promise.resolve();
      });
    },
    setSegmentOpacity(seriesInstanceUID, segmentNumber, opacity): Promise<void> {
      try {
        assertFraction(opacity, 'The opacity');
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return deps.enqueue(() => {
        const entry = require(seriesInstanceUID);
        requireSegment(entry, segmentNumber);
        change(entry, withSegment(entry.info, segmentNumber, { opacity }));
        return Promise.resolve();
      });
    },
    setOpacity(seriesInstanceUID, opacity): Promise<void> {
      try {
        assertFraction(opacity, 'The opacity');
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return deps.enqueue(() => {
        const entry = require(seriesInstanceUID);
        change(entry, entry.info.opacity === opacity ? entry.info : { ...entry.info, opacity });
        return Promise.resolve();
      });
    },
    highlight(seriesInstanceUID, segmentNumbers, options): Promise<void> {
      const mode = options?.mode ?? 'dim-others';
      try {
        if (!HIGHLIGHT_MODES.includes(mode)) {
          throw new RangeError(`A highlight is ${HIGHLIGHT_MODES.join(' or ')}, not ${mode}.`);
        }
        for (const number of segmentNumbers ?? []) assertSegmentNumber(number);
      } catch (error) {
        return Promise.reject(toError(error));
      }
      return deps.enqueue(() => {
        const entry = require(seriesInstanceUID);
        for (const number of segmentNumbers ?? []) requireSegment(entry, number);
        const wanted =
          segmentNumbers === undefined || segmentNumbers.length === 0
            ? undefined
            : { mode, segments: [...new Set(segmentNumbers)].sort((a, b) => a - b) };
        const before = entry.info.highlight;
        const same =
          before === wanted ||
          (wanted !== undefined &&
            before?.mode === wanted.mode &&
            before.segments.length === wanted.segments.length &&
            before.segments.every((number, at) => number === wanted.segments[at]));
        change(entry, same ? entry.info : { ...entry.info, highlight: wanted });
        return Promise.resolve();
      });
    },
    jumpToSegment(seriesInstanceUID, segmentNumber, options): Promise<JumpToSegmentResult> {
      const strategy = options?.strategy ?? 'largestSlice';
      try {
        if (!JUMP_STRATEGIES.includes(strategy)) {
          throw new RangeError(`A jump is ${JUMP_STRATEGIES.join(', ')}, not ${strategy}.`);
        }
        assertSegmentNumber(segmentNumber);
      } catch (error) {
        return Promise.reject(toError(error));
      }
      const viewportId = options?.viewportId ?? 'vp-0';
      return deps.enqueue(async () => {
        const entry = require(seriesInstanceUID);
        const segment = requireSegment(entry, segmentNumber);
        const located = entry.located.get(segmentNumber);
        if (located === undefined || segment.voxelCount === 0) {
          throw new RangeError(
            `The segment ${segment.label} of ${entry.info.label} has no pixels to show.`,
          );
        }
        const current = deps.imageIndexOf(
          viewportId,
          entry.info.referencedSeriesInstanceUID,
          entry.info.referencedStackIndex,
        );
        const imageIndex = imageToShow(located, strategy, current);
        const sopInstanceUID = entry.stack.instances[imageIndex]?.sopInstanceUID;
        if (sopInstanceUID === undefined) {
          throw new RangeError(`The series has no image ${imageIndex.toString()}.`);
        }
        await deps.navigateNow({
          seriesInstanceUID: entry.info.referencedSeriesInstanceUID,
          sopInstanceUID,
          viewportId,
        });
        return {
          viewportId,
          seriesInstanceUID: entry.info.referencedSeriesInstanceUID,
          sopInstanceUID,
          imageIndex,
          strategy,
        };
      });
    },
  };

  return {
    api,
    attach(shown): () => void {
      attached.add(shown);
      try {
        // Draw everything first: a refusal is recorded only once the whole attachment has worked.
        const results: [Entry, boolean][] = [];
        for (const entry of entries.values()) {
          if (belongsTo(entry, shown)) results.push([entry, draw(entry)]);
        }
        for (const [entry, refused] of results) noteRefused(entry, refused);
      } catch (error) {
        // The stack is about to be given back by the viewer: it must not stay in the list, nor keep what was drawn on it.
        attached.delete(shown);
        for (const entry of entries.values()) {
          if (belongsTo(entry, shown)) shown.port.hideSegmentation(entry.handle);
        }
        throw error;
      }
      return (): void => {
        if (!attached.delete(shown)) return;
        for (const entry of entries.values()) {
          if (belongsTo(entry, shown)) shown.port.hideSegmentation(entry.handle);
        }
      };
    },
    async applyNavigation(wanted): Promise<{ seriesInstanceUID: string; error: Error }[]> {
      const failed: { seriesInstanceUID: string; error: Error }[] = [];
      for (const item of wanted) {
        try {
          await loadNow(item.seriesInstanceUID);
          const entry = require(item.seriesInstanceUID);
          let next =
            entry.info.visible === item.visible
              ? entry.info
              : { ...entry.info, visible: item.visible };
          if (item.highlightSegments !== undefined) {
            for (const number of item.highlightSegments) requireSegment(entry, number);
            next = {
              ...next,
              highlight:
                item.highlightSegments.length === 0
                  ? undefined
                  : {
                      mode: next.highlight?.mode ?? 'dim-others',
                      segments: [...new Set(item.highlightSegments)].sort((a, b) => a - b),
                    },
            };
          }
          change(entry, next);
        } catch (error) {
          const failure = toError(error);
          failed.push({ seriesInstanceUID: item.seriesInstanceUID, error: failure });
          deps.fail(failure);
        }
      }
      return failed;
    },
    studyChanged(): void {
      for (const entry of [...entries.values()]) {
        drop(entry);
        deps.emit('segmentation:unloaded', { seriesInstanceUID: entry.info.seriesInstanceUID });
      }
    },
    destroy(): void {
      for (const entry of [...entries.values()]) drop(entry);
      attached.clear();
    },
  };
}
