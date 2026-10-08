import { z } from 'zod';
import type { SeriesSummary } from './data/types';
import { isLayout, type LayoutId, layoutViewportIds } from './layouts';

/** Modalities that hold no picture to show, so they cannot be put in a viewport. */
const NOT_IMAGES: ReadonlySet<string> = new Set(['SEG', 'SR', 'KO', 'PR', 'DOC', 'REG', 'RWV']);

export function isDisplayableModality(modality: string): boolean {
  return !NOT_IMAGES.has(modality);
}

/** Which series a viewport wants. Every key that is set must match; one with none takes any series that can be shown. */
export interface SeriesRule {
  /** `CT`, or any of `['CT', 'MR']`. */
  readonly modality?: string | readonly string[] | undefined;
  /** Part of the series description, without regard to case. */
  readonly descriptionIncludes?: string | undefined;
  /** The series has at least this many images. A series that does not say how many has 0. */
  readonly minInstances?: number | undefined;
  /** Of the series that match: the first in the study's order (default), or the one with most images. */
  readonly pick?: 'first' | 'largest' | undefined;
}

export interface HangingViewport {
  /** One of the ids of the layout. */
  readonly id: string;
  readonly series: SeriesRule;
}

/**
 * How to hang a study: a layout and what each viewport should show. Plain data, so a host can keep
 * protocols in a file. Several can be given; the one that fits the study best is used.
 */
export interface HangingProtocol {
  /** Lower-case letters, digits, and hyphens. */
  readonly id: string;
  readonly name?: string | undefined;
  readonly layout: LayoutId;
  /** Needs `vp-0`. A viewport that finds no series stays empty. */
  readonly viewports: readonly HangingViewport[];
  /** A higher number wins over a better fit. Default 0. */
  readonly priority?: number | undefined;
}

export interface HangingAssignment {
  readonly viewportId: string;
  readonly seriesInstanceUID: string;
}

export interface HangingMatch {
  readonly protocol: HangingProtocol;
  readonly assignments: readonly HangingAssignment[];
  readonly score: number;
}

/** More than a viewport's rules can add (3), so a protocol with a blank viewport loses to one that fits. */
const EMPTY_VIEWPORT_PENALTY = 5;

/** How much a rule asks for: each key that is set narrows the choice, so it is worth more. */
function specificity(rule: SeriesRule): number {
  return [rule.modality, rule.descriptionIncludes, rule.minInstances].filter(
    (value) => value !== undefined,
  ).length;
}

function matches(rule: SeriesRule, series: SeriesSummary): boolean {
  if (!isDisplayableModality(series.modality)) return false;
  if (rule.modality !== undefined) {
    const wanted = typeof rule.modality === 'string' ? [rule.modality] : rule.modality;
    if (!wanted.includes(series.modality)) return false;
  }
  if (
    rule.descriptionIncludes !== undefined &&
    !(series.description ?? '').toLowerCase().includes(rule.descriptionIncludes.toLowerCase())
  ) {
    return false;
  }
  return (series.instanceCount ?? 0) >= (rule.minInstances ?? 0);
}

function score(
  protocol: HangingProtocol,
  series: readonly SeriesSummary[],
): HangingMatch | undefined {
  const used = new Set<string>();
  const assignments: HangingAssignment[] = [];
  let fit = 0;
  for (const viewport of protocol.viewports) {
    const candidates = series.filter(
      (entry) => !used.has(entry.seriesInstanceUID) && matches(viewport.series, entry),
    );
    const chosen =
      viewport.series.pick === 'largest'
        ? candidates.reduce<SeriesSummary | undefined>(
            (best, entry) =>
              best === undefined || (entry.instanceCount ?? 0) > (best.instanceCount ?? 0)
                ? entry
                : best,
            undefined,
          )
        : candidates[0];
    if (chosen === undefined) {
      // A viewport left empty counts against the protocol: it should not be padded with blanks.
      fit -= EMPTY_VIEWPORT_PENALTY;
      continue;
    }
    used.add(chosen.seriesInstanceUID);
    assignments.push({ viewportId: viewport.id, seriesInstanceUID: chosen.seriesInstanceUID });
    // A filled viewport is worth more than any rule, so a protocol that shows more series wins.
    fit += 100 + specificity(viewport.series);
  }
  // Without the first viewport the study opens on nothing, whatever else fits.
  if (!assignments.some((entry) => entry.viewportId === 'vp-0')) return undefined;
  return { protocol, assignments, score: (protocol.priority ?? 0) * 10_000 + fit };
}

