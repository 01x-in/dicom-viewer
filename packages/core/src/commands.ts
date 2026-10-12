import { z } from 'zod';
import { isLayout, type LayoutId } from './layouts';
import type { KeyAction } from './keyboard';
import type { Unsubscribe } from './state/events';
import { isPrimaryTool, type PrimaryTool } from './tools';
import type { Viewer } from './viewer-core';

/** What a command is told about: the viewer, and the viewport it acts on. */
export interface CommandContext {
  readonly viewer: Viewer;
  readonly viewportId: string;
}

/** A named thing the viewer can do, so a config, a toolbar button, or a key can refer to it by name. */
export interface Command {
  run(context: CommandContext, args: unknown): void | Promise<void>;
  /** For a button that shows whether something is on. */
  pressed?(context: CommandContext, args: unknown): boolean;
  /** Default: there is a series on screen to act on. */
  enabled?(context: CommandContext, args: unknown): boolean;
  /** Throws a `RangeError` for arguments that do not fit, without running anything. */
  check?(args: unknown): void;
  /** Which key action does the same, so a tooltip can show the key that is bound to it. */
  keyMatcher?(args: unknown): (action: KeyAction) => boolean;
}

/** A command, or only the function that runs it. */
export type CommandInput = Command | Command['run'];

export interface CommandsApi {
  /**
   * Adds a command. The id has a namespace and a name, such as `acme.export`; the built-in ones are
   * `tool`, `view`, `cine`, `layout`, `mpr`, and `preset`. Throws a `RangeError` for an id that is badly formed or
   * taken. Returns what removes it again.
   */
  register(id: string, command: CommandInput): Unsubscribe;
  /** Runs a command on a viewport (default: the active one, `viewer.viewports.active`). Rejects with a `RangeError` for an unknown command or arguments that do not fit. */
  run(id: string, args?: unknown, options?: { readonly viewportId?: string }): Promise<void>;
  has(id: string): boolean;
  /** The ids, in alphabetical order. */
  list(): readonly string[];
  /** A message for an unknown command or arguments that do not fit, or `undefined` when both are fine. Runs nothing. */
  check(id: string, args?: unknown): string | undefined;
  /** Whether a command is on: `undefined` for a command that cannot say, or one that is not there. */
  pressed(
    id: string,
    args?: unknown,
    options?: { readonly viewportId?: string },
  ): boolean | undefined;
  /** Whether a command can run now. `false` for a command that is not there. */
  enabled(id: string, args?: unknown, options?: { readonly viewportId?: string }): boolean;
  /** Which key actions the command stands for, or `undefined` when it has none. */
  keyMatcher(id: string, args?: unknown): ((action: KeyAction) => boolean) | undefined;
}

export const ZOOM_IN_FACTOR = 1.25;
export const ZOOM_OUT_FACTOR = 0.8;

const COMMAND_ID = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;

/** The first problem of a Zod parse, as a sentence. */
function problem(error: z.ZodError): string {
  const [first] = error.issues;
  if (first === undefined) return 'The arguments do not fit.';
  const where = first.path.length === 0 ? '' : `${first.path.map(String).join('.')}: `;
  return `${where}${first.message}`;
}

function parse<T>(schema: z.ZodType<T>, id: string, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success)
    throw new RangeError(`The command ${id} does not take that: ${problem(result.error)}`);
  return result.data;
}

const toolArgs: z.ZodType<{ readonly tool: PrimaryTool }> = z.strictObject({
  tool: z.custom<PrimaryTool>((value) => isPrimaryTool(value), 'There is no such tool.'),
});
const presetArgs: z.ZodType<{ readonly id: string }> = z.strictObject({ id: z.string().min(1) });
const layoutArgs: z.ZodType<{ readonly layout: LayoutId }> = z.strictObject({
  layout: z.custom<LayoutId>((value) => isLayout(value), 'There is no such layout.'),
});
const noArgs: z.ZodType<undefined> = z.undefined();

const hasSeries = ({ viewer, viewportId }: CommandContext): boolean =>
  viewer.viewports.get(viewportId)?.series !== undefined;

