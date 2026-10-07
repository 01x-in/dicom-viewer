import { describe, expect, it } from 'vitest';
import {
  PALETTE_TOKENS,
  PALETTES,
  paletteCss,
  SHARED_TOKENS,
  stylesheet,
  THEME_TOKENS,
  tokenCss,
} from './tokens';

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe.each(
  PALETTES.flatMap((palette) =>
    (['dark', 'light'] as const).map((name) => [palette, name] as const),
  ),
)('the %s palette, %s theme', (palette, name) => {
  const tokens = PALETTE_TOKENS[palette][name];

  it.each([
    ['--dv-color-text', '--dv-color-bg'],
    ['--dv-color-text', '--dv-color-surface'],
    ['--dv-color-text', '--dv-color-surface-raised'],
    ['--dv-color-text-muted', '--dv-color-surface'],
    ['--dv-color-text-muted', '--dv-color-surface-raised'],
    ['--dv-color-accent-text', '--dv-color-accent'],
    ['--dv-color-danger', '--dv-color-surface'],
  ] as const)('reads %s on %s at 4.5:1 or better', (foreground, background) => {
    expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['--dv-color-border', '--dv-color-focus', '--dv-color-accent'] as const)(
    'shows %s against the surface at 3:1 or better',
    (token) => {
      expect(contrast(tokens[token], tokens['--dv-color-surface'])).toBeGreaterThanOrEqual(3);
    },
  );

  it('reads the overlay tint on the black picture at 4.5:1 or better', () => {
    expect(
      contrast(tokens['--dv-color-overlay-accent'], SHARED_TOKENS['--dv-viewport-bg']),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the token sets', () => {
  it('define the same names in both themes of every palette', () => {
    const names = Object.keys(THEME_TOKENS.dark).sort();
    for (const palette of PALETTES) {
      expect(Object.keys(PALETTE_TOKENS[palette].dark).sort()).toEqual(names);
      expect(Object.keys(PALETTE_TOKENS[palette].light).sort()).toEqual(names);
    }
  });

  it('make each palette differ from the default in its accent', () => {
    for (const palette of PALETTES.filter((name) => name !== 'default')) {
      expect(PALETTE_TOKENS[palette].dark['--dv-color-accent']).not.toBe(
        THEME_TOKENS.dark['--dv-color-accent'],
      );
    }
  });

  it('write a palette after the default, and its light set more specifically than its dark set', () => {
    const css = [
      tokenCss(':host', ":host([data-theme='light'])"),
      paletteCss({
        dark: (palette) => `:host([data-palette='${palette}'])`,
        light: (palette) => `:host([data-palette='${palette}'][data-theme='light'])`,
      }),
    ].join('\n');
    const navyDark = css.indexOf(":host([data-palette='navy']) {");
    const navyLight = css.indexOf(":host([data-palette='navy'][data-theme='light']) {");
    expect(navyDark).toBeGreaterThan(css.indexOf(":host([data-theme='light']) {"));
    expect(navyLight).toBeGreaterThan(navyDark);
    expect(css).toContain(`--dv-color-accent: ${PALETTE_TOKENS.navy.dark['--dv-color-accent']};`);
  });

  it('give the stylesheet a rule for each palette', () => {
    const css = stylesheet();
    for (const palette of PALETTES.filter((name) => name !== 'default')) {
      expect(css).toContain(`dv-viewer[data-palette='${palette}'] {`);
    }
  });

  it('start every name with --dv-, so they cannot clash with a host', () => {
    for (const name of [
      ...Object.keys(SHARED_TOKENS),
      ...Object.keys(THEME_TOKENS.dark),
      ...Object.keys(THEME_TOKENS.light),
    ]) {
      expect(name).toMatch(/^--dv-[a-z-]+$/);
    }
  });

  it('are what the stylesheet and the shadow styles write', () => {
    const css = stylesheet();
    for (const [name, value] of Object.entries({ ...SHARED_TOKENS, ...THEME_TOKENS.dark })) {
      expect(css).toContain(`${name}: ${value};`);
    }
    expect(css).toContain("dv-viewer[data-theme='light'] {");
    expect(tokenCss(':host', ":host([data-theme='light'])")).toContain(
      `--dv-color-bg: ${THEME_TOKENS.light['--dv-color-bg']};`,
    );
  });
});
