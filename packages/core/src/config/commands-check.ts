import type { ToolbarItemConfig } from './types';

/**
 * The problems of the commands a toolbar names, each with its path: a command that is not there,
 * or arguments it will not take. `check` is `viewer.commands.check`.
 */
export function findCommandProblems(
  items: readonly ToolbarItemConfig[],
  check: (id: string, args?: unknown) => string | undefined,
): string[] {
  const problems: string[] = [];
  items.forEach((item, index) => {
    if (item.type === 'command') {
      const problem = check(item.command, item.args);
      if (problem !== undefined)
        problems.push(`toolbar.items.${index.toString()}.command: ${problem}`);
    } else if (item.type === 'menu') {
      item.items.forEach((entry, at) => {
        const problem = check(entry.command, entry.args);
        if (problem !== undefined) {
          problems.push(
            `toolbar.items.${index.toString()}.items.${at.toString()}.command: ${problem}`,
          );
        }
      });
    }
  });
  return problems;
}
