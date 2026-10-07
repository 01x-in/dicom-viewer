import { normalizeChord } from '../keyboard';
import { DEFAULT_PRIMARY_TOOL } from '../tools';
import { DEFAULT_WINDOW_PRESETS } from '../window-presets';
import type {
  ConfigBody,
  KeybindingsConfig,
  OverlayConfig,
  PanelsConfig,
  ResolvedViewerConfig,
  ToolbarConfig,
  ToolsConfig,
} from './types';

/** A copy with every chord written the way the keymap spells it, so `Shift+I` and `shift+i` are one key. */
function normalizeKeybindings(keybindings: KeybindingsConfig): KeybindingsConfig {
  const normalized: Record<string, KeybindingsConfig[string]> = {};
  for (const [spec, action] of Object.entries(keybindings)) {
    const chord = normalizeChord(spec);
    // Two spellings of one chord in one layer are a mistake. Across layers, the later one wins.
    if (Object.hasOwn(normalized, chord)) {
      throw new RangeError(`The key ${chord} is bound twice.`);
    }
    normalized[chord] = action;
  }
  return normalized;
}

function mergeKeybindings(
  base: false | KeybindingsConfig | undefined,
  next: false | KeybindingsConfig,
): false | KeybindingsConfig {
  if (next === false) return false;
  const kept = base === false || base === undefined ? {} : normalizeKeybindings(base);
  return { ...kept, ...normalizeKeybindings(next) };
}

function mergeOverlay(
  base: false | OverlayConfig | undefined,
  next: false | OverlayConfig,
): false | OverlayConfig {
  if (next === false) return false;
  const kept = base === false || base === undefined ? {} : base;
  return {
    ...kept,
    ...(next.showPatientInfo === undefined ? {} : { showPatientInfo: next.showPatientInfo }),
  };
}

function mergeToolbar(base: ToolbarConfig | undefined, next: ToolbarConfig): ToolbarConfig {
  return {
    ...base,
    ...(next.labels === undefined ? {} : { labels: next.labels }),
    ...(next.hidden === undefined ? {} : { hidden: next.hidden }),
    ...(next.items === undefined ? {} : { items: next.items }),
  };
}

function mergePanels(base: PanelsConfig | undefined, next: PanelsConfig): PanelsConfig {
  return { ...base, ...(next.hide === undefined ? {} : { hide: next.hide }) };
}

function mergeTools(base: ToolsConfig | undefined, next: ToolsConfig): ToolsConfig {
  return { ...base, ...(next.active === undefined ? {} : { active: next.active }) };
}

const replace = <T>(_base: T | undefined, next: T): T => next;

/**
 * One key of two layers. A layer that does not mention the key leaves it. `null` takes it out, so
 * its default shows again. Anything else is merged with what was there.
 */
function layerValue<T>(
  base: T | null | undefined,
  next: T | null | undefined,
  merge: (base: T | undefined, next: T) => T,
): T | undefined {
  if (next === undefined) return base ?? undefined;
  if (next === null) return undefined;
  return merge(base ?? undefined, next);
}

/**
 * Puts one layer over another. Objects merge key by key. `null` for a top-level key takes the key
 * out. The window presets and the panels to hide replace what was there. Throws a `RangeError` for
 * a chord that cannot be pressed. Neither argument is changed.
 */
function mergeTwo(base: ConfigBody, next: ConfigBody): ConfigBody {
  return {
    theme: layerValue(base.theme, next.theme, replace),
    palette: layerValue(base.palette, next.palette, replace),
    toolbar: layerValue(base.toolbar, next.toolbar, mergeToolbar),
    keybindings: layerValue(base.keybindings, next.keybindings, mergeKeybindings),
    overlay: layerValue(base.overlay, next.overlay, mergeOverlay),
    panels: layerValue(base.panels, next.panels, mergePanels),
    windowLevelPresets: layerValue(base.windowLevelPresets, next.windowLevelPresets, replace),
    tools: layerValue(base.tools, next.tools, mergeTools),
  };
}

/** Every layer put over the one before it, in order. */
export function mergeLayers(layers: readonly ConfigBody[]): ConfigBody {
  return layers.reduce<ConfigBody>((merged, layer) => mergeTwo(merged, layer), {});
}

/** The merged layers with the defaults filled in. */
export function resolveConfig(layers: readonly ConfigBody[]): ResolvedViewerConfig {
  const merged = mergeLayers(layers);
  return {
    theme: merged.theme ?? undefined,
    palette: merged.palette ?? undefined,
    toolbar: {
      labels: merged.toolbar?.labels ?? undefined,
      hidden: merged.toolbar?.hidden ?? false,
      items: merged.toolbar?.items,
    },
    keybindings: merged.keybindings ?? {},
    overlay:
      merged.overlay === false
        ? false
        : { showPatientInfo: merged.overlay?.showPatientInfo ?? false },
    panels: { hide: merged.panels?.hide ?? [] },
    windowLevelPresets: merged.windowLevelPresets ?? DEFAULT_WINDOW_PRESETS,
    tools: { active: merged.tools?.active ?? DEFAULT_PRIMARY_TOOL },
  };
}
