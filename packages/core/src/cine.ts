export interface CineOptions {
  /** Slices per second, above 0 and up to 60. Default 10, or the rate it is already playing at. */
  readonly fps?: number;
  /** Start again at the first slice after the last. Default true; false stops at the last. */
  readonly loop?: boolean;
}

export interface CineApi {
  /** Plays from the slice on screen. Playing again changes the rate or the looping. */
  play(options?: CineOptions): Promise<void>;
  /** Does nothing if it is not playing. */
  stop(): void;
  readonly playing: boolean;
  readonly fps: number;
}

export const DEFAULT_CINE_FPS = 10;
export const MAX_CINE_FPS = 60;

export function assertCineFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_CINE_FPS) {
    throw new RangeError(
      `Cine plays between 0 and ${MAX_CINE_FPS.toString()} slices per second, not ${fps.toString()}.`,
    );
  }
}

export interface CineController {
  /** Starts, or changes the rate or looping of what is playing. Throws a `RangeError` for a bad rate. */
  play(options?: CineOptions): void;
  stop(): void;
  readonly playing: boolean;
  readonly fps: number;
}

export interface CineHooks {
  /** Moves one slice on. Resolves false when there is nowhere to go, which ends the playback. */
  step(loop: boolean): Promise<boolean>;
  /** Called when playing starts or stops, or the rate changes. */
  changed(state: { readonly playing: boolean; readonly fps: number }): void;
  /** Called when a step fails. The playback has stopped by then. */
  failed(error: Error): void;
}

/**
 * Plays slices at a steady rate. A step starts only when the one before it has finished, so a slow
 * engine plays slower instead of falling behind, and the delay is shortened by the time the step took.
 */
export function createCine(hooks: CineHooks): CineController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let playing = false;
  let fps = DEFAULT_CINE_FPS;
  let loop = true;
  // Each start and stop makes a new run, so a step that finishes after it was stopped is ignored.
  let run = 0;

  function schedule(delayMs: number, token: number): void {
    timer = setTimeout(() => {
      timer = undefined;
      void tick(token);
    }, delayMs);
  }

  async function tick(token: number): Promise<void> {
    const started = Date.now();
    let more: boolean;
    try {
      more = await hooks.step(loop);
    } catch (error) {
      if (token !== run) return;
      controller.stop();
      hooks.failed(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (token !== run) return;
    if (!more) {
      controller.stop();
      return;
    }
    schedule(Math.max(0, 1000 / fps - (Date.now() - started)), token);
  }

  const controller: CineController = {
    get playing(): boolean {
      return playing;
    },
    get fps(): number {
      return fps;
    },
    play(playOptions = {}): void {
      const nextFps = playOptions.fps ?? fps;
      assertCineFps(nextFps);
      const nextLoop = playOptions.loop ?? loop;
      const unchanged = playing && nextFps === fps && nextLoop === loop;
      if (unchanged) return;
      const wasPlaying = playing;
      const oldFps = fps;
      clearTimeout(timer);
      run += 1;
      fps = nextFps;
      loop = nextLoop;
      playing = true;
      schedule(1000 / fps, run);
      if (!wasPlaying || oldFps !== fps) hooks.changed({ playing, fps });
    },
    stop(): void {
      if (!playing) return;
      clearTimeout(timer);
      timer = undefined;
      run += 1;
      playing = false;
      hooks.changed({ playing, fps });
    },
  };
  return controller;
}
