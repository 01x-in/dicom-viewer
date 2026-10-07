import type {
  OverlayCorner,
  OverlayCornersConfig,
  OverlayItemConfig,
  OverlayShownItem,
} from './types';

type Corners = Readonly<Record<OverlayCorner, readonly OverlayShownItem[]>>;

/** What the overlay shows when nothing is said: the lines it has always had. */
export const DEFAULT_OVERLAY_CORNERS: Corners = {
  topLeft: [
    { id: 'patientName', kind: 'builtin', name: 'patientName' },
    { id: 'patientId', kind: 'builtin', name: 'patientId' },
    { id: 'series', kind: 'builtin', name: 'series' },
  ],
  topRight: [
    { id: 'modality', kind: 'builtin', name: 'modality' },
    { id: 'size', kind: 'builtin', name: 'size' },
  ],
  bottomLeft: [
    { id: 'window', kind: 'builtin', name: 'window' },
    { id: 'zoom', kind: 'builtin', name: 'zoom' },
    { id: 'inverted', kind: 'builtin', name: 'inverted' },
  ],
  bottomRight: [{ id: 'image', kind: 'builtin', name: 'image' }],
};

/**
 * Puts `next` over `base` by `id`: an item with the id of an earlier one replaces it in its place,
 * and a new one goes at the end. A removal is kept as an item, so it can act on the defaults when
 * the layers are put over them. Neither argument is changed.
 */
export function mergeById(
  base: readonly OverlayItemConfig[],
  next: readonly OverlayItemConfig[],
): OverlayItemConfig[] {
  const merged = [...base];
  for (const item of next) {
    const at = merged.findIndex((existing) => existing.id === item.id);
    if (at >= 0) merged[at] = item;
    else merged.push(item);
  }
  return merged;
}

/** The defaults with the layers' items put over them, and the removals acted on. */
export function resolveCorners(corners: OverlayCornersConfig | undefined): Corners {
  const resolve = (corner: OverlayCorner): readonly OverlayShownItem[] =>
    mergeById(DEFAULT_OVERLAY_CORNERS[corner], corners?.[corner] ?? []).filter(
      (item): item is OverlayShownItem => !('remove' in item),
    );
  return {
    topLeft: resolve('topLeft'),
    topRight: resolve('topRight'),
    bottomLeft: resolve('bottomLeft'),
    bottomRight: resolve('bottomRight'),
  };
}
