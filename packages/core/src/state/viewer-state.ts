import { z } from 'zod';
import { isDicomUid } from '../data/uid';

/** The part of a viewport that a link can restore. Viewport ids are stable: `vp-0` to `vp-3`. */
export interface ViewportStateV1 {
  readonly id: string;
  readonly seriesInstanceUID?: string | undefined;
  /** Which stack of the series, when it splits into several. Default 0. */
  readonly stackIndex?: number | undefined;
  readonly imageIndex?: number | undefined;
}

/**
 * Everything needed to put the viewer back where it was, as plain serializable data. Later
 * milestones add fields (measurements, segmentations); readers drop fields they do not know.
 */
export interface ViewerStateV1 {
  readonly version: 1;
  readonly studyInstanceUID?: string | undefined;
  /** Only `1x1` exists until M7. */
  readonly layout: '1x1';
  readonly viewports: readonly ViewportStateV1[];
}

const MAX_VIEWPORTS = 4;

// UIDs from a link or a host end up in request paths: only well-formed ones get in.
const uid = z.string().refine(isDicomUid, 'Not a DICOM UID');

const viewportSchema: z.ZodType<ViewportStateV1> = z.object({
  id: z.string().regex(/^vp-\d+$/, 'Viewport ids look like vp-0'),
  seriesInstanceUID: uid.optional(),
  stackIndex: z.number().int().min(0).optional(),
  imageIndex: z.number().int().min(0).optional(),
});

export const viewerStateV1Schema: z.ZodType<ViewerStateV1> = z.object({
  version: z.literal(1),
  studyInstanceUID: uid.optional(),
  layout: z.literal('1x1').default('1x1'),
  viewports: z
    .array(viewportSchema)
    .max(MAX_VIEWPORTS)
    .refine(
      (viewports) => new Set(viewports.map((viewport) => viewport.id)).size === viewports.length,
      {
        message: 'Viewport ids must be unique',
      },
    )
    // The viewer attaches vp-0 first, and every layout has it.
    .refine((viewports) => viewports.some((viewport) => viewport.id === 'vp-0'), {
      message: 'A state needs the viewport vp-0',
    })
    .default(() => [{ id: 'vp-0' }]),
});

export type ParseResult =
  | { readonly ok: true; readonly state: ViewerStateV1 }
  | { readonly ok: false; readonly error: string };

export function createInitialState(): ViewerStateV1 {
  return { version: 1, layout: '1x1', viewports: [{ id: 'vp-0' }] };
}

/** Validates untrusted input (a URL, a saved session, a host's `initialState`). Never throws. */
export function parseViewerState(input: unknown): ParseResult {
  const parsed = viewerStateV1Schema.safeParse(input);
  if (parsed.success) return { ok: true, state: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error) };
}
