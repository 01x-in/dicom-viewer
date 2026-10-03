# ADR 0002: Viewports live in the light DOM

Status: accepted (M1).

## Context

The styled UI is built as Lit web components. Lit renders into a shadow root by default. Cornerstone3D attaches its resize observer, pointer, wheel, and keyboard listeners to the element it is enabled on and measures that element's layout, and the plan expects this to misbehave across a shadow boundary.

## Decision

- `<dv-viewer>` overrides `createRenderRoot()` to return the element itself, so its template, and every viewport inside it, are ordinary light-DOM nodes.
- Only UI chrome that Cornerstone never touches (toolbar, panels) may use shadow DOM. That arrives in M4.
- The element is a thin shell: it creates the viewer in `updated()` when it has a server, study, and series, tears it down in `disconnectedCallback()`, and reports through `dv-ready` and `dv-error` events and a reflected `status` attribute.

## Evidence from M1

- The matrix runs the vanilla example through `<dv-viewer>` in production and decodes and renders the J2K phantom, loads the SEG, and scrolls, with no console errors. Unit tests assert `shadowRoot === null` and that `.dv-viewport` is a child of the element.
- **Not tested:** hosting a viewport inside a shadow root. The claim that it breaks is taken from the plan, not reproduced here. If M4 wants shadow-DOM chrome around the viewport, it should reproduce the failure first.

## Consequences

- Host page CSS reaches the viewport. The element sets only `width`/`height: 100%` itself; hosts must give `<dv-viewer>` a size.
- Lit's SSR shim loads on the server (Next, Nuxt) without errors; the React and Vue adapters in M1 do not use the element at all (they call core directly), so SSR of the element itself is exercised only by importing it.
