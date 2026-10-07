import { firstNumber, optionalString } from './data/dicom-json';
import type { DicomJsonInstance } from './data/types';
import type { ViewSnapshot, WindowLevel } from './rendering-port';
import { sameZoom } from './view';
import { resolveCorners } from './config/overlay-items';
import { isSensitiveTag, resolveTag } from './config/tags';
import type {
  OverlayBuiltin,
  OverlayCorner,
  OverlayCornersConfig,
  OverlayShownItem,
  OverlayTagItem,
} from './config/types';

export interface OverlayOptions {
  /**
   * Show the patient's name and ID, and every tag that can identify a patient. Off by default: a
   * screenshot or a shared screen should not carry them, whatever the items say.
   */
  readonly showPatientInfo?: boolean;
  /** Lines to change, add, or take out of each corner, by `id`. */
  readonly corners?: OverlayCornersConfig;
}

export interface OverlayInfo {
  readonly modality: string;
  readonly seriesDescription: string | undefined;
  readonly rows: number | undefined;
  readonly columns: number | undefined;
  readonly imageIndex: number;
  readonly imageCount: number;
  readonly window: WindowLevel;
  readonly invert: boolean;
  readonly zoom: number;
  readonly patientName: string | undefined;
  readonly patientId: string | undefined;
  /** The headers of the image on screen, for the lines that show a tag. */
  readonly metadata?: DicomJsonInstance | undefined;
}

export interface OverlayLines {
  readonly topLeft: readonly string[];
  readonly topRight: readonly string[];
  readonly bottomLeft: readonly string[];
  readonly bottomRight: readonly string[];
}

/** Whole numbers for a wide window, a decimal for a narrow one. */
function formatWindowValue(value: number): string {
  return Math.abs(value) >= 10
    ? Math.round(value).toString()
    : (Math.round(value * 10) / 10).toString();
}

/** The longest line the overlay draws: a tag can hold a paragraph. */
const MAX_LINE_LENGTH = 120;

