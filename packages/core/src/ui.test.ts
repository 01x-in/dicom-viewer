import { describe, expect, it, vi } from 'vitest';
import { createUiRegistry, type PanelDefinition, type PanelPlacement } from './ui';

// A host that passes strings can name a side that does not exist.
const asPlacement = (name: string): PanelPlacement => name as PanelPlacement;

const panel = (overrides: Partial<PanelDefinition> = {}): PanelDefinition => ({
  id: 'notes',
  title: 'Notes',
  placement: 'right',
  mount: () => undefined,
  ...overrides,
});

describe('the panel registry', () => {
  it('lists panels in the order they were registered', () => {
    const { api } = createUiRegistry(() => undefined);
    api.registerPanel(panel({ id: 'b' }));
    api.registerPanel(panel({ id: 'a' }));
    expect(api.panels().map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('announces each registration and removal with the panels that remain', () => {
    const changed = vi.fn<(panels: readonly PanelDefinition[]) => void>();
    const { api } = createUiRegistry(changed);
    const remove = api.registerPanel(panel({ id: 'a' }));
    api.registerPanel(panel({ id: 'b' }));
    remove();
    expect(changed.mock.calls.map(([panels]) => panels.map((item) => item.id))).toEqual([
      ['a'],
      ['a', 'b'],
      ['b'],
    ]);
  });

  it('removes a panel once, and only that registration', () => {
    const changed = vi.fn<(panels: readonly PanelDefinition[]) => void>();
    const { api } = createUiRegistry(changed);
    const remove = api.registerPanel(panel());
    remove();
    changed.mockClear();
    remove();
    // The id is free again: a new panel under it must survive the old remover being called.
    api.registerPanel(panel());
    changed.mockClear();
    remove();
    expect(changed).not.toHaveBeenCalled();
    expect(api.panels()).toHaveLength(1);
  });

  it.each(['', 'Notes', '1notes', 'my_notes', 'a--b', '-a', 'a-'])('refuses the id "%s"', (id) => {
    const { api } = createUiRegistry(() => undefined);
    expect(() => api.registerPanel(panel({ id }))).toThrow(RangeError);
  });

  it('refuses a duplicate id, a blank title, an unknown side, and a missing mount', () => {
    const { api } = createUiRegistry(() => undefined);
    api.registerPanel(panel());
    expect(() => api.registerPanel(panel())).toThrow(/already a panel notes/);
    expect(() => api.registerPanel(panel({ id: 'b', title: '  ' }))).toThrow(RangeError);
    // A JavaScript host can pass anything.
    expect(() => api.registerPanel(panel({ id: 'c', placement: asPlacement('top') }))).toThrow(
      RangeError,
    );
    expect(() => api.registerPanel({ ...panel({ id: 'd' }), mount: undefined as never })).toThrow(
      TypeError,
    );
  });

  it('empties when cleared, without announcing', () => {
    const changed = vi.fn<(panels: readonly PanelDefinition[]) => void>();
    const registry = createUiRegistry(changed);
    registry.api.registerPanel(panel());
    changed.mockClear();
    registry.clear();
    expect(registry.api.panels()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });
});
