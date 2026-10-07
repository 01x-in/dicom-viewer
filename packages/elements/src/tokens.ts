/**
 * The design tokens, as CSS custom properties. Dark is the default; `data-theme="light"` on
 * `<dv-viewer>` (or on any ancestor, for the stylesheet) switches to the light set. Both sets must
 * define the same names, and the text pairs are tested against the WCAG contrast minimums.
 */
export type ThemeName = 'dark' | 'light';

export const THEMES: readonly ThemeName[] = ['dark', 'light'];

/**
 * A palette is a set of colours, each for both themes. A host picks one with the `palette`
 * attribute and can still change any single colour with its own CSS, because every colour is a
 * `--dv-*` custom property.
 */
export type PaletteName = 'default' | 'navy' | 'graphite';

export const PALETTES: readonly PaletteName[] = ['default', 'navy', 'graphite'];

export type SharedTokenName =
  | '--dv-font-family'
  | '--dv-font-size'
  | '--dv-font-mono'
  | '--dv-radius'
  | '--dv-radius-lg'
  | '--dv-icon-size'
  | '--dv-control-size'
  | '--dv-space'
  | '--dv-toolbar-height'
  | '--dv-panel-width'
  | '--dv-viewport-bg';

export type ThemeTokenName =
  | '--dv-color-bg'
  | '--dv-color-surface'
  | '--dv-color-surface-raised'
  | '--dv-color-border'
  | '--dv-color-text'
  | '--dv-color-text-muted'
  | '--dv-color-accent'
  | '--dv-color-accent-text'
  | '--dv-color-focus'
  | '--dv-color-danger'
  /** A tint for the series line of the overlay. The picture is black in both themes, so it does not change with them. */
  | '--dv-color-overlay-accent';

export type TokenName = SharedTokenName | ThemeTokenName;

/** Not themed: the same in both. */
export const SHARED_TOKENS: Readonly<Record<SharedTokenName, string>> = {
  '--dv-font-family': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--dv-font-size': '0.875rem',
  '--dv-font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  '--dv-radius': '6px',
  '--dv-radius-lg': '10px',
  '--dv-icon-size': '1.25rem',
  '--dv-control-size': '2.25rem',
  '--dv-space': '0.25rem',
  '--dv-toolbar-height': '2.75rem',
  '--dv-panel-width': '17rem',
  '--dv-viewport-bg': '#000000',
};

type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;

export const PALETTE_TOKENS: Readonly<
  Record<PaletteName, Readonly<Record<ThemeName, ThemeTokens>>>
