/** What the engine is holding on to. For tests and for hosts that watch memory; not a stable contract. */
export interface EngineDiagnostics {
  /** Cornerstone rendering engines alive (one per viewer). */
  readonly renderingEngines: number;
  /** Viewports alive across all rendering engines. */
  readonly viewports: number;
  /** Bytes of decoded images in Cornerstone's cache. */
  readonly cacheBytes: number;
  /** Decode and compute worker threads alive. */
  readonly workers: number;
  /** Viewers (engines) that have not been destroyed. */
  readonly activeEngines: number;
  /** Image ids that live stacks still use (and whose cache entry and metadata are therefore kept). */
  readonly imagesInUse: number;
  /** Volumes (the data behind reformatted planes) in the cache. */
  readonly volumes: number;
  /** Measurement shapes Cornerstone holds, which are the ones drawn on stacks that are alive. */
  readonly annotations: number;
  /** SEG labelmap layers Cornerstone holds as segmentations, which are the ones of SEGs that are loaded. */
  readonly segmentations: number;
}

let provider: (() => EngineDiagnostics) | undefined;

/** The engine chunk calls this when it loads. */
export function provideEngineDiagnostics(next: () => EngineDiagnostics): void {
  provider = next;
}

/** `undefined` until the engine has been loaded, which only happens in a browser. */
export function getEngineDiagnostics(): EngineDiagnostics | undefined {
  return provider?.();
}
