import { css, type CSSResult, html, type TemplateResult } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

/**
 * The icons of the shell, drawn for this package on a 24 by 24 grid: a line of 1.75, round ends,
 * in `currentColor`, so a button's colour is the icon's colour. They are decoration. The name of
 * a control is always its `aria-label` or its text, never the picture.
 */
export type IconName =
  | 'window-level'
  | 'pan'
  | 'zoom'
  | 'stack-scroll'
  | 'length'
  | 'bidirectional'
  | 'ellipse'
  | 'rectangle'
  | 'probe'
  | 'angle'
  | 'measure'
  | 'zoom-in'
  | 'zoom-out'
  | 'invert'
  | 'reset'
  | 'cine'
  | 'presets'
  | 'chevron-down'
  | 'chevron-right'
  | 'series'
  | 'segments'
  | 'eye'
  | 'eye-off'
  | 'target'
  | 'highlight'
  | 'close'
  | 'warning'
  | 'check';

/** The inside of each picture, written here and nowhere else: never from a file or a host. */
const SHAPES: Readonly<Record<IconName, string>> = {
  'window-level': `<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>`,
  pan: `<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>`,
  zoom: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5"/>`,
  'stack-scroll': `<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>`,
  length: `<path d="M4 20 20 4"/><path d="m4 15 5 5M15 4l5 5"/>`,
  bidirectional: `<path d="M4 20 20 4M8 8l8 8"/>`,
  ellipse: `<ellipse cx="12" cy="12" rx="9" ry="6"/>`,
  rectangle: `<rect x="3" y="6" width="18" height="12" rx="1.5"/>`,
  probe: `<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>`,
  angle: `<path d="M4 20h16M4 20 15 5"/><path d="M11 20a7 7 0 0 0-1.6-4.4"/>`,
  measure: `<path d="m3 17 14-14 4 4L7 21z"/><path d="m7 9 2 2M10 6l2 2M4 14l2 2"/>`,
  'zoom-in': `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5M10.5 7.5v6M7.5 10.5h6"/>`,
  'zoom-out': `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5.5 5.5M7.5 10.5h6"/>`,
  invert: `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 4h16v16z" fill="currentColor"/>`,
  reset: `<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>`,
  cine: `<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>`,
  presets: `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>`,
  'chevron-down': `<path d="m6 9 6 6 6-6"/>`,
  'chevron-right': `<path d="m9 6 6 6-6 6"/>`,
  series: `<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>`,
  segments: `<path d="M12 3c4 0 8 2.5 8 6.5 0 3-2 4-2 6.5S15 21 12 21 4 19 4 15c0-2 1-3 1-5.5C5 5.5 8 3 12 3z"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  'eye-off': `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>`,
  target: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`,
  highlight: `<path d="m12 3 2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  warning: `<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 17.5v.5"/>`,
  check: `<path d="m5 12 5 5 9-10"/>`,
};

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && Object.hasOwn(SHAPES, value);
}

/**
 * A picture as a CSS `url(...)` for `mask-image`, so a checkbox or any other element can show it in
 * the colour of its text.
 */
export function iconMask(name: IconName): string {
  const markup =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' " +
    `stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${SHAPES[name].replaceAll('"', "'")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

/** The picture, sized by `--dv-icon-size`, hidden from assistive technology. */
export function icon(name: IconName, extraClass = ''): TemplateResult {
  return html`<svg
    class=${extraClass === '' ? 'icon' : `icon ${extraClass}`}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${unsafeSVG(SHAPES[name])}
  </svg>`;
}

/** The styles every piece that shows an icon shares. */
export const iconStyles: CSSResult = css`
  .icon {
    width: var(--dv-icon-size, 1.25rem);
    height: var(--dv-icon-size, 1.25rem);
    flex: none;
    display: block;
  }
`;
