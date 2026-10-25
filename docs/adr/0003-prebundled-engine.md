# ADR 0003: Cornerstone is bundled into core's engine chunk

Status: accepted (M1). Supersedes the rule in CLAUDE.md that Cornerstone packages are exact-pinned `dependencies` of `@01x/dicom-viewer-core`.

## Context

The first approach kept `@cornerstonejs/*` as external dependencies and let each host bundle them. Production builds then failed or misbehaved:

1. **Vite (and so Nuxt):** `Class extends value undefined is not a constructor or null`. `@kitware/vtk.js` depends on `xmlbuilder2`, which does `class X extends require('events').EventEmitter`. Vite replaces Node built-ins with an empty stub in browser builds, so `EventEmitter` is `undefined`. Hosts would need `resolve.alias: { events: 'events/' }`. (With that alias alone, the rest of the pipeline worked.)
2. **Vite, once `@cornerstonejs/tools` is imported:** `Cannot resolve entry module .../workers/computeWorker.js`. Tools registers its compute worker with `new Worker(new URL('../workers/computeWorker.js', import.meta.url))`, which Vite resolves relative to whichever chunk contains it.
3. **Any strict package manager:** `@cornerstonejs/adapters` imports `@babel/runtime/helpers/*` but does not declare `@babel/runtime`, so the import is unresolvable.

Each fix would be host configuration, which contradicts the zero-config goal.

## Decision

- `packages/core/src/engine/**` and everything it imports from `@cornerstonejs/*` is bundled by tsdown into one lazily loaded chunk (`dist/engine-*.js`). `viewer.ts` reaches it only through `import('./engine/index')`, so importing core on a server never evaluates Cornerstone or vtk.js.
- The `@cornerstonejs/*` packages move from `dependencies` to exact-pinned `devDependencies` of `@01x/dicom-viewer-core`. Renovate still bumps them as a group; the browser matrix gates the bump.
- The engine build applies three fixes, all in [tsdown.config.ts](../../packages/core/tsdown.config.ts):
  - alias `events` to the `events` npm polyfill and `url` to a shim over the global `URL`;
  - alias `@babel/runtime` to the copy installed beside core;
  - replace tools' `registerComputeWorker` with a no-op, because the engine registers the prebuilt compute worker itself (ADR 0001).

## Consequences

- **Host bundlers see one self-contained chunk** with no Node built-ins, no `new URL` workers, and no undeclared imports. All six examples (Vite with React, Vue, and vanilla; Next with Turbopack and with webpack; Nuxt) pass in both asset modes with empty bundler config.
- **Size.** The engine chunk is about 3.5 MB raw (about 0.9 MB brotli) with core, tools, adapters, the loader, and vtk.js. See [m1-bundle-sizes.md](../m1-bundle-sizes.md).
- **One Cornerstone per page.** Because it is bundled, a host that also imports `@cornerstonejs/*` gets a second, unrelated copy with its own state. `viewer.unsafe.cornerstone` must therefore hand out the bundled modules rather than ask hosts to import their own. The type declarations for that escape hatch will need to be written by us, since consumers no longer install Cornerstone.
- **Upgrades are rebuilds.** A Cornerstone bump changes our published artifact, not a transitive dependency range, so it is always a new viewer release.
- **Third-party advisories** for bundled packages no longer show up in consumers' `npm audit`; we need our own scanning in CI.
- The `events`, `url`, and `@babel/runtime` fixes are workarounds for upstream packaging gaps and should be re-checked on every Cornerstone and vtk.js upgrade.
