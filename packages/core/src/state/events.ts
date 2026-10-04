export type Unsubscribe = () => void;

export interface Emitter<Events extends object> {
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
  /** Removes every handler, for `destroy()`. */
  clear(): void;
}

/**
 * A typed event emitter. A handler that throws must not stop the others, and must not turn the
 * code that emitted into the one that fails, so its error is rethrown from a microtask where it
 * surfaces as an uncaught error.
 */
export function createEmitter<Events extends object>(): Emitter<Events> {
  const handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  return {
    on(event, handler): Unsubscribe {
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      // Each subscription is its own entry, even for the same function.
      const entry = (payload: never): void => {
        handler(payload);
      };
      set.add(entry);
      return (): void => {
        set.delete(entry);
      };
    },
    emit(event, payload): void {
      // Iterate a copy: handlers may unsubscribe or subscribe while this runs.
      for (const entry of [...(handlers.get(event) ?? [])]) {
        try {
          entry(payload as never);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    },
    clear(): void {
      handlers.clear();
    },
  };
}
