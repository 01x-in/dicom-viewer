import { describe, expect, it } from 'vitest';
import { findCommandProblems } from './commands-check';
import type { ToolbarItemConfig } from './types';

const check = (id: string, args?: unknown): string | undefined => {
  if (id === 'tool.set')
    return (args as { tool?: string } | undefined)?.tool === 'pan'
      ? undefined
      : 'tool: There is no such tool.';
  return id === 'view.reset' ? undefined : `There is no command "${id}".`;
};

describe('findCommandProblems', () => {
  it('is empty when every command exists and takes its arguments', () => {
    const items: ToolbarItemConfig[] = [
      { type: 'tool', tool: 'pan' },
      { type: 'command', id: 'reset', label: 'Reset', command: 'view.reset' },
      {
        type: 'menu',
        id: 'tools',
        label: 'Tools',
        items: [{ id: 'pan', label: 'Pan', command: 'tool.set', args: { tool: 'pan' } }],
      },
      { type: 'separator' },
    ];
    expect(findCommandProblems(items, check)).toEqual([]);
  });

  it('names the path of a command that does not exist, and of arguments that do not fit', () => {
    const items: ToolbarItemConfig[] = [
      { type: 'separator' },
      { type: 'command', id: 'a', label: 'A', command: 'acme.missing' },
      {
        type: 'menu',
        id: 'tools',
        label: 'Tools',
        items: [
          { id: 'ok', label: 'Ok', command: 'view.reset' },
          { id: 'bad', label: 'Bad', command: 'tool.set', args: { tool: 'laser' } },
        ],
      },
    ];
    expect(findCommandProblems(items, check)).toEqual([
      'toolbar.items.1.command: There is no command "acme.missing".',
      'toolbar.items.2.items.1.command: tool: There is no such tool.',
    ]);
  });
});
