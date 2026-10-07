import { cache, Enums, eventTarget, utilities, volumeLoader } from '@cornerstonejs/core';
import type { SeriesStack } from '../data/types';
import type { WindowLevel } from '../rendering-port';
import { VOLUME_SCHEME } from './runtime';

type Volume = Awaited<ReturnType<typeof volumeLoader.createAndCacheVolume>>;

interface Held {
  users: number;
  readonly ready: Promise<Volume>;
  /** Set once the volume is built, so it can be taken out of the cache in the same breath as its last plane. */
  volume: Volume | undefined;
}

/**
 * The volumes in the cache, with how many planes use each. Several planes of one stack share a
 * volume, so it is built once and removed with the last plane that shows it.
 */
const held = new Map<string, Held>();

/** Names the volume of a stack: its first and last image and how many there are. */
export function volumeIdOf(stack: SeriesStack): string {
  const first = stack.imageIds[0] ?? '';
  const last = stack.imageIds.at(-1) ?? '';
  return `${VOLUME_SCHEME}:${first}|${last}|${stack.imageIds.length.toString()}`;
}

/** Builds the volume of a stack and starts streaming its images, or joins the plane that did. */
export function acquireVolume(stack: SeriesStack): { id: string; volume: Promise<Volume> } {
  const id = volumeIdOf(stack);
  const existing = held.get(id);
  if (existing !== undefined) {
    existing.users += 1;
    return { id, volume: existing.ready };
  }
  const ready = volumeLoader
    .createAndCacheVolume(id, { imageIds: [...stack.imageIds] })
    .then((volume) => {
      entry.volume = volume;
      volume.load();
      return volume;
    });
  const entry: Held = { users: 1, ready, volume: undefined };
  held.set(id, entry);
  // A volume that failed to build is not worth keeping: the next plane tries again.
  ready.catch(() => {
    if (held.get(id) === entry) held.delete(id);
  });
  return { id, volume: ready };
}

/** Gives a plane's claim back. The last one stops the loading and takes the volume out of the cache. */
export function releaseVolume(id: string): void {
  const entry = held.get(id);
  if (entry === undefined) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  held.delete(id);
  const remove = (volume: Volume): void => {
    volume.cancelLoading();
    forgetUnloadedImages(volume);
    if (cache.getVolumeLoadObject(id) !== undefined) cache.removeVolumeLoadObject(id);
  };
  // At once when it is built: the images it holds cannot be dropped one by one until it is gone.
  if (entry.volume !== undefined) remove(entry.volume);
  else entry.ready.then(remove, () => undefined);
}

/**
 * Cornerstone adds a listener to its global event target for each image a volume asks for, and takes
 * it off when that image reaches the cache. An image that was cancelled never does, so its listener
 * stays, and holds the volume and with it the WebGL context of the page. Saying that every image
 * arrived lets each listener run once and go. Done while the volume is still there, because the
 * listeners reach into it.
 */
function forgetUnloadedImages(volume: Volume): void {
  for (const imageId of volume.imageIds) {
    utilities.triggerEvent(eventTarget, Enums.Events.IMAGE_CACHE_IMAGE_ADDED, {
      image: { imageId },
    });
  }
}

/** How many volumes are held, for the diagnostics. */
export function volumesHeld(): number {
  return held.size;
}

function firstNumber(stack: SeriesStack, tag: string): number | undefined {
  const value = stack.instances[0]?.metadata[tag]?.Value?.[0];
  return typeof value === 'number' ? value : undefined;
}

/** The window the images ask for, from the headers of the first one. */
export function windowOfStack(stack: SeriesStack): WindowLevel | undefined {
  const center = firstNumber(stack, '00281050');
  const width = firstNumber(stack, '00281051');
  return center === undefined || width === undefined || width <= 0 ? undefined : { center, width };
}

/**
 * The window that shows the whole range of the pixels of a volume, for images that ask for none.
 * Waits for every image to be in, so it is only used when there is nothing else to go on.
 */
export async function windowOfLoadedRange(volume: Volume, volumeId: string): Promise<WindowLevel> {
  const alreadyIn = volume.loadStatus?.['loaded'] === true;
  await new Promise<void>((resolve) => {
    if (alreadyIn) {
      resolve();
      return;
    }
    const done = (event: Event): void => {
      const detail = (event as CustomEvent<{ volumeId?: string }>).detail;
      if (detail.volumeId !== volumeId) return;
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, done);
      resolve();
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, done);
  });
  const [lower, upper] = volume.voxelManager?.getRange() ?? [0, 1];
  return { center: (lower + upper) / 2, width: Math.max(upper - lower, 1) };
}
