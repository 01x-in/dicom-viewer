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
  /** The series of the current study. Rejects when there is none. */
  series(seriesInstanceUID: string): Promise<LoadedSeriesData>;
  /** Draws one slice as a square picture. */
  render(stack: SeriesStack, imageIndex: number, size: number): Promise<string>;
}

export interface Thumbnails {
  readonly api: ThumbnailsApi;
  /** Forgets every picture, for a different study. */
  clear(): void;
  /** Rejects what is waiting, and refuses what comes next. */
  dispose(): void;
}

export function createThumbnails(deps: ThumbnailsDeps): Thumbnails {
  const pictures = new Map<string, Promise<string | undefined>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  let disposed = false;

  function next(): void {
    while (running < CONCURRENCY) {
      const start = waiting.shift();
      if (start === undefined) return;
      running += 1;
      start();
    }
  }

  /** Runs a task when one of the places is free. */
  function limited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        if (disposed) {
          running -= 1;
          reject(new Error('The viewer was destroyed.'));
          next();
          return;
        }
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            next();
          });
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
          const key = `${seriesInstanceUID}/${size.toString()}`;
          let picture = pictures.get(key);
          if (picture === undefined) {
            picture = limited(async () => {
              const series = await deps.series(seriesInstanceUID);
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
    },
    dispose(): void {
      disposed = true;
      pictures.clear();
      // Waiting tasks reject themselves when their turn comes.
      next();
    },
  };
}
