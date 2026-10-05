export interface WindowPreset {
  /** What `applyWindowPreset` takes. Unique within a viewer. */
  readonly id: string;
  readonly label: string;
  readonly center: number;
  readonly width: number;
}

/** The usual CT windows, in Hounsfield units. */
export const DEFAULT_WINDOW_PRESETS: readonly WindowPreset[] = [
  { id: 'lung', label: 'Lung', center: -600, width: 1500 },
  { id: 'soft-tissue', label: 'Soft tissue', center: 40, width: 400 },
  { id: 'bone', label: 'Bone', center: 480, width: 2500 },
  { id: 'brain', label: 'Brain', center: 40, width: 80 },
  { id: 'liver', label: 'Liver', center: 30, width: 150 },
];

/**
 * Throws a `RangeError` for presets a viewer could not apply or tell apart. The shape is checked
 * at run time: the presets come from a host, which may not have the types.
 */
export function assertWindowPresets(presets: readonly WindowPreset[]): void {
  const seen = new Set<string>();
  for (const candidate of presets) {
    const preset: unknown = candidate;
    if (typeof preset !== 'object' || preset === null) {
      throw new RangeError(
        'A window preset is an object with an id, a label, a center, and a width.',
      );
    }
    const { id, label, center, width } = preset as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || seen.has(id)) {
      throw new RangeError(
        `Window presets need unique, non-empty string ids; ${String(id)} is not.`,
      );
    }
    seen.add(id);
    if (typeof label !== 'string') {
      throw new RangeError(`Window preset "${id}" needs a label that is a string.`);
    }
    if (typeof center !== 'number' || typeof width !== 'number') {
      throw new RangeError(`Window preset "${id}" needs a center and a width that are numbers.`);
    }
    if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 0) {
      throw new RangeError(`Window preset "${id}" needs a finite center and a width above zero.`);
    }
  }
}
