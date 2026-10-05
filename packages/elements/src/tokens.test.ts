import { describe, expect, it } from 'vitest';
import { SHARED_TOKENS, stylesheet, THEME_TOKENS, tokenCss } from './tokens';

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

describe.each(['dark', 'light'] as const)('the %s theme', (name) => {
  const tokens = THEME_TOKENS[name];

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
});

describe('the token sets', () => {
  it('define the same names in both themes', () => {
    expect(Object.keys(THEME_TOKENS.light).sort()).toEqual(Object.keys(THEME_TOKENS.dark).sort());
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