function clip(text: string): string {
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH - 1)}\u2026` : text;
}

/** A PN value as DICOM JSON carries it, in the form a person reads: `DOE^JANE^^^` becomes `DOE JANE`. */
function nameOf(value: unknown): string | undefined {
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null && 'Alphabetic' in value
        ? value.Alphabetic
        : undefined;
  if (typeof text !== 'string') return undefined;
  const name = text.split('^').filter(Boolean).join(' ');
  return name === '' ? undefined : name;
}

function dateOf(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
}

function timeOf(value: string): string {
  const match = /^(\d{2})(\d{2})?(\d{2})?/.exec(value);
  if (match === null) return value;
  return [match[1], match[2], match[3]].filter((part) => part !== undefined).join(':');
}

/** A line from one tag of the image on screen, or `undefined` when the image has no value for it. */
function tagLine(info: OverlayInfo, item: OverlayTagItem): string | undefined {
  const tag = resolveTag(item.tag);
  const entry = tag === undefined ? undefined : info.metadata?.[tag];
  const values: readonly unknown[] = entry?.Value ?? [];
  const [first] = values;
  let text: string | undefined;
  switch (item.format ?? 'text') {
    case 'person-name':
      text = nameOf(first);
      break;
    case 'date':
      text = typeof first === 'string' ? dateOf(first) : undefined;
      break;
    case 'time':
      text = typeof first === 'string' ? timeOf(first) : undefined;
      break;
    case 'number': {
      const number = typeof first === 'string' ? Number(first) : first;
      if (typeof number !== 'number' || !Number.isFinite(number)) break;
      text =
        item.decimals === undefined
          ? (Math.round(number * 100) / 100).toString()
          : number.toFixed(item.decimals);
      break;
    }
    case 'text': {
      const parts = values.flatMap((value) => {
        if (typeof value === 'string' || typeof value === 'number') return [String(value)];
        const name = nameOf(value);
        return name === undefined ? [] : [name];
      });
      text = parts.length === 0 ? undefined : parts.join(' ');
      break;
    }
  }
  if (text === undefined || text === '') return undefined;
  return clip(item.label === undefined ? text : `${item.label} ${text}`);
}

/** A line the overlay has of its own, or `undefined` when there is nothing to say. */
function builtinLine(
  info: OverlayInfo,
  name: OverlayBuiltin,
  showPatientInfo: boolean,
): string | undefined {
  switch (name) {
    case 'patientName':
      return showPatientInfo ? info.patientName : undefined;
    case 'patientId':
      return showPatientInfo ? info.patientId : undefined;
    case 'series':
      return info.seriesDescription;
    case 'modality':
      return info.modality;
    case 'size':
      return info.rows !== undefined && info.columns !== undefined
        ? `${info.columns.toString()} \u00d7 ${info.rows.toString()}`
        : undefined;
    case 'window':
      return `W ${formatWindowValue(info.window.width)}  L ${formatWindowValue(info.window.center)}`;
    case 'zoom':
      return sameZoom(info.zoom, 1) ? undefined : `Zoom ${Math.round(info.zoom * 100).toString()}%`;
    case 'inverted':
      return info.invert ? 'Inverted' : undefined;
    case 'image':
      return `Image ${(info.imageIndex + 1).toString()} / ${info.imageCount.toString()}`;
  }
}

/**
 * What the four corners say, from the items of each. A tag that can identify a patient is left out
 * unless `showPatientInfo` is on, whatever the items say.
 */
export function renderOverlay(
  info: OverlayInfo,
  corners: Readonly<Record<OverlayCorner, readonly OverlayShownItem[]>>,
  showPatientInfo: boolean,
): OverlayLines {
  const lines = (corner: OverlayCorner): string[] =>
    corners[corner].flatMap((item) => {
      let line: string | undefined;
      if (item.kind === 'builtin') {
        line = builtinLine(info, item.name, showPatientInfo);
      } else {
        const tag = resolveTag(item.tag);
        if (tag === undefined || (!showPatientInfo && isSensitiveTag(tag))) return [];
        line = tagLine(info, item);
      }
      return line === undefined ? [] : [line];
    });
  return {
    topLeft: lines('topLeft'),
    topRight: lines('topRight'),
    bottomLeft: lines('bottomLeft'),
    bottomRight: lines('bottomRight'),
  };
}

/** What the four corners say. Pure, so a host that draws its own overlay can use the same text. */
export function overlayLines(info: OverlayInfo, options: OverlayOptions): OverlayLines {
  return renderOverlay(info, resolveCorners(options.corners), options.showPatientInfo === true);
}

function personName(metadata: DicomJsonInstance, tag: string): string | undefined {
  return nameOf(metadata[tag]?.Value?.[0]);
}

export function describeOverlay(source: {
  readonly modality: string;
  readonly seriesDescription: string | undefined;
  /** The metadata of the slice on screen. */
  readonly metadata: DicomJsonInstance;
  readonly imageIndex: number;
  readonly imageCount: number;
  readonly view: ViewSnapshot;
}): OverlayInfo {
  const { metadata, view } = source;
  return {
    modality: source.modality,
    seriesDescription: source.seriesDescription,
    rows: firstNumber(metadata, '00280010'),
    columns: firstNumber(metadata, '00280011'),
    imageIndex: source.imageIndex,
    imageCount: source.imageCount,
    window: view.window,
    invert: view.invert,
    zoom: view.zoom,
    patientName: personName(metadata, '00100010'),
    patientId: optionalString(metadata, '00100020'),
    metadata,
  };
}

export interface OverlayView {
  update(lines: OverlayLines): void;
  /** Removes the overlay and puts the element's position back. */
  destroy(): void;
}

/**
 * Where each corner sits and how it looks. The colours and the font are the shell's tokens when the
 * viewport is inside a `<dv-viewer>` (custom properties reach it from its parent), and the values
 * after the comma when it is not, so a host that uses the core alone gets the same overlay.
 */
const CORNERS = [
  [
    'topLeft',
    'top-left',
    'top:0;left:0;text-align:left;font-weight:600;color:var(--dv-color-overlay-accent,#8ec9ff)',
  ],
  ['topRight', 'top-right', 'top:0;right:0;text-align:right;font-weight:600'],
  ['bottomLeft', 'bottom-left', 'bottom:0;left:0;text-align:left'],
  ['bottomRight', 'bottom-right', 'bottom:0;right:0;text-align:right'],
] as const;

export const OVERLAY_STYLE: string =
  'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;' +
  'font:13px/1.45 var(--dv-font-family,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);' +
  'font-variant-numeric:tabular-nums;color:#e8e8e8;' +
  'text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000;user-select:none';

/**
 * Draws the four corners into `element`, over the picture, and out of the way of the mouse. The
 * text is set as text, never as markup: it comes from the files.
 */
export function createOverlayView(element: HTMLElement): OverlayView {
  const root = element.ownerDocument.createElement('div');
  root.className = 'dv-overlay';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = OVERLAY_STYLE;
  const corners = new Map<(typeof CORNERS)[number][0], HTMLElement>();
  const shown = new Map<string, string>();
  for (const [key, name, style] of CORNERS) {
    const corner = element.ownerDocument.createElement('div');
    corner.dataset['dvCorner'] = name;
    corner.style.cssText = `position:absolute;padding:8px 10px;white-space:pre;${style}`;
    root.append(corner);
    corners.set(key, corner);
  }
  // Kept exactly as the host wrote it (even `static`), so detaching gives the element back as it was.
  const inlinePosition = element.style.position;
  const positioned =
    element.ownerDocument.defaultView?.getComputedStyle(element).position !== 'static';
  if (!positioned) element.style.position = 'relative';
  element.append(root);

  return {
    update(lines): void {
      for (const [key] of CORNERS) {
        const text = lines[key].join('\n');
        // Only touch the page when the text changed: a window drag changes it on every mouse move.
        if (shown.get(key) === text) continue;
        shown.set(key, text);
        const corner = corners.get(key);
        if (corner !== undefined) corner.textContent = text;
      }
    },
    destroy(): void {
      root.remove();
      if (!positioned) element.style.position = inlinePosition;
    },
  };
}