/**
 * The protocol that fits the series best, with the series for each viewport, or `undefined` when
 * none fits. A viewport takes the first series (in the study's order) that its rule accepts and
 * no earlier viewport took. More viewports filled is better, then more rules met, and a viewport
 * left empty counts against the protocol. A higher `priority` outranks all of that, and a tie goes
 * to the protocol listed first. Pure: nothing is changed.
 */
export function matchHangingProtocol(
  protocols: readonly HangingProtocol[],
  series: readonly SeriesSummary[],
): HangingMatch | undefined {
  let best: HangingMatch | undefined;
  for (const protocol of protocols) {
    const found = score(protocol, series);
    if (found !== undefined && (best === undefined || found.score > best.score)) best = found;
  }
  return best;
}

/** One series alone, two side by side, and a CT beside an MR. A host opts in by passing them. */
export const DEFAULT_HANGING_PROTOCOLS: readonly HangingProtocol[] = [
  { id: 'single', name: 'One series', layout: '1x1', viewports: [{ id: 'vp-0', series: {} }] },
  {
    id: 'side-by-side',
    name: 'Two series side by side',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', series: {} },
      { id: 'vp-1', series: {} },
    ],
  },
  {
    id: 'ct-mr',
    name: 'CT beside MR',
    layout: '1x2',
    viewports: [
      { id: 'vp-0', series: { modality: 'CT' } },
      { id: 'vp-1', series: { modality: 'MR' } },
    ],
  },
];

const ruleSchema: z.ZodType<SeriesRule> = z.strictObject({
  modality: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  descriptionIncludes: z.string().min(1).optional(),
  minInstances: z.number().int().min(0).optional(),
  pick: z.enum(['first', 'largest']).optional(),
});

const protocolSchema: z.ZodType<HangingProtocol> = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lower-case letters, digits, and hyphens'),
    name: z.string().optional(),
    layout: z.custom<LayoutId>((value) => isLayout(value), 'There is no such layout'),
    viewports: z
      .array(
        z.strictObject({
          id: z.string().regex(/^vp-[0-3]$/, 'Viewport ids are vp-0 to vp-3'),
          series: ruleSchema,
        }),
      )
      .min(1),
    priority: z.number().int().optional(),
  })
  .superRefine((protocol, context) => {
    const ids = protocol.viewports.map((viewport) => viewport.id);
    const shown = isLayout(protocol.layout) ? layoutViewportIds(protocol.layout) : [];
    const stray = ids.find((id) => !shown.includes(id));
    if (stray !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['viewports'],
        message: `The layout ${protocol.layout} has no viewport ${stray}`,
      });
    }
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['viewports'],
        message: 'A viewport is listed twice',
      });
    }
    if (!ids.includes('vp-0')) {
      context.addIssue({ code: 'custom', path: ['viewports'], message: 'A protocol needs vp-0' });
    }
  });

const listSchema: z.ZodType<readonly HangingProtocol[]> = z
  .array(protocolSchema)
  .superRefine((protocols, context) => {
    const ids = protocols.map((protocol) => protocol.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Two protocols have the same id' });
    }
  });

/** Checks a list of protocols, which may come from a file. Throws a `RangeError` that names each path. */
export function parseHangingProtocols(input: unknown): readonly HangingProtocol[] {
  const result = listSchema.safeParse(input);
  if (result.success) return structuredClone(result.data);
  const lines = result.error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(list)'}: ${issue.message}`,
  );
  throw new RangeError(`Invalid hanging protocols:\n${lines.join('\n')}`);
}
