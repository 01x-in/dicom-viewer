import { describe, expect, it } from 'vitest';
import { DIMMED_FRACTION, displayOf } from './display';
import type { SegmentInfo, SegmentationInfo } from './model';

const segment = (number: number, change: Partial<SegmentInfo> = {}): SegmentInfo => ({
  number,
  label: `S${number.toString()}`,
  color: [number, 0, 0],
  opacity: 1,
  visible: true,
  voxelCount: 1,
  imageCount: 1,
  ...change,
});

const info = (change: Partial<SegmentationInfo> = {}): SegmentationInfo => ({
  seriesInstanceUID: '1.2',
  studyInstanceUID: '1',
  referencedSeriesInstanceUID: '1.1',
  referencedStackIndex: 0,
  label: 'SEG',
  visible: true,
  opacity: 0.5,
  segments: [segment(1), segment(2, { opacity: 0.8 })],
  highlight: undefined,
  warnings: [],
  ...change,
});

describe('displayOf', () => {
  it('multiplies the segment opacity by the opacity of the whole SEG', () => {
    expect(displayOf(info()).segments.map((item) => item.alpha)).toEqual([0.5, 0.4]);
  });

  it('keeps the colour and the number of each segment, in order', () => {
    expect(displayOf(info()).segments.map((item) => [item.number, item.color])).toEqual([
      [1, [1, 0, 0]],
      [2, [2, 0, 0]],
    ]);
  });

  it('hides every segment of a hidden SEG, and only the hidden segments of a shown one', () => {
    expect(displayOf(info({ visible: false })).segments.map((item) => item.visible)).toEqual([
      false,
      false,
    ]);
    expect(
      displayOf(info({ segments: [segment(1), segment(2, { visible: false })] })).segments.map(
        (item) => item.visible,
      ),
    ).toEqual([true, false]);
  });

  it('dims the segments that are not highlighted, and keeps the highlighted ones as they are', () => {
    const shown = displayOf(info({ highlight: { mode: 'dim-others', segments: [2] } })).segments;
    expect(shown[0]?.alpha).toBeCloseTo(0.5 * DIMMED_FRACTION);
    expect(shown[1]?.alpha).toBeCloseTo(0.4);
    expect(shown.some((item) => item.outline)).toBe(false);
  });

  it('outlines the highlighted segments and leaves every fill alone', () => {
    const shown = displayOf(info({ highlight: { mode: 'outline', segments: [1] } })).segments;
    expect(shown.map((item) => item.outline)).toEqual([true, false]);
    expect(shown.map((item) => item.alpha)).toEqual([0.5, 0.4]);
  });

  it('highlights several segments at once', () => {
    const shown = displayOf(
      info({
        segments: [segment(1), segment(2), segment(3)],
        highlight: { mode: 'outline', segments: [1, 3] },
      }),
    ).segments;
    expect(shown.map((item) => item.outline)).toEqual([true, false, true]);
  });

  it('does nothing for a highlight of no segments', () => {
    const shown = displayOf(info({ highlight: { mode: 'dim-others', segments: [] } })).segments;
    expect(shown.map((item) => item.alpha)).toEqual([0.5, 0.4]);
  });

  it('never shows a hidden segment because it is highlighted', () => {
    const shown = displayOf(
      info({
        segments: [segment(1, { visible: false }), segment(2)],
        highlight: { mode: 'outline', segments: [1] },
      }),
    ).segments;
    expect(shown[0]).toMatchObject({ visible: false, outline: true });
  });

  it('ignores a highlighted number that is not a segment', () => {
    const shown = displayOf(info({ highlight: { mode: 'dim-others', segments: [9] } })).segments;
    // Nothing is highlighted, so everything is dimmed: callers do not pass numbers that are not there.
    expect(shown.map((item) => item.alpha)).toEqual([0.5 * DIMMED_FRACTION, 0.4 * DIMMED_FRACTION]);
  });
});
