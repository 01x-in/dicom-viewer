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

/** Throws a `RangeError` for presets a viewer could not apply or tell apart. */
export function assertWindowPresets(presets: readonly WindowPreset[]): void {
  const seen = new Set<string>();
  for (const preset of presets) {
    if (preset.id === '' || seen.has(preset.id)) {
      throw new RangeError(`Window presets need unique, non-empty ids; "${preset.id}" is not.`);
    }
    seen.add(preset.id);
    if (!Number.isFinite(preset.center) || !Number.isFinite(preset.width) || preset.width <= 0) {
      throw new RangeError(
        `Window preset "${preset.id}" needs a finite center and a width above zero.`,
      );
    }
  }
}
