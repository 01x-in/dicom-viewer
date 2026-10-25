import { isDicomUid } from '@01x/dicom-viewer-core';

/** The one data type a dragged series carries, so a drop target can tell it from text and files. */
export const SERIES_DRAG_TYPE = 'application/x-dv-series';

/** A payload is two UIDs of 64 characters at most; this leaves room for the keys and no more. */
const MAX_PAYLOAD_LENGTH = 512;

export interface SeriesDrag {
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
}

export function seriesDragData(studyInstanceUID: string, seriesInstanceUID: string): string {
  return JSON.stringify({ studyInstanceUID, seriesInstanceUID });
}

/**
 * Reads what `seriesDragData` wrote. A drop can bring anything from any page, so this checks the
 * shape and the UIDs, and never throws.
 */
export function readSeriesDrag(text: string): SeriesDrag | undefined {
  if (text.length === 0 || text.length > MAX_PAYLOAD_LENGTH) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const { studyInstanceUID, seriesInstanceUID } = parsed as Record<string, unknown>;
  if (typeof studyInstanceUID !== 'string' || !isDicomUid(studyInstanceUID)) return undefined;
  if (typeof seriesInstanceUID !== 'string' || !isDicomUid(seriesInstanceUID)) return undefined;
  return { studyInstanceUID, seriesInstanceUID };
}

/** Whether a drag in progress carries a series. Browsers hide the data itself until the drop. */
export function hasSeriesDrag(
  transfer: { readonly types: readonly string[] } | null | undefined,
): boolean {
  return transfer?.types.includes(SERIES_DRAG_TYPE) === true;
}
