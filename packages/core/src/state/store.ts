import type { Unsubscribe } from './events';

/** Who made a change: `init` the initial state, `api` a call by the host, `user` input in the viewer, `url` a restored link. */
export type StateOrigin = 'init' | 'api' | 'user' | 'url';

export interface SubscribeOptions<T> {
  /** Defaults to `Object.is`. */
  readonly equals?: (a: T, b: T) => boolean;
  /** Also call the listener once now, with the current value as both arguments. */
  readonly fireImmediately?: boolean;
}

export interface Store<S extends object> {
  getState(): S;
  /** Merges a patch (or the result of a function of the current state) into a copy of the state. */
  update(patch: Partial<S> | ((current: S) => Partial<S>), origin: StateOrigin): void;
  /** Every change, with the state before it. */
  onChange(listener: (state: S, previous: S, origin: StateOrigin) => void): Unsubscribe;
  /** Changes to one slice of the state. */
  subscribe<T>(
    selector: (state: S) => T,
    listener: (value: T, previous: T) => void,
    options?: SubscribeOptions<T>,
  ): Unsubscribe;
}

interface Change<S> {
  readonly state: S;
  readonly previous: S;
  readonly origin: StateOrigin;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(change: Change<S>) => void>();
  // A listener may update the store. Changes are delivered in order, one at a time, so every
  // listener sees each state and its true predecessor.
  const queue: Change<S>[] = [];
  let delivering = false;

  function deliver(): void {
    if (delivering) return;
    delivering = true;
    try {
      for (let change = queue.shift(); change !== undefined; change = queue.shift()) {
        for (const listener of [...listeners]) listener(change);
      }
    } finally {
      delivering = false;
    }
  }

  function hasChanged(next: S): boolean {
    return (Object.keys(next) as (keyof S)[]).some((key) => !Object.is(next[key], state[key]));
  }

  return {
    getState: () => state,
    update(patch, origin): void {
      const next = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      if (!hasChanged(next)) return;
      const previous = state;
      state = next;
      queue.push({ state, previous, origin });
      deliver();
    },
    onChange(listener): Unsubscribe {
      const entry = (change: Change<S>): void => {
        listener(change.state, change.previous, change.origin);
      };
      listeners.add(entry);
      return (): void => {
        listeners.delete(entry);
      };
    },
    subscribe<T>(
      selector: (state: S) => T,
      listener: (value: T, previous: T) => void,
      options: SubscribeOptions<T> = {},
    ): Unsubscribe {
      const equals = options.equals ?? Object.is;
      const entry = (change: Change<S>): void => {
        const value = selector(change.state);
        const before = selector(change.previous);
        if (!equals(value, before)) listener(value, before);
      };
      listeners.add(entry);
      if (options.fireImmediately === true) {
        const value = selector(state);
        listener(value, value);
      }
      return (): void => {
        listeners.delete(entry);
      };
    },
  };
}
