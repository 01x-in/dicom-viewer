import { firstNumber, optionalString } from './data/dicom-json';
import type { DicomJsonInstance } from './data/types';
import type { ViewSnapshot, WindowLevel } from './rendering-port';
import { sameZoom } from './view';

export interface OverlayOptions {
  /** Show the patient's name and ID. Off by default: a screenshot or a shared screen should not carry them. */
  readonly showPatientInfo?: boolean;
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

/** What the four corners say. Pure, so a host that draws its own overlay can use the same text. */
export function overlayLines(info: OverlayInfo, options: OverlayOptions): OverlayLines {
  const topLeft: string[] = [];
  if (options.showPatientInfo === true) {
    if (info.patientName !== undefined) topLeft.push(info.patientName);
    if (info.patientId !== undefined) topLeft.push(info.patientId);
  }
  if (info.seriesDescription !== undefined) topLeft.push(info.seriesDescription);

  const topRight = [info.modality];
  if (info.rows !== undefined && info.columns !== undefined) {
    topRight.push(`${info.columns.toString()} × ${info.rows.toString()}`);
  }

  const bottomLeft = [
    `W ${formatWindowValue(info.window.width)}  L ${formatWindowValue(info.window.center)}`,
  ];
  if (!sameZoom(info.zoom, 1)) bottomLeft.push(`Zoom ${Math.round(info.zoom * 100).toString()}%`);
  if (info.invert) bottomLeft.push('Inverted');

  return {
    topLeft,
    topRight,
    bottomLeft,
    bottomRight: [`Image ${(info.imageIndex + 1).toString()} / ${info.imageCount.toString()}`],
  };
}

/** A PN value as DICOM JSON carries it, in the form a person reads: `DOE^JANE^^^` becomes `DOE JANE`. */
function personName(metadata: DicomJsonInstance, tag: string): string | undefined {
  const value = metadata[tag]?.Value?.[0];
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
  };
}

export interface OverlayView {
  update(lines: OverlayLines): void;
  /** Removes the overlay and puts the element's position back. */
  destroy(): void;
}

const CORNERS = [
  ['topLeft', 'top-left', 'top:0;left:0;text-align:left'],
  ['topRight', 'top-right', 'top:0;right:0;text-align:right'],
  ['bottomLeft', 'bottom-left', 'bottom:0;left:0;text-align:left'],
  ['bottomRight', 'bottom-right', 'bottom:0;right:0;text-align:right'],
] as const;

/**
 * Draws the four corners into `element`, over the picture, and out of the way of the mouse. The
 * text is set as text, never as markup: it comes from the files.
 */
export function createOverlayView(element: HTMLElement): OverlayView {
  const root = element.ownerDocument.createElement('div');
  root.className = 'dv-overlay';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText =
    'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;' +
    'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e6e6e6;' +
    'text-shadow:0 0 3px #000,0 0 3px #000;user-select:none';
  const corners = new Map<(typeof CORNERS)[number][0], HTMLElement>();
  const shown = new Map<string, string>();
  for (const [key, name, style] of CORNERS) {
    const corner = element.ownerDocument.createElement('div');
    corner.dataset['dvCorner'] = name;
    corner.style.cssText = `position:absolute;padding:6px 8px;white-space:pre;${style}`;
    root.append(corner);
    corners.set(key, corner);
  }
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
      if (!positioned) element.style.removeProperty('position');
    },
  };
}