> = {
  default: {
    dark: {
      '--dv-color-bg': '#0f1216',
      '--dv-color-surface': '#171b21',
      '--dv-color-surface-raised': '#212731',
      '--dv-color-border': '#667284',
      '--dv-color-text': '#e8ebf0',
      '--dv-color-text-muted': '#a7b0be',
      '--dv-color-accent': '#5aa9ff',
      '--dv-color-accent-text': '#06121f',
      '--dv-color-focus': '#9ccbff',
      '--dv-color-danger': '#ff8f8f',
      '--dv-color-overlay-accent': '#8ec9ff',
    },
    light: {
      '--dv-color-bg': '#f3f5f8',
      '--dv-color-surface': '#ffffff',
      '--dv-color-surface-raised': '#e9edf2',
      '--dv-color-border': '#6b7686',
      '--dv-color-text': '#14181d',
      '--dv-color-text-muted': '#475262',
      '--dv-color-accent': '#0b5fc4',
      '--dv-color-accent-text': '#ffffff',
      '--dv-color-focus': '#0a4a9c',
      '--dv-color-danger': '#b3261e',
      '--dv-color-overlay-accent': '#8ec9ff',
    },
  },
  // Deep blue chrome with a cyan accent.
  navy: {
    dark: {
      '--dv-color-bg': '#050818',
      '--dv-color-surface': '#0b1130',
      '--dv-color-surface-raised': '#151d47',
      '--dv-color-border': '#6573ad',
      '--dv-color-text': '#e9edf8',
      '--dv-color-text-muted': '#aab5d8',
      '--dv-color-accent': '#5acce6',
      '--dv-color-accent-text': '#04141a',
      '--dv-color-focus': '#8fe3f5',
      '--dv-color-danger': '#ff9a9a',
      '--dv-color-overlay-accent': '#7fd4ea',
    },
    light: {
      '--dv-color-bg': '#eef1fa',
      '--dv-color-surface': '#ffffff',
      '--dv-color-surface-raised': '#e2e7f5',
      '--dv-color-border': '#656fa0',
      '--dv-color-text': '#101433',
      '--dv-color-text-muted': '#444f7a',
      '--dv-color-accent': '#0a5a99',
      '--dv-color-accent-text': '#ffffff',
      '--dv-color-focus': '#08487a',
      '--dv-color-danger': '#b3261e',
      '--dv-color-overlay-accent': '#7fd4ea',
    },
  },
  // Neutral grey chrome with a teal accent, for a host that has its own colours.
  graphite: {
    dark: {
      '--dv-color-bg': '#101011',
      '--dv-color-surface': '#1a1a1c',
      '--dv-color-surface-raised': '#262629',
      '--dv-color-border': '#7b7b82',
      '--dv-color-text': '#ececee',
      '--dv-color-text-muted': '#b1b1b8',
      '--dv-color-accent': '#4cc9b0',
      '--dv-color-accent-text': '#04150f',
      '--dv-color-focus': '#8fe6d3',
      '--dv-color-danger': '#ff9494',
      '--dv-color-overlay-accent': '#8fe0d0',
    },
    light: {
      '--dv-color-bg': '#f4f4f5',
      '--dv-color-surface': '#ffffff',
      '--dv-color-surface-raised': '#e8e8ea',
      '--dv-color-border': '#74747b',
      '--dv-color-text': '#18181b',
      '--dv-color-text-muted': '#4a4a51',
      '--dv-color-accent': '#0f766e',
      '--dv-color-accent-text': '#ffffff',
      '--dv-color-focus': '#0b5d57',
      '--dv-color-danger': '#b3261e',
      '--dv-color-overlay-accent': '#8fe0d0',
    },
  },
};

/** The default palette: what the shell is without a `palette` attribute. */
export const THEME_TOKENS: Readonly<Record<ThemeName, ThemeTokens>> = PALETTE_TOKENS.default;

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
}

/**
 * The tokens as CSS, scoped to a selector for each theme: `host` for the dark default and the
 * shared tokens, `lightHost` for the light set.
 */
export function tokenCss(host: string, lightHost: string): string {
  return [
    `${host} {\n${declarations({ ...SHARED_TOKENS, ...THEME_TOKENS.dark })}\n}`,
    `${lightHost} {\n${declarations(THEME_TOKENS.light)}\n}`,
  ].join('\n\n');
}

/**
 * The tokens of the palettes other than the default, each scoped by `selectors`. Written after
 * `tokenCss`, so a palette wins over the default of the same theme, and the light set of a palette
 * (more specific) wins over its own dark set.
 */
export function paletteCss(selectors: {
  readonly dark: (palette: PaletteName) => string;
  readonly light: (palette: PaletteName) => string;
}): string {
  return PALETTES.filter((name) => name !== 'default')
    .map((name) =>
      [
        `${selectors.dark(name)} {\n${declarations(PALETTE_TOKENS[name].dark)}\n}`,
        `${selectors.light(name)} {\n${declarations(PALETTE_TOKENS[name].light)}\n}`,
      ].join('\n\n'),
    )
    .join('\n\n');
}

/** Only the light set, for an element that is told its theme but does not inherit one. */
export function lightTokenCss(lightHost: string): string {
  return `${lightHost} {\n${declarations(THEME_TOKENS.light)}\n}`;
}

/** The file shipped as `@scope/viewer-elements/styles.css`: the same tokens for a host's own page. */
export function stylesheet(): string {
  return `/* Design tokens of @scope/viewer-elements. Generated from src/tokens.ts. */\n${tokenCss(
    'dv-viewer',
    "[data-theme='light'] dv-viewer, dv-viewer[data-theme='light']",
  )}\n${paletteCss({
    dark: (palette) => `dv-viewer[data-palette='${palette}']`,
    light: (palette) =>
      `[data-theme='light'] dv-viewer[data-palette='${palette}'], dv-viewer[data-palette='${palette}'][data-theme='light']`,
  })}\n`;
}
