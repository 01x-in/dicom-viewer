import { isPrimaryTool, type PrimaryTool } from './tools';
import type { WindowPreset } from './window-presets';

export type KeyAction =
  | { readonly type: 'scroll'; readonly by: number }
  | { readonly type: 'scroll-to'; readonly position: 'first' | 'last' }
  | { readonly type: 'zoom'; readonly factor: number }
  | { readonly type: 'invert' }
  | { readonly type: 'reset' }
  /** Starts cine, or stops it. */
  | { readonly type: 'cine' }
  | { readonly type: 'tool'; readonly tool: PrimaryTool }
  | { readonly type: 'preset'; readonly id: string };

/** Keys by chord, such as `ArrowDown`, `Shift+i`, or `Ctrl+Alt+x`. `null` removes a default binding. */
export type KeybindingOverrides = Readonly<Record<string, KeyAction | null>>;

/** The bindings every viewer starts with, apart from the digits, which pick the window presets. */
export const DEFAULT_KEYBINDINGS: Readonly<Record<string, KeyAction>> = {
  ArrowDown: { type: 'scroll', by: 1 },
  ArrowUp: { type: 'scroll', by: -1 },
  PageDown: { type: 'scroll', by: 10 },
  PageUp: { type: 'scroll', by: -10 },
  Home: { type: 'scroll-to', position: 'first' },
  End: { type: 'scroll-to', position: 'last' },
  Plus: { type: 'zoom', factor: 1.25 },
  '=': { type: 'zoom', factor: 1.25 },
  '-': { type: 'zoom', factor: 0.8 },
  i: { type: 'invert' },
  r: { type: 'reset' },
  Space: { type: 'cine' },
  w: { type: 'tool', tool: 'window-level' },
  p: { type: 'tool', tool: 'pan' },
  z: { type: 'tool', tool: 'zoom' },
  s: { type: 'tool', tool: 'stack-scroll' },
};

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

// Named keys, in the spelling `KeyboardEvent.key` uses.
const NAMED_KEYS = new Map(
  [
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'PageDown',
    'PageUp',
    'Home',
    'End',
    'Enter',
    'Escape',
    'Tab',
    'Backspace',
    'Delete',
    'Space',
    'Plus',
    ...Array.from({ length: 12 }, (_, index) => `F${(index + 1).toString()}`),
  ].map((name) => [name.toLowerCase(), name]),
);

export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

function isLetter(character: string): boolean {
  return character.toLowerCase() !== character.toUpperCase();
}

function assemble(modifiers: ReadonlySet<string>, key: string): string {
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

/** The chord a key press is, or `undefined` for a modifier pressed on its own. */
export function chordOf(event: KeyEventLike): string | undefined {
  if (MODIFIER_KEYS.has(event.key)) return undefined;
  let { key } = event;
  const modifiers = new Set<string>();
  if (event.ctrlKey) modifiers.add('Ctrl');
  if (event.altKey) modifiers.add('Alt');
  if (event.metaKey) modifiers.add('Meta');
  if (event.shiftKey) modifiers.add('Shift');
  if (key === ' ') key = 'Space';
  else if (key === '+') {
    key = 'Plus';
    modifiers.delete('Shift');
  } else if (key.length === 1) {
    key = key.toLowerCase();
    // Shift is already in the character it produced, except for letters, where it is the difference
    // between `i` and `Shift+i`.
    if (!isLetter(key)) modifiers.delete('Shift');
  }
  return assemble(modifiers, key);
}

/** Puts a chord a person wrote into the spelling `chordOf` makes. Throws a `RangeError` for one that cannot be pressed. */
export function normalizeChord(spec: string): string {
  const fail = (): never => {
    throw new RangeError(`"${spec}" is not a key chord. Examples: ArrowDown, Shift+i, Ctrl+Alt+x.`);
  };
  const parts = spec.split('+');
  const keyPart = parts.pop();
  if (keyPart === undefined || keyPart === '') return fail();
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIER_ORDER.find((name) => name.toLowerCase() === part.toLowerCase());
    if (modifier === undefined || modifiers.has(modifier)) return fail();
    modifiers.add(modifier);
  }
  // The same rule as `chordOf`: Shift is already in the character it produced, except for letters.
  const named = NAMED_KEYS.get(keyPart.toLowerCase());
  if (named !== undefined) {
    if (named === 'Plus') modifiers.delete('Shift');
    return assemble(modifiers, named);
  }
  if (keyPart.length !== 1) return fail();
  const key = keyPart.toLowerCase();
  if (!isLetter(key)) modifiers.delete('Shift');
  return assemble(modifiers, key);
}

function assertAction(action: KeyAction, presets: readonly WindowPreset[]): void {
  switch (action.type) {
    case 'scroll':
      if (!Number.isFinite(action.by) || action.by === 0) {
        throw new RangeError('A scroll key needs a number of slices other than 0.');
      }
      break;
    case 'zoom':
      if (!Number.isFinite(action.factor) || action.factor <= 0 || action.factor === 1) {
        throw new RangeError('A zoom key needs a factor above 0 other than 1.');
      }
      break;
    case 'tool':
      // The type forbids it, but a host may pass any string.
      if (!isPrimaryTool(action.tool)) {
        throw new RangeError(`There is no tool ${String(action.tool)}.`);
      }
      break;
    case 'preset':
      if (!presets.some((preset) => preset.id === action.id)) {
        throw new RangeError(`There is no window preset "${action.id}".`);
      }
      break;
    default:
      break;
  }
}

/** The defaults, with the window presets on the digits, changed by what the host asked for. */
export function buildKeymap(
  presets: readonly WindowPreset[],
  overrides: KeybindingOverrides,
): Map<string, KeyAction> {
  const keymap = new Map<string, KeyAction>(Object.entries(DEFAULT_KEYBINDINGS));
  presets.slice(0, 9).forEach((preset, index) => {
    keymap.set((index + 1).toString(), { type: 'preset', id: preset.id });
  });
  const seen = new Set<string>();
  for (const [spec, action] of Object.entries(overrides)) {
    const chord = normalizeChord(spec);
    if (seen.has(chord)) throw new RangeError(`The key ${chord} is bound twice.`);
    seen.add(chord);
    if (action === null) {
      keymap.delete(chord);
      continue;
    }
    assertAction(action, presets);
    keymap.set(chord, action);
  }
  return keymap;
}

/** Whether a key press belongs to a text field, a menu, or anything else that has its own use for keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || !('tagName' in target)) return false;
  const element = target as HTMLElement;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return true;
  return element.isContentEditable;
}
