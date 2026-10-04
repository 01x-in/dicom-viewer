import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

interface State {
  readonly count: number;
  readonly label: string;
}

const initial: State = { count: 0, label: 'a' };

describe('createStore', () => {
  it('starts with the initial state', () => {
    expect(createStore(initial).getState()).toBe(initial);
  });

  it('applies a patch to a copy and reports the origin', () => {
    const store = createStore(initial);
    const onChange = vi.fn();
    store.onChange(onChange);

    store.update({ count: 1 }, 'api');

    expect(store.getState()).toEqual({ count: 1, label: 'a' });
    expect(initial.count).toBe(0);
    expect(onChange).toHaveBeenCalledWith({ count: 1, label: 'a' }, initial, 'api');
  });

  it('accepts a function of the current state', () => {
    const store = createStore(initial);
    store.update((state) => ({ count: state.count + 1 }), 'user');
    store.update((state) => ({ count: state.count + 1 }), 'user');
    expect(store.getState().count).toBe(2);
  });

  it('does not notify when nothing changed', () => {
    const store = createStore(initial);
    const onChange = vi.fn();
    const selected = vi.fn();
    store.onChange(onChange);
    store.subscribe((state) => state.count, selected);
    store.update({ count: 0, label: 'a' }, 'api');
    store.update({}, 'api');
    expect(onChange).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    expect(store.getState()).toBe(initial);
  });

  it('tells a selector subscriber only when its slice changed', () => {
    const store = createStore(initial);
    const onCount = vi.fn();
    store.subscribe((state) => state.count, onCount);

    store.update({ label: 'b' }, 'api');
    expect(onCount).not.toHaveBeenCalled();

    store.update({ count: 5 }, 'api');
    expect(onCount).toHaveBeenCalledExactlyOnceWith(5, 0);
  });

  it('compares selected values with a custom equality', () => {
    const store = createStore(initial);
    const listener = vi.fn();
    store.subscribe((state) => ({ parity: state.count % 2 }), listener, {
      equals: (a, b) => a.parity === b.parity,
    });
    store.update({ count: 2 }, 'api');
    expect(listener).not.toHaveBeenCalled();
    store.update({ count: 3 }, 'api');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('can call the listener straight away with the current value', () => {
    const store = createStore({ count: 7, label: 'x' });
    const listener = vi.fn();
    store.subscribe((state) => state.count, listener, { fireImmediately: true });
    expect(listener).toHaveBeenCalledExactlyOnceWith(7, 7);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(initial);
    const listener = vi.fn();
    const off = store.subscribe((state) => state.count, listener);
    off();
    store.update({ count: 1 }, 'api');
    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers nested updates in order, each with its own previous state', () => {
    const store = createStore(initial);
    const seen: [number, number][] = [];
    store.onChange((state, previous) => {
      seen.push([previous.count, state.count]);
      if (state.count === 1) store.update({ count: 2 }, 'api');
    });
    store.update({ count: 1 }, 'api');
    expect(seen).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});
