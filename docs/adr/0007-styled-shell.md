# ADR 0007: The shell draws chrome in shadow DOM and shows light-DOM viewports through slots

Status: accepted (M4). Builds on [ADR 0002](0002-dom-strategy.md), which left shadow-DOM chrome to M4 and asked it to reproduce the failure first.

## Context

M4 adds a toolbar, a series browser with thumbnails, side panels, a banner, themes, and React and Vue adapters. [ADR 0002](0002-dom-strategy.md) kept `<dv-viewer>` in the light DOM because Cornerstone attaches a resize observer and pointer, wheel, and keyboard listeners to the element it draws into. Light DOM everywhere would give up two things the plan asks for: slots (`banner`, `panel-left`, ...), which only exist with a shadow root, and style isolation for the chrome.

## Decision

- **Chrome is shadow DOM; the viewport is never inside a shadow root.** `<dv-viewer>`, `<dv-toolbar>`, `<dv-panel-dock>`, and `<dv-series-browser>` render into shadow roots. Each viewport is a `<div slot="viewport-vp-0">` that the shell appends to its own **light DOM**, and the shell's template shows it through `<slot name="viewport-vp-0">`. The element Cornerstone is enabled on is therefore an ordinary document node. It is only *rendered* inside the shell.
- **Slots are native.** `banner`, `toolbar-start`, `toolbar-end`, `panel-left`, `panel-right`, `viewport-overlay`, and `empty-state`. The two toolbar slots are forwarded into `<dv-toolbar>`'s own `start` and `end`. React and Vue put their content in `<div slot="...">` children, so no DOM is moved and neither framework loses track of a node.
- **The adapters wrap the element.** `<DicomViewer>` (React) and `<DicomViewer>` (Vue) render `<dv-viewer>`, set its properties from props, and listen to `dv-ready`, `dv-teardown`, and `dv-error`. One UI codebase serves both, plus vanilla. Both load `@scope/viewer-elements/define` in an effect (`onMounted`), so server rendering emits only the unknown `<dv-viewer>` tag and the slot content.
- **Panels are data.** `viewer.ui.registerPanel({ id, title, placement, mount })` lives in the core, so a headless host can use it too. The shell registers the series browser as the panel `series`. A panel is filled when its tab is first shown and keeps its content while another tab is. React panels are portals into the container the dock gives `mount`; Vue panels are `panel-<id>` slots teleported into it.
- **Thumbnails go through the port.** `viewer.thumbnails.get(seriesUid, { size })` asks `RenderingPort.renderThumbnail`, which draws the middle slice with Cornerstone's `loadImageToCanvas` on the CPU (no WebGL context) and returns a JPEG data URL. The core runs two at a time and keeps the results. The slice is claimed like a stack's images, so it leaves the image cache again unless a stack is showing it.
- **Tokens are written once.** `--dv-*` custom properties live in `tokens.ts`, feed the shadow styles, and are emitted as `styles.css`. Dark is the default; `theme="light"` sets `data-theme="light"`. Tests hold text pairs to 4.5:1 and borders and focus rings to 3:1 in both.
- **Accessibility.** The shell is a `region` named by `label` (it does not claim `main`: that is the page's). The toolbar is `role="toolbar"` with one tab stop, arrow keys, Home and End. Menus open from the keyboard, close on Escape, and give the focus back. The series list is a `listbox`; panels are `tablist`/`tab`/`tabpanel`. Each viewport is `role="img"` with an `aria-label` that follows what it shows, and a polite live region says it once the picture has been still for 800 ms.

## Evidence

The `shell` scenario of `pnpm matrix` runs in every framework example, in both asset modes, against the real engine in Chromium. Through the slot boundary it checks: a mouse drag with the window / level tool changes the window, a click focuses the viewport, the keyboard scrolls and resets it, and the wheel scrolls. It also runs axe on the shell in the dark and light themes with the WCAG 2.0 to 2.2 A and AA rules and the best-practice rules. See [m4-report.md](../m4-report.md).

## Consequences

- **Host CSS reaches the viewport but not the chrome.** Hosts style the chrome through the `--dv-*` tokens and `::part()`.
- **`<dv-viewer>` fills its parent's height** and needs one.
- **A viewport element is created per viewer.** When the viewer restarts, the old elements are removed and new ones made.
- **The accessible name of a panel's content is the host's job.** The series browser is covered; panels a host registers are not checked by this repository.
- **Shadow DOM and Lit's dev-mode warning:** development builds log "Lit is in dev mode" with `console.warn`; production builds do not.
