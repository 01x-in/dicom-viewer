import { z } from 'zod';
import { isDicomUid } from '../data/uid';
import { isLayout, type LayoutId, layoutViewportIds } from '../layouts';
import { isMprOrientation, type MprOrientation } from '../mpr';
import { MAX_ZOOM, MIN_ZOOM } from '../view';

/** A window as DICOM defines it: the value at the middle of the grey scale, and the width around it. */
export interface WindowLevel {
  readonly center: number;
  readonly width: number;
}

/** The part of a viewport that a link can restore. Viewport ids are stable: `vp-0` to `vp-3`. */
export interface ViewportStateV1 {
  readonly id: string;
  readonly seriesInstanceUID?: string | undefined;
  /** Which stack of the series, when it splits into several. Default 0. */
  readonly stackIndex?: number | undefined;
  /**
   * A plane to reformat the series in. Absent: the slices as they were acquired. A series that
   * cannot be reformatted is shown as slices whatever this says (see `viewport.mpr`).
   */
  readonly orientation?: MprOrientation | undefined;
  /** The slice on screen: counted along the stack, or along the plane when there is an `orientation`. */
  readonly imageIndex?: number | undefined;
  /** Window and level. Absent: the one the images ask for. */
  readonly window?: WindowLevel | undefined;
  /** Absent: not inverted. */
  readonly invert?: boolean | undefined;
  /** 1 fits the image to the viewport. Absent: 1. */
  readonly zoom?: number | undefined;
}

/**
 * Everything needed to put the viewer back where it was, as plain serializable data. Later
 * milestones add fields (measurements, segmentations); readers drop fields they do not know.
 */
export interface ViewerStateV1 {
  readonly version: 1;
  readonly studyInstanceUID?: string | undefined;
  /** Which viewports there are: `viewports` has exactly the ids this layout shows. */
  readonly layout: LayoutId;
  readonly viewports: readonly ViewportStateV1[];
}

const MAX_VIEWPORTS = 4;

// UIDs from a link or a host end up in request paths: only well-formed ones get in.
const uid = z.string().refine(isDicomUid, 'Not a DICOM UID');

const windowSchema: z.ZodType<WindowLevel> = z.object({
  center: z.number(),
  width: z.number().positive(),
});

const viewportSchema: z.ZodType<ViewportStateV1> = z.object({
  id: z.string().regex(/^vp-[0-3]$/, 'Viewport ids are vp-0 to vp-3'),
  seriesInstanceUID: uid.optional(),
  stackIndex: z.number().int().min(0).optional(),
  orientation: z
    .custom<MprOrientation>((value) => isMprOrientation(value), 'Not an orientation')
    .optional(),
  imageIndex: z.number().int().min(0).optional(),
  window: windowSchema.optional(),
  invert: z.boolean().optional(),
  zoom: z.number().min(MIN_ZOOM).max(MAX_ZOOM).optional(),
});

const layoutSchema: z.ZodType<LayoutId> = z
  .custom<LayoutId>(isLayout, 'Not a layout')
  .default('1x1');

export const viewerStateV1Schema: z.ZodType<ViewerStateV1> = z
  .object({
    version: z.literal(1),
    studyInstanceUID: uid.optional(),
    layout: layoutSchema,
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
  })
  .superRefine((state, context) => {
    const shown = layoutViewportIds(state.layout);
    const stray = state.viewports.find((viewport) => !shown.includes(viewport.id));
    if (stray !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['viewports'],
        message: `The layout ${state.layout} has no viewport ${stray.id}`,
      });
    }
  })
  // The layout decides which viewports there are: the ones a link leaves out start empty.
  .transform((state) => ({
    ...state,
    viewports: layoutViewportIds(state.layout).map(
      (id) => state.viewports.find((viewport) => viewport.id === id) ?? { id },
    ),
  }));

export type ParseResult =
  | { readonly ok: true; readonly state: ViewerStateV1 }
  | { readonly ok: false; readonly error: string };

/** The same viewport without the fields that are `undefined`, so "not set" is one thing and not two. */
export function compactViewport(viewport: ViewportStateV1): ViewportStateV1 {
  const { id, seriesInstanceUID, stackIndex, orientation, imageIndex, window, invert, zoom } =
    viewport;
  return {
    id,
    ...(seriesInstanceUID === undefined ? {} : { seriesInstanceUID }),
    ...(stackIndex === undefined ? {} : { stackIndex }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(imageIndex === undefined ? {} : { imageIndex }),
    ...(window === undefined ? {} : { window }),
    ...(invert === undefined ? {} : { invert }),
    ...(zoom === undefined ? {} : { zoom }),
  };
}

export function createInitialState(): ViewerStateV1 {
  return { version: 1, layout: '1x1', viewports: [{ id: 'vp-0' }] };
}

/** Validates untrusted input (a URL, a saved session, a host's `initialState`). Never throws. */
export function parseViewerState(input: unknown): ParseResult {
  const parsed = viewerStateV1Schema.safeParse(input);
  if (parsed.success) return { ok: true, state: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error) };
}
