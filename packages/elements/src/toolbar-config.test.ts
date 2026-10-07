import { describe, expect, it } from 'vitest';
import { isIconName } from './icons';
import { DEFAULT_TOOLBAR, formatChord, TOOL_ICONS } from './toolbar-config';

describe('formatChord', () => {
  it.each([
    ['w', 'W'],
    ['Shift+i', 'Shift+I'],
    ['Plus', '+'],
    ['Space', 'Space'],
    ['ArrowDown', '↓'],
    ['Ctrl+Alt+x', 'Ctrl+Alt+X'],
    ['PageUp', 'PgUp'],
    ['F5', 'F5'],
  ])('prints %s as %s', (chord, printed) => {
    expect(formatChord(chord)).toBe(printed);
  });
});

describe('the pictures of the toolbar', () => {
  it('give every tool a picture that exists', () => {
    for (const icon of Object.values(TOOL_ICONS)) expect(isIconName(icon)).toBe(true);
  });

  it('give every built-in action and menu a picture, so the default bar has no text-only buttons', () => {
    for (const item of DEFAULT_TOOLBAR) {
      if (item.type === 'action' || item.type === 'menu') {
        expect(item.icon, item.id).toBeDefined();
        expect(isIconName(item.icon)).toBe(true);
      }
    }
  });
});
