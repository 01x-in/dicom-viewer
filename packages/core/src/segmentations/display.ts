import type { Highlight, Rgb, SegmentationInfo } from './model';

/** How much of its own strength a segment keeps while others are highlighted. */
export const DIMMED_FRACTION = 0.2;

/** What the engine draws for one segment. Worked out here so the engine only has to apply it. */
export interface SegmentDisplay {
  readonly number: number;
  readonly color: Rgb;
  /** 0 to 1: the segment's opacity times the whole SEG's, and less when it is dimmed. */
  readonly alpha: number;
  readonly visible: boolean;
  /** Drawn with an outline round it. Only for a highlighted segment, in `outline` mode. */
  readonly outline: boolean;
}

export interface SegmentationDisplay {
  readonly segments: readonly SegmentDisplay[];
}

function isHighlighted(highlight: Highlight | undefined, segmentNumber: number): boolean {
  return highlight?.segments.includes(segmentNumber) === true;
}

/**
 * Turns the settings of a loaded SEG into what is drawn. A hidden SEG shows nothing whatever its
 * segments say. A highlight changes how visible segments look; it never shows a hidden one.
 */
export function displayOf(info: SegmentationInfo): SegmentationDisplay {
  const { highlight } = info;
  const highlighting = highlight !== undefined && highlight.segments.length > 0;
  return {
    segments: info.segments.map((segment) => {
      const highlighted = isHighlighted(highlight, segment.number);
      const dimmed = highlighting && highlight.mode === 'dim-others' && !highlighted;
      return {
        number: segment.number,
        color: segment.color,
        alpha: segment.opacity * info.opacity * (dimmed ? DIMMED_FRACTION : 1),
        visible: info.visible && segment.visible,
        outline: highlighting && highlight.mode === 'outline' && highlighted,
      };
    }),
  };
}
