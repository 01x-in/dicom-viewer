import {
  formatViewerMessage,
  resolveViewerMessages,
  type ViewerMessages,
  type WindowLevel,
} from '@01x/dicom-viewer-core';

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
  /** The plane of a volume the viewport shows, when it shows one. */
  readonly plane?: string | undefined;
  /** Which of several viewports this is. Said only when there is more than one. */
  readonly position?: { readonly index: number; readonly count: number } | undefined;
}

const round = (value: number): string => Math.round(value).toString();

/** What a viewport shows, in words: the label a screen reader gets for a picture. */
export function describeViewport(
  viewport: ViewportDescription,
  messages?: Partial<ViewerMessages>,
): string {
  const text = resolveViewerMessages(messages);
  const { position } = viewport;
  const where =
    position === undefined || position.count < 2
      ? ''
      : formatViewerMessage(text.viewportIndex, {
          index: position.index + 1,
          count: position.count,
        });
  return `${where}${describeContent(viewport, text)}`;
}

function describeContent(viewport: ViewportDescription, text: ViewerMessages): string {
  const { name, imageIndex, imageCount } = viewport;
  if (name === undefined || imageIndex === undefined || imageCount <= 0) {
    return text.viewportNoImage;
  }
  // A state a host patched may name a slice past the end for a moment, until the core clamps it.
  const shown = Math.min(Math.max(imageIndex, 0), imageCount - 1);
  const parts = [
    name,
    ...(viewport.plane === undefined
      ? []
      : [
          formatViewerMessage(text.viewportPlane, {
            plane:
              viewport.plane === 'axial'
                ? text.planeAxial
                : viewport.plane === 'sagittal'
                  ? text.planeSagittal
                  : viewport.plane === 'coronal'
                    ? text.planeCoronal
                    : viewport.plane,
          }),
        ]),
    formatViewerMessage(text.viewportImage, { index: shown + 1, count: imageCount }),
    ...(viewport.window === undefined
      ? []
      : [
          formatViewerMessage(text.viewportWindow, {
            width: round(viewport.window.width),
            center: round(viewport.window.center),
          }),
        ]),
    ...(viewport.invert === true ? [text.viewportInverted] : []),
    ...(viewport.zoom === undefined
      ? []
      : [formatViewerMessage(text.viewportZoom, { zoom: viewport.zoom.toFixed(1) })]),
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
