# M4 report: styled shell and adapters

**Done by the plan's criteria**, with the limits listed at the end. The repository has 568 tests (398 at the end of M3). The full matrix passes: vanilla, headless (every scenario, including the new `thumbnails`), Vite React, Vite Vue, Next with Turbopack and with webpack, and Nuxt, each in `inline` and `url` mode, and each with the new `shell` scenario.

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| Lit toolbar | [toolbar.ts](../packages/elements/src/toolbar.ts), [toolbar-config.ts](../packages/elements/src/toolbar-config.ts) | `role="toolbar"`, one tab stop, arrows, Home and End. Items are `tool`, `action`, `menu`, `separator`, `custom`. Toggles show their state; actions stay in the tab order and are marked unavailable with no series. The presets menu opens from the keyboard and returns the focus. 18 unit tests, and the matrix drives it by keyboard |
| Viewport grid | `layoutCells` in [layout.ts](../packages/elements/src/layout.ts), the stage in [viewer-element.ts](../packages/elements/src/viewer-element.ts) | One cell, `vp-0`, for the only layout the state has (`1x1`). The grid is a CSS grid built from `layoutCells`, so M7 adds layouts in one place. There is no separate grid element |
| Series browser with thumbnails | [series-browser.ts](../packages/elements/src/series-browser.ts), `viewer.thumbnails` | A listbox that marks the series on screen, shows one on click, Enter or Space, and marks SEG and SR rows unavailable. Thumbnails are drawn on the CPU through `RenderingPort.renderThumbnail`, two at a time, as rows scroll into view. The `thumbnails` scenario checks the real engine's picture is a 64 by 64 JPEG that is not blank, fetched with one frame request, kept, and absent for a SEG |
| Slots | [viewer-element.ts](../packages/elements/src/viewer-element.ts) | `banner`, `toolbar-start`, `toolbar-end`, `panel-left`, `panel-right`, `viewport-overlay`, `empty-state`. The vanilla example fills `banner` |
| Panel registry | [ui.ts](../packages/core/src/ui.ts), [panel-dock.ts](../packages/elements/src/panel-dock.ts) | `viewer.ui.registerPanel`; tabs with arrow keys; a panel is filled when first shown, cleaned up when unregistered, and one that throws reports `dv-error` without hiding the others |
| React and Vue adapters | [DicomViewer.tsx](../packages/react/src/DicomViewer.tsx), [DicomViewer.ts](../packages/vue/src/DicomViewer.ts) | Both wrap `<dv-viewer>`. Tests cover StrictMode (one viewer), no restart for new callbacks, restart for a new study, `navigate`, `initialState`, state-change callbacks, panels, slots, theme, and server rendering in a node environment. The Vue tests assert neither the viewer nor a viewport is a Proxy, and that deep-reactive options reach the element unwrapped |
| Light and dark themes | [tokens.ts](../packages/elements/src/tokens.ts), `styles.css` | Tests hold text pairs to 4.5:1 and borders and focus rings to 3:1 in both. The shell scenario runs axe in both |
| axe clean | [shell.ts](../scripts/matrix/shell.ts) | In every framework example, both asset modes, both themes: zero violations of the WCAG 2.0 to 2.2 A and AA rules and the best-practice rules, scoped to `<dv-viewer>` |
| Fully usable by keyboard | same scenario | Toolbar arrows, Enter and Space; the presets menu (open, move, choose, focus returns); the series list; and, once the viewport has the focus, scroll and reset. Nothing in that path needed the mouse except focusing the viewport, which Tab also does |

## What the real engine and axe found

| Problem | Cause | Fix |
|---|---|---|
| axe: `landmark-main-is-top-level` | The stage was a `<main>` inside the shell's region | A library component should not claim the page's `main`. The stage is a `div`; the shell is a named `region` |
| A destroyed viewer still delivered a thumbnail | The render was already in flight when `destroy()` ran | The result is dropped if the viewer is gone, and a unit test holds a render across `destroy()` |
| A toolbar put back after removal showed stale state | Lit does not re-render on reconnect | `connectedCallback` requests an update |

The thumbnail renderer and the slot boundary worked in the real engine the first time they were run; both are covered by scenarios, not just unit tests.

## Decisions

- [ADR 0007](adr/0007-styled-shell.md): chrome in shadow DOM, viewports in light DOM shown through named slots; adapters wrap the element; panels are data in the core; tokens written once.
- `@01x/dicom-viewer-core/testing` exports a real viewer on a fake engine, so the elements and adapters are tested without WebGL. It is outside the semver contract.
- The `<dv-viewer>` of M1 changed shape: it renders into a shadow root, takes `options` or `wado-root`, and a `series-uid` is optional. `dv-ready` now carries `{ viewer, viewport }`, and `dv-teardown` is new.

## Changes to the API

- **Core:** `viewer.getStudy()`, `viewer.ui` (`registerPanel`, `panels`), `viewer.thumbnails.get`, the event `ui:panels`, `RenderingPort.renderThumbnail`, and the `./testing` subpath.
- **Elements:** `<dv-viewer>`, `<dv-toolbar>`, `<dv-panel-dock>`, `<dv-series-browser>`; `DEFAULT_TOOLBAR`, `TOOLBAR_ACTIONS`; `styles.css`.
- **React:** `DicomViewer` props `options`, `studyInstanceUID`, `seriesInstanceUID`, `navigate`, `initialState`, `onStateChange`, `toolbar`, `panels`, `hideSeriesPanel`, `theme`, the slot props, `viewerRef`, `onReady(viewer, viewport)`, `onError`; `useViewer`, `useViewerState`.
- **Vue:** the same, with emits `ready`, `error`, `state-change`, `panel-<id>` slots, and `useViewer`, `useViewerState`, `provideViewer`.

## Not done, or not proven

- **No controlled `state` prop.** The plan scopes it to layout, segmentation, and measurements, which do not exist yet; `initialState` and `onStateChange` cover M4.
- **One layout.** The grid exists as a function and a CSS grid, but only `1x1` can be shown until M7.
- **axe covers the shell and the series browser**, in the states the scenario reaches (a series shown, the viewport focused, the presets menu closed). It does not run with the menu open, with a host's own panels, or with the empty state.
- **The React and Vue panel and slot paths are unit-tested in jsdom**, not run in a browser; the framework examples use the defaults.
- **No touch input, no narrow-screen test.** The shell has a stacked layout below 40rem, checked by reading the CSS, not by a screenshot. Visual regression is M8.
- **Thumbnails for a series use its first stack's middle slice**, and a series whose first stack is not the one a person wants still shows that picture.
- **Chromium only**, as before. Safari and Firefox, React 18, the package name, and open question 5 (the default keys against OHIF) are still open.
- **Prefetch settings are still global per page** (ADR 0006), and thumbnails share the loader's pools with it.
