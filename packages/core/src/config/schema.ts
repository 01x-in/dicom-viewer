import { z } from 'zod';
import { type KeyAction, normalizeChord } from '../keyboard';
import { isPrimaryTool, type PrimaryTool } from '../tools';
import type { WindowPreset } from '../window-presets';
import {
  PALETTE_NAMES,
  PANEL_IDS,
  THEME_NAMES,
  TOOLBAR_LABELS,
  type ViewerConfigV1,
} from './types';

const keyActionSchema: z.ZodType<KeyAction> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('scroll'),
    by: z.number().refine((by) => by !== 0, 'A scroll key needs a number of slices other than 0.'),
  }),
  z.strictObject({ type: z.literal('scroll-to'), position: z.enum(['first', 'last']) }),
  z.strictObject({
    type: z.literal('zoom'),
    factor: z
      .number()
      .refine(
        (factor) => factor > 0 && factor !== 1,
        'A zoom key needs a factor above 0 other than 1.',
      ),
  }),
  z.strictObject({ type: z.literal('invert') }),
  z.strictObject({ type: z.literal('reset') }),
  z.strictObject({ type: z.literal('cine') }),
  z.strictObject({
    type: z.literal('tool'),
    tool: z.custom<PrimaryTool>((value) => isPrimaryTool(value), 'There is no such tool.'),
  }),
  z.strictObject({ type: z.literal('preset'), id: z.string().min(1) }),
  z.strictObject({ type: z.literal('delete-measurement') }),
]);

const windowPresetSchema: z.ZodType<WindowPreset> = z.strictObject({
  id: z.string().min(1),
  label: z.string(),
  center: z.number(),
  width: z.number().positive(),
});

/**
 * `false`, or what `schema` says. A plain union would report a mistake inside the object as "no
 * option matched", with no path, so the object's own problems are passed on with their paths.
 */
function orFalse<T>(schema: z.ZodType<T>): z.ZodType<false | T> {
  return z.unknown().transform((value, context): false | T => {
    if (value === false) return false;
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      context.issues.push({
        code: 'custom',
        message: issue.message,
        path: issue.path,
        input: value,
      });
    }
    return z.NEVER;
  });
}

const configSchema: z.ZodType<ViewerConfigV1> = z
  .strictObject({
    version: z.literal(1),
    theme: z.enum(THEME_NAMES).nullable().optional(),
    palette: z.enum(PALETTE_NAMES).nullable().optional(),
    toolbar: z
      .strictObject({
        labels: z.enum(TOOLBAR_LABELS).optional(),
        hidden: z.boolean().optional(),
      })
      .nullable()
      .optional(),
    keybindings: orFalse(z.record(z.string(), keyActionSchema.nullable())).nullable().optional(),
    overlay: orFalse(z.strictObject({ showPatientInfo: z.boolean().optional() }))
      .nullable()
      .optional(),
    panels: z
      .strictObject({ hide: z.array(z.enum(PANEL_IDS)).optional() })
      .nullable()
      .optional(),
    windowLevelPresets: z.array(windowPresetSchema).nullable().optional(),
    tools: z
      .strictObject({
        active: z
          .custom<PrimaryTool>((value) => isPrimaryTool(value), 'There is no such tool.')
          .optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((config, context) => {
    if (typeof config.keybindings === 'object' && config.keybindings !== null) {
      const seen = new Set<string>();
      for (const spec of Object.keys(config.keybindings)) {
        let chord: string;
        try {
          chord = normalizeChord(spec);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            path: ['keybindings', spec],
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        if (seen.has(chord)) {
          context.addIssue({
            code: 'custom',
            path: ['keybindings', spec],
            message: `The key ${chord} is bound twice.`,
          });
        }
        seen.add(chord);
      }
    }
    const ids = new Set<string>();
    (config.windowLevelPresets ?? []).forEach((preset, index) => {
      if (ids.has(preset.id)) {
        context.addIssue({
          code: 'custom',
          path: ['windowLevelPresets', index, 'id'],
          message: `The window preset id "${preset.id}" is used twice.`,
        });
      }
      ids.add(preset.id);
    });
  });

export type ParsedViewerConfig =
  | { readonly ok: true; readonly config: ViewerConfigV1 }
  | { readonly ok: false; readonly errors: readonly string[] };

/** `a.b.0.c` for a path, or `config` for the root. */
function pathText(path: readonly PropertyKey[]): string {
  return path.length === 0 ? 'config' : path.map(String).join('.');
}

/**
 * Checks a config that came from outside: a file, a URL, a host's own object. The result is a
 * copy, so a later change to the input does not reach the viewer. A config with any problem is
 * refused whole, and each problem names its path.
 */
export function parseViewerConfig(input: unknown): ParsedViewerConfig {
  const result = configSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${pathText(issue.path)}: ${issue.message}`),
  };
}
