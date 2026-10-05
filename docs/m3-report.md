# M3 report: navigation

**Done by the plan's criteria**, in the headless example only: the styled toolbar and panels are M4. A new `navigation` scenario drives the real engine in Chromium through every item below, in both asset modes. The repository has 398 tests (256 at the end of M2); the new ones run against a fake `RenderingPort`.

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| Tool bindings | [engine/tools.ts](../packages/core/src/engine/tools.ts), `viewer.tools` | Left button drives window / level, pan, zoom, or scroll (`tools.setActive`); middle pans, right zooms, wheel scrolls. The scenario drags with each button and checks the view or the picture changed, switches the tool, and checks the left button went to the new tool only |
| Keyboard | [keyboard.ts](../packages/core/src/keyboard.ts) | Scoped to the focused viewport element. Arrows, page keys, Home and End scroll; plus and minus zoom; `i` inverts; `r` resets; space plays cine; `w p z s` pick the tool; digits apply presets. Replaceable (`keybindings`) or off. Scenario: click, then ArrowDown, `1`, `i`, `r` |
| W/L presets | [window-presets.ts](../packages/core/src/window-presets.ts) | Lung, soft tissue, bone, brain, liver; replaceable (`windowLevelPresets`); `viewport.applyWindowPreset(id)` |
| Zoom, pan, reset, invert | `ViewportApi`, [engine/index.ts](../packages/core/src/engine/index.ts) | Window, invert, and zoom are in `ViewportStateV1`, so a link restores them (scenario: bone and zoom 2 survive a reload). Pan is not in the state ([ADR 0006](adr/0006-view-state-and-input.md)) |
| Cine | [cine.ts](../packages/core/src/cine.ts) | 1 to 60 slices per second, looping or not, stops with the series, element, viewer, or an engine failure. Scenario: at least five different slices in 1.2 s, and nothing moves after stop |
| Overlay text, slice indicator | [overlay.ts](../packages/core/src/overlay.ts) | Four corners over each viewport: series, image size, window, zoom, `Image 12 / 64`. The patient's name and ID are not shown unless `overlay.showPatientInfo` is set; the scenario checks the corner holds only the series description |
| `navigateTo` with prioritized load | `viewer.navigateTo`, `prefetch` option | Finds the instance in its series and stack, fails without changing anything if it is not there. Scenario: for a series never loaded, the first frame fetched is the target (slice 40), the next five are within four slices of it, and all 64 follow |
| `RenderingPort` fake and unit tests | [testing/fakes.ts](../packages/core/src/testing/fakes.ts), [testing/harness.ts](../packages/core/src/testing/harness.ts) | The fake gained the view, tool, and render-option recording; the harness is shared by six new test files |

## What the real engine found

Both fixes came from the scenario, not the unit tests; the fake engine cannot show either.

| Problem | Cause | Fix |
|---|---|---|
| After the pan tool, the zoom tool on the left button did nothing | Cornerstone's `setToolActive` adds the bindings it is given to the tool's own, so pan kept the left button and came first | Every tool gives up the left button (`setToolPassive`), then the chosen one is given it. The scenario now also goes back to window / level and checks nothing else still answers the left button |
| 1 worker thread alive after the last viewer, and the asset-switching scenario hung | The `wadors` loader cannot cancel a request that has started. A prefetch that finished after the workers were stopped started a new one | Loads in flight are counted; the workers stop when they have landed, and a change of asset settings waits too. Queued loads of a released stack are dropped. Recorded in ADR 0005 |

The lifecycle check (20 cycles, both asset modes) now runs with prefetching on and the viewer scrolled before each destroy: DOM nodes 80 to 118, listeners 58 to 18, heap 11.3 to 15.3 MB, no WebGL context alive of 42 created.

## Decisions

- [ADR 0006](adr/0006-view-state-and-input.md): the view is state, and the mouse, keys, presets, cine, and `navigateTo` reach it through the same queue and the same engine report.
- Cine runs in the core, not in Cornerstone's cine tool, so it is queued and testable.
- The defaults follow OHIF where they could (arrows, pan, zoom, window / level, invert, space for cine), but they are not a copy. Open question 5 stays open until M4 puts the shortcuts in a help panel.

## Changes to the API

`Viewer` gained `navigateTo` and `tools` (`list`, `getActive`, `setActive`, `windowPresets`). `ViewportApi` gained `getView`, `setWindow`, `setInvert`, `toggleInvert`, `setZoom`, `zoomBy`, `resetView`, `applyWindowPreset`, and `cine`. New events: `viewport:voi`, `viewport:camera`, `viewport:cine`, `tool:active`; the `error` event gained the contexts `cine` and `keyboard`. New options: `tools`, `windowLevelPresets`, `keybindings`, `overlay`, `prefetch`. `ViewportStateV1` gained `window`, `invert`, and `zoom`. `NavigateTarget.segmentations` arrives with M6.

## Not done, or not proven

- **No touch bindings**, and no pan in the state or the API beyond the tool and reset.
- **Prefetch settings are one per page**, and a closing viewer drops other viewers' queued prefetches (ADR 0006). Cornerstone also keeps a small record per viewport id for the life of the page.
- **No cancellation of a request that has started**, so a superseded series still finishes loading; M2's limit stands for metadata. Frames not yet started are dropped.
- **Multi-frame images** are refused, so `navigateTo` accepts frame 1 only.
- **Keyboard on non-US layouts** is handled by ignoring Shift for non-letters; it was tested in unit tests, not on a real AZERTY keyboard.
- **A window drag emits `state:changed` on every mouse move.** The example debounces its address update; a host that mirrors the state should too.
- **Browsers:** Chromium only, as before. The pan check compares screenshots, which proves the picture moved but not by how much.
- The React, Vue, and `<dv-viewer>` adapters pass the new `ViewportApi` through unchanged and were not given the new options; M4 owns them.
