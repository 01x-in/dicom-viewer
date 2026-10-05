import type { WindowLevel } from '@scope/viewer-core';

export interface ViewportDescription {
  /** The series' description, or its modality. `undefined` when no series is shown. */
  readonly name: string | undefined;
  /** 0-based. */
  readonly imageIndex: number | undefined;
  readonly imageCount: number;
  /** Only when it differs from the one the images ask for. */
  readonly window?: WindowLevel | undefined;
  readonly invert?: boolean | undefined;
  readonly zoom?: number | undefined;
}

const round = (value: number): string => Math.round(value).toString();

/** What a viewport shows, in words: the label a screen reader gets for a picture. */
export function describeViewport(viewport: ViewportDescription): string {
  const { name, imageIndex, imageCount } = viewport;
  if (name === undefined || imageIndex === undefined || imageCount <= 0) {
    return 'No image shown';
  }
  const parts = [
    name,
    `image ${(imageIndex + 1).toString()} of ${imageCount.toString()}`,
    ...(viewport.window === undefined
      ? []
      : [`window ${round(viewport.window.width)}, level ${round(viewport.window.center)}`]),
    ...(viewport.invert === true ? ['inverted'] : []),
    ...(viewport.zoom === undefined ? [] : [`zoom ${viewport.zoom.toFixed(1)} times`]),
  ];
  return parts.join(', ');
}

export interface ThrottledAnnouncer {
  /** Says this text once the delay has passed with nothing newer. Only the latest is said. */
  push(text: string): void;
  /** Says what is waiting now. */
  flush(): void;
  /** Drops what is waiting. */
  cancel(): void;
}

/**
 * A live region that reads every slice change aloud is unusable while scrolling. This says the
 * latest text once the picture has been still for `delayMs`, and never says the same text twice
 * in a row.
 */
export function createThrottledAnnouncer(
  announce: (text: string) => void,
  delayMs = 800,
): ThrottledAnnouncer {
  let waiting: string | undefined;
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function say(): void {
    timer = undefined;
    const text = waiting;
    waiting = undefined;
    if (text === undefined || text === last) return;
    last = text;
    announce(text);
  }

  return {
    push(text): void {
      waiting = text;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(say, delayMs);
    },
    flush(): void {
      if (timer !== undefined) clearTimeout(timer);
      say();
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      waiting = undefined;
    },
  };
}
