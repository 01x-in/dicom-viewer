// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ViewerEnvironmentError,
  assertBrowserEnvironment,
  isBrowserEnvironment,
} from './environment';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isBrowserEnvironment', () => {
  it('is false on a server, where window and document are missing', () => {
    expect(isBrowserEnvironment()).toBe(false);
  });

  it('is true when window and document exist', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(isBrowserEnvironment()).toBe(true);
  });

  it('is false when only window exists', () => {
    vi.stubGlobal('window', {});
    expect(isBrowserEnvironment()).toBe(false);
  });
});

describe('assertBrowserEnvironment', () => {
  it('throws a ViewerEnvironmentError naming the caller on a server', () => {
    expect(() => {
      assertBrowserEnvironment('createViewer');
    }).toThrow(ViewerEnvironmentError);
    expect(() => {
      assertBrowserEnvironment('createViewer');
    }).toThrow(/createViewer can only run in a browser/);
  });

  it('does not throw in a browser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => {
      assertBrowserEnvironment('createViewer');
    }).not.toThrow();
  });
});
