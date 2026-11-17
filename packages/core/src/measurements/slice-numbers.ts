import { sliceKey } from '../data/series';
import type { LoadedSeriesData } from '../data/types';

/**
 * The place of each image of a series that can be shown, by `sliceKey` (the SOP instance UID and the
 * frame), counting from 1 in the stack it is shown in: the number the overlay gives it. A series that splits into stacks
 * numbers each of them from 1.
 */
export function sliceNumbers(series: LoadedSeriesData): Map<string, number> {
  const slices = new Map<string, number>();
  for (const stack of series.stacks) {
    for (const [at, instance] of stack.instances.entries()) {
      slices.set(sliceKey(instance.sopInstanceUID, instance.frameNumber), at + 1);
    }
  }
  return slices;
}
