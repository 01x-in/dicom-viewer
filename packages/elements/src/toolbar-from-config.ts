import type {
  KeyAction,
  ToolbarItemConfig,
  ToolbarMenuEntryConfig,
  Viewer,
} from '@01x/dicom-viewer-core';
import { type IconName, isIconName } from './icons';
import type { MenuEntry, ToolbarContext, ToolbarItem } from './toolbar-config';

/** `icon` only when the shell has a picture of that name: any other name is a button with text. */
const iconOf = (name: string | undefined): { readonly icon?: IconName } =>
  name !== undefined && isIconName(name) ? { icon: name } : {};

/** The key action a command stands for, or `undefined` when it has none or the arguments do not fit. */
function matcherOf(
  viewer: Viewer,
  command: string,
  args: unknown,
): ((action: KeyAction) => boolean) | undefined {
  try {
    return viewer.commands.keyMatcher(command, args);
  } catch {
    return undefined;
  }
}

function entryOf(entry: ToolbarMenuEntryConfig, viewer: Viewer): MenuEntry {
  const { command, args } = entry;
  const matcher = matcherOf(viewer, command, args);
  return {
    id: entry.id,
    label: entry.label,
    ...iconOf(entry.icon),
    ...(matcher === undefined ? {} : { shortcut: matcher }),
    run: ({ viewer: current, viewportId }: ToolbarContext) =>
      current.commands.run(command, args, { viewportId }),
    // A command that cannot say whether it is on is a plain entry, not one choice among several.
    ...(viewer.commands.pressed(command, args) === undefined
      ? {}
      : {
          pressed: ({ viewer: current, viewportId }: ToolbarContext) =>
            current.commands.pressed(command, args, { viewportId }) === true,
        }),
    enabled: ({ viewer: current, viewportId }: ToolbarContext) =>
      current.commands.enabled(command, args, { viewportId }),
  };
}

/**
 * The buttons a config describes, as the items the toolbar draws. A button runs its command through
 * `viewer.commands`, and asks the same command whether it is on and whether it can run. The config
 * was checked when it was read, so every command in it exists.
 */
export function toolbarFromConfig(
  items: readonly ToolbarItemConfig[],
  viewer: Viewer,
): readonly ToolbarItem[] {
  return items.map((item): ToolbarItem => {
    switch (item.type) {
      case 'separator':
        return { type: 'separator' };
      case 'tool':
        return {
          type: 'tool',
          tool: item.tool,
          ...(item.label === undefined ? {} : { label: item.label }),
          ...iconOf(item.icon),
        };
      case 'command': {
        const { command, args } = item;
        const matcher = matcherOf(viewer, command, args);
        const pressedNow = ({ viewer: current, viewportId }: ToolbarContext): boolean | undefined =>
          current.commands.pressed(command, args, { viewportId });
        return {
          type: 'action',
          id: item.id,
          label: item.label,
          ...iconOf(item.icon),
          ...(matcher === undefined ? {} : { shortcut: matcher }),
          run: ({ viewer: current, viewportId }) =>
            current.commands.run(command, args, { viewportId }),
          // `undefined` for a command that cannot say: a button that is never "on".
          ...(viewer.commands.pressed(command, args) === undefined
            ? {}
            : { pressed: (context: ToolbarContext) => pressedNow(context) === true }),
          enabled: ({ viewer: current, viewportId }) =>
            current.commands.enabled(command, args, { viewportId }),
        };
      }
      case 'menu':
        return {
          type: 'menu',
          id: item.id,
          label: item.label,
          ...iconOf(item.icon),
          items: item.items.map((entry) => entryOf(entry, viewer)),
        };
    }
  });
}
