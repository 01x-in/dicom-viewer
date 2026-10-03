/** Thrown when browser-only code (Cornerstone, WebGL, workers) is called on a server. */
export class ViewerEnvironmentError extends Error {
  override readonly name = 'ViewerEnvironmentError';
}

/** True when both `window` and `document` exist, so WebGL and workers can be used. */
export function isBrowserEnvironment(): boolean {
  return typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined';
}

/**
 * Fails fast with a clear message when a browser-only API runs during SSR
 * (Next.js, Nuxt), instead of an obscure `window is not defined` from deep in a dependency.
 */
export function assertBrowserEnvironment(caller: string): void {
  if (!isBrowserEnvironment()) {
    throw new ViewerEnvironmentError(
      `${caller} can only run in a browser. In Next.js, render the viewer from a client component; in Nuxt, wrap it in <ClientOnly>.`,
    );
  }
}
