# ADR 0006: The view is state, and input reaches it through the same queue

Status: accepted (M3). Builds on [ADR 0004](0004-viewer-state-and-ordering.md).

## Context

M3 adds everything a person does to a picture once it is on screen: window and level, invert, zoom, pan, cine, presets, keys, and jumping to an instance. Two of these could have been kept inside the engine, out of the state. A link that opens at the right slice but with the wrong window is not the link that was copied, though, and a keyboard that bypasses the queue can race a series switch.

## Decision

**What the viewport looks like is part of `ViewportStateV1`:** `window` (center and width), `invert`, and `zoom` (1 fits the image). The state holds only what differs from the default, so a link stays short and another series starts with its own window ([view.ts](../../packages/core/src/view.ts) decides what differs, with a tolerance for the rounding of the center and range round trip). Pan is not in the state: it depends on the size of the element, so a link could not mean the same thing on another screen. Reset puts all four back.

**One path for every change of view.** The engine reports a change of view (`onViewChange`), whoever caused it. `viewport.setWindow`, `setZoom`, presets, keys, and cine run in the queue and tag what they do as `api`; what arrives untagged was the mouse, and is a `user` change. The state is updated from the report, and `viewport:voi` and `viewport:camera` are emitted from the difference between consecutive reports. Restoring a state applies it to the engine with the origin of the call that asked (`url` for a link) and the report that follows finds nothing left to change.

**Tools.** The left mouse button drives one of four tools (`viewer.tools.setActive`); the middle button always pans, the right always zooms, and the wheel scrolls. The choice is a setting of the viewer, not state in a link: it belongs to the person using the page. It is given to every stack as it is drawn.

**Keyboard** is scoped to the viewport element, not the page. The viewer makes the element focusable (`tabindex="0"` unless the host chose one) and focuses it on a pointer press, because Cornerstone's mouse handling prevents the default that would otherwise do it. A key that is not bound, is held with a modifier that is not part of its binding, comes from a text field inside the element, or arrives while nothing is shown, is left alone: not handled, not prevented. Toggles ignore key repeat; scrolling and zooming use it. Bindings are chords (`Shift+i`) normalized so that `+` and digits work on layouts where they need Shift.

**Cine** is driven by the core, not by Cornerstone's cine tool, so it goes through the queue and works with the fake engine. A step starts when the one before it has finished, which makes a slow engine play slower instead of falling behind; the delay is shortened by the time the step took. It stops with the series, the element, the viewer, or a failed step.

**`navigateTo`** looks the instance up before it changes anything, so a target that is not there leaves the viewport as it was. It then asks the engine to start at that slice, which the loader fetches at interaction priority, and the engine **prefetches** outward from it (Cornerstone's `stackPrefetch`, 64 slices either way by default, nearest first, following the slice on screen). Prefetch stops when the stack goes away.

**The overlay** is plain DOM in the viewport element, `aria-hidden`, text only. Its text comes from a pure function (`overlayLines`) so a host that draws its own can show the same lines. The patient's name and ID are left out unless `overlay.showPatientInfo` is set. M4 adds the accessible live label.

## Consequences

- **Prefetch settings are global.** `stackPrefetch` has one configuration per page, so with several viewers the last one drawn decides the radius. v1 has one viewer per page.
- **Prefetch clears the queue of other prefetches when a stack is destroyed.** Cornerstone's `disable` clears the whole prefetch request type. With several viewers, one closing drops the others' queued prefetches; they continue as slices are asked for.
- **Cornerstone keeps a small prefetch record per viewport id** after it is disabled (an array of indices). Viewport ids are never reused, so it grows with the number of viewers a page ever makes, by about a kilobyte each. The lifecycle check does not see it.
- **A burst of user changes is a burst of state changes.** A window drag emits `state:changed` on every mouse move. Hosts that mirror the state to the address bar (the example does) should debounce; browsers limit how often it may change.
- **Touch is not bound.** One-finger and pinch gestures arrive with the iPad decision (open question 4).
- **Not in the state, so not in a link:** pan, the left-button tool, and whether cine is playing.
