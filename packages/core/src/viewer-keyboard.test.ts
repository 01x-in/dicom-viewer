// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CT, STUDY } from './testing/fakes';
import { destroyViewersAfterEach, harness, vp0, type Harness } from './testing/harness';

destroyViewersAfterEach();

async function show(h: Harness, imageIndex = 5): Promise<void> {
  h.viewer.viewports.attach('vp-0', h.element);
  document.body.append(h.element);
  await h.viewer.loadStudy(STUDY);
  await h.viewer.setViewportSeries('vp-0', CT, { imageIndex });
}

/** Presses a key on the element and lets the call it starts finish. */
async function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  await vi.advanceTimersByTimeAsync(0);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('keyboard shortcuts', () => {
  it('scroll, and say they handled the key', async () => {
    const h = harness();
    await show(h);

    const down = await press(h.element, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(vp0(h.viewer)?.imageIndex).toBe(6);

    await press(h.element, 'ArrowUp');
    await press(h.element, 'ArrowUp');
    expect(vp0(h.viewer)?.imageIndex).toBe(4);
    await press(h.element, 'End');
    expect(vp0(h.viewer)?.imageIndex).toBe(9);
    await press(h.element, 'Home');
    expect(vp0(h.viewer)?.imageIndex).toBe(0);
    await press(h.element, 'PageDown');
    expect(vp0(h.viewer)?.imageIndex).toBe(9);
  });

  it('invert, reset, and zoom', async () => {
    const h = harness();
    await show(h);
    const api = h.viewer.viewports.get('vp-0');

    await press(h.element, 'i');
    expect(api?.getView()?.invert).toBe(true);
    await press(h.element, '+', { shiftKey: true });
    await press(h.element, '=');
    expect(api?.getView()?.zoom).toBeCloseTo(1.5625);
    await press(h.element, '-');
    expect(api?.getView()?.zoom).toBeCloseTo(1.25);
    await press(h.element, 'r');
    expect(api?.getView()).toMatchObject({ invert: false, zoom: 1 });
  });

  it('apply the window presets on the digits, and ignore a digit without a preset', async () => {
    const h = harness();
    await show(h);
    await press(h.element, '1');
    expect(vp0(h.viewer)?.window).toEqual({ center: -600, width: 1500 });
    await press(h.element, '4');
    expect(vp0(h.viewer)?.window).toEqual({ center: 40, width: 80 });
    const nine = await press(h.element, '9');
    expect(nine.defaultPrevented).toBe(false);
  });

  it('pick the tool for the left button', async () => {
    const h = harness();
    await show(h);
    await press(h.element, 'p');
    expect(h.viewer.tools.getActive()).toBe('pan');
    await press(h.element, 'z');
    expect(h.viewer.tools.getActive()).toBe('zoom');
    await press(h.element, 'w');
    expect(h.viewer.tools.getActive()).toBe('window-level');
  });

  it('start and stop cine with the space bar', async () => {
    const h = harness();
    await show(h, 0);
    const api = h.viewer.viewports.get('vp-0');
    await press(h.element, ' ');
    expect(api?.cine.playing).toBe(true);
    await press(h.element, ' ');
    expect(api?.cine.playing).toBe(false);
  });

  it('do not repeat a toggle while the key is held down, but do repeat scrolling', async () => {
    const h = harness();
    await show(h);
    await press(h.element, 'i');
    await press(h.element, 'i', { repeat: true });
    await press(h.element, 'i', { repeat: true });
    expect(h.viewer.viewports.get('vp-0')?.getView()?.invert).toBe(true);

    await press(h.element, 'ArrowDown', { repeat: true });
    await press(h.element, 'ArrowDown', { repeat: true });
    expect(vp0(h.viewer)?.imageIndex).toBe(7);
  });

  it('leave keys alone that are not bound, or are held with a modifier that is not part of the binding', async () => {
    const h = harness();
    await show(h);
    const reload = await press(h.element, 'r', { ctrlKey: true });
    const tab = await press(h.element, 'Tab');
    const unknown = await press(h.element, 'q');
    expect(reload.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
    expect(unknown.defaultPrevented).toBe(false);
    expect(h.viewer.viewports.get('vp-0')?.getView()?.invert).toBe(false);
  });

  it('are not taken from a text field inside the viewport element', async () => {
    const h = harness();
    await show(h);
    const input = document.createElement('input');
    h.element.append(input);
    const event = await press(input, 'i');
    expect(event.defaultPrevented).toBe(false);
    expect(h.viewer.viewports.get('vp-0')?.getView()?.invert).toBe(false);
  });

  it('are not taken after another handler used the key', async () => {
    const h = harness();
    await show(h);
    h.element.addEventListener(
      'keydown',
      (event) => {
        event.preventDefault();
      },
      { capture: true },
    );
    await press(h.element, 'i');
    expect(h.viewer.viewports.get('vp-0')?.getView()?.invert).toBe(false);
  });

  it('do nothing, and do not swallow the key, while no series is shown', async () => {
    const h = harness();
    h.viewer.viewports.attach('vp-0', h.element);
    const event = await press(h.element, 'ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    expect(h.events.error).toEqual([]);
  });

  it('report a failure through the error event, not as an unhandled rejection', async () => {
    const h = harness();
    await show(h);
    const stack = h.port.stacks[0];
    if (stack === undefined) throw new Error('no stack');
    vi.spyOn(stack, 'setImageIndex').mockRejectedValue(new Error('lost context'));
    await press(h.element, 'ArrowDown');
    expect(h.events.error).toHaveLength(1);
    expect(h.events.error[0]).toMatchObject({ context: 'keyboard' });
  });
});

describe('the focus a viewport needs for the keyboard', () => {
  it('is made possible, and given on a pointer press', async () => {
    const h = harness();
    await show(h);
    expect(h.element.getAttribute('tabindex')).toBe('0');
    h.element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.activeElement).toBe(h.element);
  });

  it('leaves a tabindex the host chose alone, and removes only the one it added', async () => {
    const h = harness();
    h.element.setAttribute('tabindex', '-1');
    await show(h);
    expect(h.element.getAttribute('tabindex')).toBe('-1');

    const other = harness();
    await show(other);
    other.viewer.viewports.detach('vp-0');
    expect(other.element.hasAttribute('tabindex')).toBe(false);
  });
});

describe('keybindings', () => {
  it('can be added to, changed, and removed from', async () => {
    const h = harness({
      viewer: {
        keybindings: {
          x: { type: 'invert' },
          ArrowDown: { type: 'scroll', by: 3 },
          i: null,
        },
      },
    });
    await show(h);
    await press(h.element, 'x');
    expect(h.viewer.viewports.get('vp-0')?.getView()?.invert).toBe(true);
    await press(h.element, 'ArrowDown');
    expect(vp0(h.viewer)?.imageIndex).toBe(8);
    const removed = await press(h.element, 'i');
    expect(removed.defaultPrevented).toBe(false);
  });

  it('can be turned off, which also leaves the element alone', async () => {
    const h = harness({ viewer: { keybindings: false } });
    await show(h);
    const event = await press(h.element, 'ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    expect(h.element.hasAttribute('tabindex')).toBe(false);
  });

  it('are checked when the viewer is made', () => {
    expect(() => harness({ viewer: { keybindings: { 'Ctrl+': { type: 'invert' } } } })).toThrow(
      RangeError,
    );
    expect(() =>
      harness({ viewer: { keybindings: { m: { type: 'preset', id: 'muscle' } } } }),
    ).toThrow(/muscle/);
  });
});

describe('after the viewport is gone', () => {
  it('no key does anything once the element is detached or the viewer destroyed', async () => {
    const h = harness();
    await show(h);
    h.viewer.viewports.detach('vp-0');
    await vi.advanceTimersByTimeAsync(0);
    const detached = await press(h.element, 'ArrowDown');
    expect(detached.defaultPrevented).toBe(false);

    const other = harness();
    await show(other);
    other.viewer.destroy();
    const destroyed = await press(other.element, 'ArrowDown');
    expect(destroyed.defaultPrevented).toBe(false);
  });

  it('a new element gets the listener, and the old one loses it', async () => {
    const h = harness();
    await show(h);
    const second = document.createElement('div');
    document.body.append(second);
    h.viewer.viewports.attach('vp-0', second);
    await vi.advanceTimersByTimeAsync(0);
    expect((await press(h.element, 'ArrowDown')).defaultPrevented).toBe(false);
    expect((await press(second, 'ArrowDown')).defaultPrevented).toBe(true);
  });
});
