# ADR 0005: The engine runtime is shared, and released with the last viewer

Status: accepted (M2). Replaces the M1 spike behaviour, where the first viewer's settings won and nothing was ever released.

## Context

Cornerstone's loader, worker pool, image cache, and metadata store are process-wide. Several viewers can exist on one page, one after another (route changes, StrictMode) or briefly together. M2's done criterion is that 20 mount/unmount cycles leak nothing.

The first measurement of the spike, 5 cycles in Chromium, found:
- 5 worker threads still alive after the last viewer, and 32 KB of decoded images still cached;
- about 8 WebGL contexts created per viewer, so Chromium logged "Too many active WebGL contexts" five times within five cycles (it keeps about 16 and drops the oldest).

## Decision

[runtime.ts](../../packages/core/src/engine/runtime.ts) counts viewers (`acquireRuntime`, `releaseRuntime`).

- **Kept for the life of the page**, because it is small and fixed: Cornerstone's registrations and event listeners, the tool classes, and the worker factories (in `inline` mode two Blob URLs).
- **Released when the last viewer is destroyed:** decode and compute worker threads are terminated, requests still queued in the loading pools are dropped, and the decoded image cache is purged.
- **Per stack,** when a viewport stops showing a series: its tool group and viewport are removed, and each image leaves the cache and the metadata store once no live stack uses it (reference counted by image id, because two viewers may show one series).
- **Settings may change while no viewer runs:** a viewer with other asset or rendering settings is refused while another is running, and accepted otherwise (the workers are re-registered with `overwrite`, and the old Blob URLs revoked).
- **One WebGL context** (`webGlContextCount: 1`) instead of Cornerstone's default pool of 7. v1 has one viewer per page and at most four viewports, which one context serves. Raising it is a measured decision for M7's MPR, not a default.
- `getEngineDiagnostics()` reports what the engine still holds (rendering engines, viewports, cache bytes, workers, live viewers, images in use) so tests and hosts can check.

## Consequences

- **A viewer destroyed and recreated at once pays for new workers.** Terminating on the last release means StrictMode's double mount starts the pool twice. Worker threads are created on first use, so this is a start-up cost and not a leak; a short grace period before releasing is the fix if profiling ever shows it matters.
- **The check is in CI.** `pnpm matrix` runs 20 cycles in the headless example, both asset modes, and fails if any cycle leaves engines, viewports, cache, or workers behind, if worker threads outlive the page's viewers, if DOM nodes or listeners grow, if the heap grows by more than 30 MB, or if the browser warns about WebGL contexts. The numbers it saw are in [m2-report.md](../m2-report.md).
- **Not covered:** a leak that needs real GPU memory pressure (SwiftShader only), and Safari and Firefox.
- Cornerstone creates two probe WebGL contexts when it first builds a rendering engine. They are collected by the browser; we cannot release them from outside.