/** The commands every viewer has. They use only the public API of the viewer. */
function builtins(): Readonly<Record<string, Command>> {
  const viewportOf = ({
    viewer,
    viewportId,
  }: CommandContext): ReturnType<Viewer['viewports']['get']> => viewer.viewports.get(viewportId);
  return {
    'tool.set': {
      run: ({ viewer }, args) => viewer.tools.setActive(parse(toolArgs, 'tool.set', args).tool),
      pressed: ({ viewer }, args) =>
        viewer.tools.getActive() === parse(toolArgs, 'tool.set', args).tool,
      // Choosing a tool needs no series, so it works before one is shown.
      enabled: () => true,
      check: (args) => {
        parse(toolArgs, 'tool.set', args);
      },
      keyMatcher: (args) => {
        const { tool } = parse(toolArgs, 'tool.set', args);
        return (action) => action.type === 'tool' && action.tool === tool;
      },
    },
    'view.zoomIn': {
      run: (context) => viewportOf(context)?.zoomBy(ZOOM_IN_FACTOR),
      check: (args) => {
        parse(noArgs, 'view.zoomIn', args);
      },
      keyMatcher: () => (action) => action.type === 'zoom' && action.factor > 1,
    },
    'view.zoomOut': {
      run: (context) => viewportOf(context)?.zoomBy(ZOOM_OUT_FACTOR),
      check: (args) => {
        parse(noArgs, 'view.zoomOut', args);
      },
      keyMatcher: () => (action) => action.type === 'zoom' && action.factor < 1,
    },
    'view.invert': {
      run: (context) => viewportOf(context)?.toggleInvert(),
      pressed: ({ viewer, viewportId }) =>
        viewer.getState().viewports.find((viewport) => viewport.id === viewportId)?.invert === true,
      check: (args) => {
        parse(noArgs, 'view.invert', args);
      },
      keyMatcher: () => (action) => action.type === 'invert',
    },
    'view.reset': {
      run: (context) => viewportOf(context)?.resetView(),
      check: (args) => {
        parse(noArgs, 'view.reset', args);
      },
      keyMatcher: () => (action) => action.type === 'reset',
    },
    'cine.toggle': {
      // One call that decides in the queue's order, so two quick toggles cancel each other.
      run: (context) => viewportOf(context)?.cine.toggle(),
      pressed: (context) => viewportOf(context)?.cine.playing === true,
      check: (args) => {
        parse(noArgs, 'cine.toggle', args);
      },
      keyMatcher: () => (action) => action.type === 'cine',
    },
    'layout.set': {
      run: ({ viewer }, args) => viewer.setLayout(parse(layoutArgs, 'layout.set', args).layout),
      pressed: ({ viewer }, args) =>
        viewer.getState().layout === parse(layoutArgs, 'layout.set', args).layout,
      // Changing the layout needs no series.
      enabled: () => true,
      check: (args) => {
        parse(layoutArgs, 'layout.set', args);
      },
    },
    'mpr.show': {
      run: ({ viewer }) => viewer.showMpr(),
      pressed: ({ viewer }) => {
        const { layout, viewports } = viewer.getState();
        return (
          layout === '2x2' &&
          ['axial', 'sagittal', 'coronal'].every(
            (orientation, at) => viewports[at]?.orientation === orientation,
          )
        );
      },
      check: (args) => {
        parse(noArgs, 'mpr.show', args);
      },
    },
    'preset.apply': {
      run: (context, args) =>
        viewportOf(context)?.applyWindowPreset(parse(presetArgs, 'preset.apply', args).id),
      check: (args) => {
        parse(presetArgs, 'preset.apply', args);
      },
      keyMatcher: (args) => {
        const { id } = parse(presetArgs, 'preset.apply', args);
        return (action) => action.type === 'preset' && action.id === id;
      },
    },
  };
}

function asCommand(input: CommandInput): Command {
  return typeof input === 'function' ? { run: input } : input;
}

/** The commands of one viewer. `viewer()` is asked each time, because the registry is made before the viewer is. */
export function createCommands(viewer: () => Viewer): CommandsApi {
  const commands = new Map<string, Command>(Object.entries(builtins()));
  const contextOf = (options?: { readonly viewportId?: string }): CommandContext => ({
    viewer: viewer(),
    viewportId: options?.viewportId ?? viewer().viewports.active,
  });
  return {
    register(id, input): Unsubscribe {
      if (typeof id !== 'string' || !COMMAND_ID.test(id)) {
        throw new RangeError(
          `A command id has a namespace and a name, such as "acme.export", not "${id}".`,
        );
      }
      if (commands.has(id)) throw new RangeError(`There is already a command ${id}.`);
      const added = asCommand(input);
      commands.set(id, added);
      return (): void => {
        if (commands.get(id) === added) commands.delete(id);
      };
    },
    async run(id, args, options): Promise<void> {
      const command = commands.get(id);
      if (command === undefined) throw new RangeError(`There is no command "${id}".`);
      command.check?.(args);
      await command.run(contextOf(options), args);
    },
    has: (id) => commands.has(id),
    list: () => [...commands.keys()].sort(),
    check(id, args): string | undefined {
      const command = commands.get(id);
      if (command === undefined) return `There is no command "${id}".`;
      try {
        command.check?.(args);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    pressed: (id, args, options) => commands.get(id)?.pressed?.(contextOf(options), args),
    enabled(id, args, options): boolean {
      const command = commands.get(id);
      if (command === undefined) return false;
      const context = contextOf(options);
      return command.enabled === undefined ? hasSeries(context) : command.enabled(context, args);
    },
    keyMatcher: (id, args) => commands.get(id)?.keyMatcher?.(args),
  };
}
