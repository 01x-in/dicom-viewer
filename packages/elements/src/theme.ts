import { css, type CSSResult, unsafeCSS } from 'lit';
import { tokenCss } from './tokens';

/** The tokens, for the root of a shadow tree. The element's `data-theme` picks the set. */
export const themeStyles: CSSResult = unsafeCSS(tokenCss(':host', ":host([data-theme='light'])"));

/** Shared by every piece of chrome: the reset, the focus ring, and the visually-hidden helper. */
export const baseStyles: CSSResult = css`
  :host {
    font-family: var(--dv-font-family);
    font-size: var(--dv-font-size);
    color: var(--dv-color-text);
    box-sizing: border-box;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  :focus-visible {
    outline: 2px solid var(--dv-color-focus);
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
