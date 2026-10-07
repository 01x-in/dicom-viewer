import { z } from 'zod';
import { type KeyAction, normalizeChord } from '../keyboard';
import type { PrimaryTool } from '../tools';
import type { WindowPreset } from '../window-presets';
import { resolveTag } from './tags';
import {
  OVERLAY_BUILTINS,
  OVERLAY_FORMATS,
  type OverlayItemConfig,
  PALETTE_NAMES,
  PANEL_IDS,
  THEME_NAMES,
  TOOLBAR_LABELS,
  type ToolbarItemConfig,
  type ViewerConfigV1,
} from './types';

/** The ids of the tools, written once more so Zod (and the JSON Schema) can list them. A test keeps it equal to `PRIMARY_TOOLS`. */
const PRIMARY_TOOL_IDS = [
  'window-level',
  'pan',
  'zoom',
  'stack-scroll',
  'length',
  'bidirectional',
  'ellipse',
  'rectangle',
  'probe',
  'angle',
] as const satisfies readonly PrimaryTool[];

const toolSchema: z.ZodType<PrimaryTool> = z.enum(PRIMARY_TOOL_IDS);

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
    tool: toolSchema,
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

/** What JSON can say: no functions, no `undefined`, no cycles, and not so deep that it is a trap. */
function isJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((item) => isJson(item, depth + 1));
  }
  return false;
}

const OVERLAY_ITEM_ID = /^[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$/;
const ITEM_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const itemId = z
  .string()
  .regex(
    ITEM_ID,
    'An id uses lower-case letters, digits and single hyphens, and starts with a letter.',
  );
const jsonArgs = z
  .unknown()
  .refine((value) => isJson(value), 'Arguments must be JSON: no functions.');

const menuEntrySchema = z.strictObject({
  id: itemId,
  label: z.string().min(1),
  icon: z.string().optional(),
  command: z.string().min(1),
  args: jsonArgs.optional(),
});

const toolbarItemSchema: z.ZodType<ToolbarItemConfig> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('tool'),
    tool: toolSchema,
    label: z.string().min(1).optional(),
    icon: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('command'),
    id: itemId,
    label: z.string().min(1),
    icon: z.string().optional(),
    command: z.string().min(1),
    args: jsonArgs.optional(),
  }),
  z.strictObject({
    type: z.literal('menu'),
    id: itemId,
    label: z.string().min(1),
    icon: z.string().optional(),
    items: z.array(menuEntrySchema).min(1),
  }),
  z.strictObject({ type: z.literal('separator') }),
]);

const overlayItemId = z
  .string()
  .regex(
    OVERLAY_ITEM_ID,
    'An id uses letters, digits and single hyphens, and starts with a letter.',
  );

const overlayBuiltinSchema = z.strictObject({
  id: overlayItemId,
  kind: z.literal('builtin'),
  name: z.enum(OVERLAY_BUILTINS),
});
const overlayTagSchema = z.strictObject({
  id: overlayItemId,
  kind: z.literal('tag'),
  tag: z
    .string()
    .refine(
      (spec) => resolveTag(spec) !== undefined,
      'Not a tag the viewer knows by that keyword, and not eight hex digits such as 00181030.',
    ),
  label: z.string().optional(),
  format: z.enum(OVERLAY_FORMATS).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
});
const overlayRemoveSchema = z.strictObject({ id: overlayItemId, kind: z.literal('remove') });

const overlayItemSchema: z.ZodType<OverlayItemConfig> = z.discriminatedUnion('kind', [
  overlayBuiltinSchema,
  overlayTagSchema,
  overlayRemoveSchema,
]);

const cornerSchema = z.array(overlayItemSchema).max(12, 'A corner has room for 12 lines.');

