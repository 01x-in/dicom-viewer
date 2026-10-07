import { css, type CSSResult, unsafeCSS } from 'lit';
import { lightTokenCss, paletteCss, tokenCss } from './tokens';

/**
 * The tokens, for the shell: dark by default, light with `data-theme="light"`. Everything inside
 * inherits them.
 */
export const shellThemeStyles: CSSResult = unsafeCSS(
  [
    tokenCss(':host', ":host([data-theme='light'])"),
    paletteCss({
      dark: (palette) => `:host([data-palette='${palette}'])`,
      light: (palette) => `:host([data-palette='${palette}'][data-theme='light'])`,
    }),
  ].join('\n\n'),
);

/**
 * For the pieces inside the shell. They declare no tokens of their own, because that would override
 * what they inherit from the shell: every `var()` carries the dark value as its fallback, so a piece
 * used alone is dark, and `data-theme="light"` on it alone makes it light.
 */
export const themeStyles: CSSResult = unsafeCSS(lightTokenCss(":host([data-theme='light'])"));

/** Shared by every piece of chrome: the reset, the focus ring, and the visually-hidden helper. */
export const baseStyles: CSSResult = css`
  :host {
    font-family: var(--dv-font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    font-size: var(--dv-font-size, 0.875rem);
    color: var(--dv-color-text, #e8ebf0);
    box-sizing: border-box;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  :focus-visible {
    outline: 2px solid var(--dv-color-focus, #9ccbff);
    outline-offset: 2px;
  }
  .dv-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  @media (forced-colors: active) {
    :focus-visible {
      outline-color: Highlight;
    }
  }
`;
