import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmitter } from './events';

interface Events {
  ping: { n: number };
  done: undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEmitter', () => {
  it('delivers a payload to every handler of that event only', () => {
    const emitter = createEmitter<Events>();
    const ping = vi.fn();
    const other = vi.fn();
    emitter.on('ping', ping);
    emitter.on('done', other);
    emitter.emit('ping', { n: 1 });
    expect(ping).toHaveBeenCalledWith({ n: 1 });
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering after the returned unsubscribe, which is safe to call twice', () => {
    const emitter = createEmitter<Events>();
    const handler = vi.fn();
    const off = emitter.on('ping', handler);
    off();
    off();
    emitter.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls a handler once per subscription, in subscription order', () => {
    const emitter = createEmitter<Events>();
    const calls: string[] = [];
    emitter.on('ping', () => calls.push('first'));
    emitter.on('ping', () => calls.push('second'));
    emitter.emit('ping', { n: 1 });
    expect(calls).toEqual(['first', 'second']);
  });

  it('lets a handler unsubscribe itself, or add another, without disturbing this emit', () => {
    const emitter = createEmitter<Events>();
    const calls: string[] = [];
    const off = emitter.on('ping', () => {
      calls.push('once');
      off();
      emitter.on('ping', () => calls.push('late'));
    });
    emitter.on('ping', () => calls.push('other'));
    emitter.emit('ping', { n: 1 });
    expect(calls).toEqual(['once', 'other']);
    emitter.emit('ping', { n: 2 });
    expect(calls).toEqual(['once', 'other', 'other', 'late']);
  });

  it('keeps delivering when a handler throws, and surfaces the error asynchronously', () => {
    const emitter = createEmitter<Events>();
    const after = vi.fn();
    const surfaced: unknown[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      try {
        callback();
      } catch (error) {
        surfaced.push(error);
      }
    });
    emitter.on('ping', () => {
      throw new Error('handler failed');
    });
    emitter.on('ping', after);

    emitter.emit('ping', { n: 1 });

    expect(after).toHaveBeenCalledOnce();
    expect(surfaced).toHaveLength(1);
    expect((surfaced[0] as Error).message).toBe('handler failed');
  });

  it('clear() removes every handler', () => {
    const emitter = createEmitter<Events>();
    const handler = vi.fn();
    emitter.on('ping', handler);
    emitter.clear();
    emitter.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });
});
