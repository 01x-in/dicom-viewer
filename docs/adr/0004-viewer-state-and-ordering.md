# ADR 0004: The state says what to show, and changes apply one at a time

Status: accepted (M2).

## Context

The viewer takes input from four places that race each other: the host's calls (`loadStudy`, `setViewportSeries`, `setState`), a restored link, the user (the mouse wheel moves the slice with no call at all), and the network (a series arrives after the host has asked for another). A React app in StrictMode, or one that changes route quickly, makes this routine: a viewer is destroyed while its first series is still loading, and a new one is attached to the same element.

Three designs were considered:

1. **Imperative calls, no shared state.** Simple, but the host cannot save or restore a view, and nothing says what is on screen.
2. **A declarative state the viewer converges to, applied by whichever call runs first.** Restores links well, but a failure lands on the wrong caller. The first version of this code did this: a failed render was reported to the `attach` that happened to run first, and `setState` resolved as if it had worked.
3. **A serializable state that is changed inside a queue, in call order.** A call is validated against, and applied on top of, the calls before it, and its failure belongs to it.

## Decision

Design 3.

- `ViewerStateV1` (Zod, in [viewer-state.ts](../../packages/core/src/state/viewer-state.ts)) is plain data: study UID, layout, and per viewport the series, stack, and slice. It is what `getState()` returns, what `encodeViewerState` puts in a URL, and what `initialState` takes. Later milestones add fields; readers drop the ones they do not know, and a different `version` is refused.
- Every change goes through one promise queue in [viewer-core.ts](../../packages/core/src/viewer-core.ts). The state is updated inside the queued task, then the engine is synced to it. A call's promise resolves when its result is on screen, and rejects with its own error.
- The state describes what is on screen, not a wish. A viewport that fails to show its series is emptied in the state, and a render that finishes after a detach or a destroy is torn down.
- Each change carries an origin: `api`, `user` (the engine reported a slice change nobody asked for), `url`, or `init`. A host that mirrors the state into the address bar skips `url` changes so a restored link does not push history.
- Failures nobody is waiting for (restoring `initialState` once an element is attached) go to an `error` event, so they are never an unhandled rejection.
- UIDs from links and hosts are validated (digits and dots, at most 64 characters) before they can reach a request path.
- Cornerstone sits behind `RenderingPort` ([rendering-port.ts](../../packages/core/src/rendering-port.ts)). `createViewerCore` takes the port as a function, so the whole queue, state, and event logic is unit tested without a browser, against a fake port.

## Consequences

- **A slow call blocks the ones behind it.** There is no cancellation: the requester has no abort signal yet. Calls that are superseded still run. This is acceptable for one viewer with one to four viewports, and revisited when M3 adds prioritised loading.
- **`getState()` lags a call by one queue step.** Right after `setViewportSeries(...)` returns a promise the state is unchanged; it changes when the task runs. Await the call, or subscribe.
- **Layout is `1x1` only** in the schema until M7. Widening a literal later is not breaking for readers.
- `initialState` does not list the study: call `loadStudy` for that. It only restores what to show, so a link works without a QIDO request.
