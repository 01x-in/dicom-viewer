import type { Point3 } from '../measurements/model';
import type { Rgb } from './header';
import type { SegmentationWarning } from './validate';

export type { Rgb };

/** How a highlight shows: the others fade, or the highlighted ones get an outline. */
export type HighlightMode = 'dim-others' | 'outline';

export const HIGHLIGHT_MODES: readonly HighlightMode[] = ['dim-others', 'outline'];

export interface Highlight {
  readonly mode: HighlightMode;
  /** Segment numbers. */
  readonly segments: readonly number[];
}

/** One segment of a loaded SEG: what it is, how it is drawn, and how much of it there is. */
export interface SegmentInfo {
  readonly number: number;
  readonly label: string;
  readonly description?: string | undefined;
  readonly color: Rgb;
  /** 0 to 1, the segment's own. What is drawn is this times the opacity of the whole SEG. */
  readonly opacity: number;
  readonly visible: boolean;
  /** Pixels in the segment, over all images. */
  readonly voxelCount: number;
  /** How many images it is on. */
  readonly imageCount: number;
  /** The middle of the segment in patient millimetres, if the images say where they are. */
  readonly centroid?: Point3 | undefined;
}

/** A SEG that has been loaded against the series it segments. Plain data, so it can be stored or sent. */
export interface SegmentationInfo {
  /** The SEG's own series. */
  readonly seriesInstanceUID: string;
  readonly studyInstanceUID: string;
  /** The series it is drawn on. */
  readonly referencedSeriesInstanceUID: string;
  /** Which stack of that series. */
  readonly referencedStackIndex: number;
  /** The SEG's series description, or `SEG`. */
  readonly label: string;
  readonly visible: boolean;
  /** 0 to 1, for the whole SEG. */
  readonly opacity: number;
  readonly segments: readonly SegmentInfo[];
  readonly highlight: Highlight | undefined;
  /** Why the SEG may not be where it is drawn, or may not be what it seems. Empty when nothing is doubtful. */
  readonly warnings: readonly SegmentationWarning[];
}

export const DEFAULT_SEGMENT_OPACITY = 1;
/** What a SEG is drawn at until the host says otherwise. A labelmap at full strength hides the image under it. */
export const DEFAULT_SEGMENTATION_OPACITY = 0.5;

/** Distinct colours for segments that come with none (Trubetskoy's palette, the first twelve). */
export const PALETTE: readonly Rgb[] = [
  [230, 25, 75],
  [60, 180, 75],
  [255, 225, 25],
  [0, 130, 200],
  [245, 130, 48],
  [145, 30, 180],
  [70, 240, 240],
  [240, 50, 230],
  [210, 245, 60],
  [250, 190, 212],
  [0, 128, 128],
  [220, 190, 255],
];

/** The colour a segment gets when the SEG recommends none: by number, so it is the same on every load. */
export function defaultSegmentColor(segmentNumber: number): Rgb {
  const color = PALETTE[(Math.max(1, segmentNumber) - 1) % PALETTE.length];
  return color ?? [255, 255, 255];
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A colour as red, green, and blue (whole numbers 0 to 255), or as CSS hex (`#rgb` or `#rrggbb`).
 * Throws a `RangeError` for anything else.
 */
export function parseColor(input: unknown): Rgb {
  if (typeof input === 'string' && HEX_COLOR.test(input)) {
    const digits = input.slice(1);
    const full = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  if (
    Array.isArray(input) &&
    input.length === 3 &&
    input.every(
      (channel: unknown) =>
        typeof channel === 'number' && Number.isInteger(channel) && channel >= 0 && channel <= 255,
    )
  ) {
    const [red, green, blue] = input as number[];
    return [red ?? 0, green ?? 0, blue ?? 0];
  }
  throw new RangeError(
    `A colour is [red, green, blue] with whole numbers from 0 to 255, or #rrggbb, not ${JSON.stringify(input)}.`,
  );
}

/** `#rrggbb`, lower case. */
export function colorToHex(color: Rgb): string {
  return `#${color.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Throws a `RangeError` unless `value` is a number from 0 to 1. */
export function assertFraction(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} is a number from 0 to 1, not ${String(value)}.`);
  }
}
