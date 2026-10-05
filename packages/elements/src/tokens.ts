/**
 * The design tokens, as CSS custom properties. Dark is the default; `data-theme="light"` on
 * `<dv-viewer>` (or on any ancestor, for the stylesheet) switches to the light set. Both sets must
 * define the same names, and the text pairs are tested against the WCAG contrast minimums.
 */
export type ThemeName = 'dark' | 'light';

export const THEMES: readonly ThemeName[] = ['dark', 'light'];

/** Not themed: the same in both. */
export const SHARED_TOKENS = {
  '--dv-font-family': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--dv-font-size': '0.875rem',
  '--dv-radius': '6px',
  '--dv-space': '0.25rem',
  '--dv-toolbar-height': '2.75rem',
  '--dv-panel-width': '17rem',
  '--dv-viewport-bg': '#000000',
} as const;

export const THEME_TOKENS = {
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
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

export type TokenName = keyof (typeof THEME_TOKENS)['dark'] | keyof typeof SHARED_TOKENS;

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

/** The file shipped as `@scope/viewer-elements/styles.css`: the same tokens for a host's own page. */
export function stylesheet(): string {
  return `/* Design tokens of @scope/viewer-elements. Generated from src/tokens.ts. */\n${tokenCss(
    'dv-viewer',
    "dv-viewer[data-theme='light']",
  )}\n`;
}