const configSchema: z.ZodType<ViewerConfigV1> = z
  .strictObject({
    version: z.literal(1),
    $schema: z.string().optional(),
    theme: z.enum(THEME_NAMES).nullable().optional(),
    palette: z.enum(PALETTE_NAMES).nullable().optional(),
    toolbar: z
      .strictObject({
        labels: z.enum(TOOLBAR_LABELS).optional(),
        hidden: z.boolean().optional(),
        items: z.array(toolbarItemSchema).optional(),
      })
      .nullable()
      .optional(),
    keybindings: z
      .union([z.literal(false), z.record(z.string(), keyActionSchema.nullable())])
      .nullable()
      .optional(),
    overlay: z
      .union([
        z.literal(false),
        z.strictObject({
          showPatientInfo: z.boolean().optional(),
          corners: z
            .strictObject({
              topLeft: cornerSchema.optional(),
              topRight: cornerSchema.optional(),
              bottomLeft: cornerSchema.optional(),
              bottomRight: cornerSchema.optional(),
            })
            .optional(),
        }),
      ])
      .nullable()
      .optional(),
    panels: z
      .strictObject({ hide: z.array(z.enum(PANEL_IDS)).optional() })
      .nullable()
      .optional(),
    windowLevelPresets: z.array(windowPresetSchema).nullable().optional(),
    tools: z
      .strictObject({
        active: toolSchema.optional(),
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
    if (typeof config.overlay === 'object' && config.overlay !== null) {
      for (const [corner, items] of Object.entries(config.overlay.corners ?? {})) {
        const seen = new Set<string>();
        (items ?? []).forEach((item, index) => {
          if (seen.has(item.id)) {
            context.addIssue({
              code: 'custom',
              path: ['overlay', 'corners', corner, index, 'id'],
              message: `The overlay id "${item.id}" is used twice in ${corner}.`,
            });
          }
          seen.add(item.id);
        });
      }
    }
    const buttonIds = new Set<string>();
    (config.toolbar?.items ?? []).forEach((item, index) => {
      if (item.type === 'command' || item.type === 'menu') {
        if (buttonIds.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: ['toolbar', 'items', index, 'id'],
            message: `The toolbar id "${item.id}" is used twice.`,
          });
        }
        buttonIds.add(item.id);
      }
      if (item.type === 'menu') {
        const entryIds = new Set<string>();
        item.items.forEach((entry, at) => {
          if (entryIds.has(entry.id)) {
            context.addIssue({
              code: 'custom',
              path: ['toolbar', 'items', index, 'items', at, 'id'],
              message: `The menu entry id "${entry.id}" is used twice.`,
            });
          }
          entryIds.add(entry.id);
        });
      }
    });
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

/**
 * The JSON Schema of `ViewerConfigV1`, for an editor that completes and checks a config file.
 * Shipped as `viewer-config.schema.json`. It says what the shape allows. The checks that need more
 * than the shape (a command that is registered, a chord that can be pressed) are made when the
 * config is read.
 */
export function viewerConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' });
}

export type ParsedViewerConfig =
  | { readonly ok: true; readonly config: ViewerConfigV1 }
  | { readonly ok: false; readonly errors: readonly string[] };

/** `a.b.0.c` for a path, or `config` for the root. */
function pathText(path: readonly PropertyKey[]): string {
  return path.length === 0 ? 'config' : path.map(String).join('.');
}

interface Problem {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * The problems of a parse, each with its full path. A union (`false`, or an object) reports "no
 * option matched" and keeps the problems of each option inside it, so the option that got furthest
 * is the one the mistake belongs to, and its problems are the ones to show.
 */
function flatten(
  issues: readonly z.core.$ZodIssue[],
  prefix: readonly PropertyKey[] = [],
): Problem[] {
  return issues.flatMap((issue): Problem[] => {
    const path = [...prefix, ...issue.path];
    if (issue.code !== 'invalid_union' || issue.errors.length === 0) {
      return [{ path, message: issue.message }];
    }
    const depth = (branch: readonly z.core.$ZodIssue[]): number =>
      Math.max(0, ...branch.map((item) => item.path.length));
    const best = issue.errors.reduce((chosen, branch) =>
      depth(branch) > depth(chosen) ? branch : chosen,
    );
    return depth(best) === 0 ? [{ path, message: issue.message }] : flatten(best, path);
  });
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
    errors: flatten(result.error.issues).map(
      (problem) => `${pathText(problem.path)}: ${problem.message}`,
    ),
  };
}
