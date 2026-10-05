import type { LoadedSeriesData, SeriesStack } from './data/types';
import { assertDicomUid } from './data/uid';

export const DEFAULT_THUMBNAIL_SIZE = 96;
export const MIN_THUMBNAIL_SIZE = 16;
export const MAX_THUMBNAIL_SIZE = 512;

/** How many pictures are decoded at once. Thumbnails are the least urgent thing the viewer loads. */
const CONCURRENCY = 2;

export interface ThumbnailOptions {
  /** The side of the square picture, in pixels: a whole number from 16 to 512. Default 96. */
  readonly size?: number;
}

export interface ThumbnailsApi {
  /**
   * A small picture of the middle slice of a series of the current study, drawn on the CPU (no
   * WebGL context) as an image data URL. `undefined` for a series with nothing to draw, such as a
   * SEG or an SR. Pictures are kept, so asking again is free; a failure is not kept.
   */
  get(seriesInstanceUID: string, options?: ThumbnailOptions): Promise<string | undefined>;
}

export interface ThumbnailsDeps {
  /** The study the viewer has now, or `undefined`. A request is bound to it when it is made. */
  study(): string | undefined;
  /** One series of a study. */
  series(studyInstanceUID: string, seriesInstanceUID: string): Promise<LoadedSeriesData>;
  /** Draws one slice as a square picture. */
  render(stack: SeriesStack, imageIndex: number, size: number): Promise<string>;
}

export interface Thumbnails {
  readonly api: ThumbnailsApi;
  /** For a different study: forgets every picture and rejects the requests still waiting for a turn. */
  clear(): void;
  /** Rejects what is waiting, and refuses what comes next. */
  dispose(): void;
}

export function createThumbnails(deps: ThumbnailsDeps): Thumbnails {
  const pictures = new Map<string, Promise<string | undefined>>();
  const waiting: { start(): void; cancel(reason: string): void }[] = [];
  let running = 0;
  let disposed = false;

  function next(): void {
    while (running < CONCURRENCY) {
      const entry = waiting.shift();
      if (entry === undefined) return;
      running += 1;
      entry.start();
    }
  }

  /** Runs a task when one of the places is free. */
  function limited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push({
        start: () => {
          task()
            .then(resolve, reject)
            .finally(() => {
              running -= 1;
              next();
            });
        },
        cancel: (reason) => {
          reject(new Error(reason));
        },
      });
      next();
    });
  }

  return {
    api: {
      get(seriesInstanceUID, options = {}): Promise<string | undefined> {
        try {
          assertDicomUid(seriesInstanceUID, 'SeriesInstanceUID');
          const size = options.size ?? DEFAULT_THUMBNAIL_SIZE;
          if (!Number.isInteger(size) || size < MIN_THUMBNAIL_SIZE || size > MAX_THUMBNAIL_SIZE) {
            throw new RangeError(
              `A thumbnail is ${MIN_THUMBNAIL_SIZE.toString()} to ${MAX_THUMBNAIL_SIZE.toString()} pixels, a whole number, not ${String(size)}.`,
            );
          }
          if (disposed) throw new Error('The viewer was destroyed.');
          // Bound now, not when a place frees up: by then the viewer may have another study.
          const study = deps.study();
          if (study === undefined) {
            throw new Error(
              'Load a study first: call loadStudy, or setState with a studyInstanceUID.',
            );
          }
          const key = `${study}/${seriesInstanceUID}/${size.toString()}`;
          let picture = pictures.get(key);
          if (picture === undefined) {
            picture = limited(async () => {
              const series = await deps.series(study, seriesInstanceUID);
              const stack = series.stacks[0];
              if (stack === undefined) return undefined;
              return deps.render(stack, Math.floor(stack.imageIds.length / 2), size);
            });
            pictures.set(key, picture);
            const forget = (): void => {
              if (pictures.get(key) === picture) pictures.delete(key);
            };
            picture.catch(forget);
          }
          return picture;
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    },
    clear(): void {
      pictures.clear();
      // What has not started belongs to the study that is gone, and would hold both places up.
      for (const entry of waiting.splice(0)) entry.cancel('The study changed.');
    },
    dispose(): void {
      disposed = true;
      pictures.clear();
      // Every waiting task is rejected here, one after another, so a long queue cannot grow the stack.
      for (const entry of waiting.splice(0)) entry.cancel('The viewer was destroyed.');
    },
  };
}
