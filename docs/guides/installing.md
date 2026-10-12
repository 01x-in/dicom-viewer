# Installing in a framework

The viewer is four packages. Install the ones for your framework, and Cornerstone comes along inside
`@tushar-im/dicom-viewer-core` (it is bundled, not a peer dependency, so you never install or pin it).

| You use | Install | Import |
|---|---|---|
| Plain HTML or any framework | `@tushar-im/dicom-viewer-core`, `@tushar-im/dicom-viewer-elements` | `import '@tushar-im/dicom-viewer-elements/define'` registers `<dv-viewer>` |
| React 19, Next.js | `@tushar-im/dicom-viewer-core`, `@tushar-im/dicom-viewer-react` | `import { DicomViewer } from '@tushar-im/dicom-viewer-react'` |
| Vue 3, Nuxt | `@tushar-im/dicom-viewer-core`, `@tushar-im/dicom-viewer-vue` | `import { DicomViewer } from '@tushar-im/dicom-viewer-vue'` |

## No bundler setup

The installability matrix (`pnpm matrix`) builds a project in each of these from the packed tarballs, with **no**
plugin and no configuration, and checks that a stack of phantom CT images draws: Vite with React, Vite with Vue,
Next.js with Turbopack, Next.js with webpack, Nuxt, and a plain page. That is the promise: you add the package and
the component, and nothing else.

Two things make it work:

- The Cornerstone engine (Cornerstone, vtk.js, the tools, the DICOM SEG adapters) is prebundled into one chunk that
  `@tushar-im/dicom-viewer-core` loads on first use. Your bundler sees an ordinary dynamic import and does not try to
  understand the engine's own worker and WASM references.
- The decode and compute workers, and the codec WASM, ship prebuilt ([ADR 0001](../adr/0001-asset-strategy.md)).

## Server rendering

Nothing in the viewer runs on the server.

- **React and Next.js.** `@tushar-im/dicom-viewer-react` starts with `'use client'` and loads the core inside an effect, so a
  server component can render it, and you do not need `dynamic(..., { ssr: false })`. Keep the `options` object the
  same between renders (define it outside the component, or memoize it): a new object restarts the viewer.
- **Vue and Nuxt.** The core loads in `onMounted`. If your own code builds the data source from `window` or
  `location`, create it in `onMounted` too (the Nuxt example does), or wrap the viewer in `<ClientOnly>`.
- **Anything else.** `createViewer` needs a browser. Do not call it on the server.

## Assets: `inline` or `url`

The decode worker and the codecs can be delivered two ways. Choose with the `assets` option.

| | `inline` (the default) | `url` |
|---|---|---|
| Setup | none | `npx viewer-assets copy public/viewer-assets`, then `assets: { mode: 'url', baseUrl: '/viewer-assets' }` |
| How it works | The workers are strings inside a lazily loaded chunk, started from `blob:` URLs, with the WASM embedded as base64 | The workers and `.wasm` files are plain files you serve |
| CSP it needs | `worker-src blob:` and `script-src 'wasm-unsafe-eval'` | `worker-src 'self'` and `'wasm-unsafe-eval'` (the WASM is still compiled) |
| Good for | Getting started, small deployments | A strict CSP that forbids `blob:`, and long-lived caching of the large files |

The inline chunk is part of your build even in `url` mode, but is never fetched there (it adds to the size of the
deploy, not to the page). The size of every chunk and of the `url` mode files is in
[m1-bundle-sizes.md](../m1-bundle-sizes.md); the budgets that keep them from growing are in `.size-limit.json`.

Run `viewer-assets copy` again after you update the packages, so the copied files match the version: a worker from
one version and a viewer from another is not supported.

## When the viewer does not start

| What you see | Likely cause |
|---|---|
| A blank box | The parent has no height. The viewer fills its parent. Give it `height: 100vh` or a fixed height |
| `dv-error` event, or the error panel, with a CSP message in the console | The CSP blocks `blob:` workers: allow `worker-src blob:`, or use `url` mode. If it blocks WebAssembly, allow `'wasm-unsafe-eval'` in `script-src`: `url` mode compiles the same WASM and needs it too |
| 404s for `decode.worker.js` or `.wasm` files in `url` mode | `baseUrl` does not match where the files are served, or `viewer-assets copy` was not run |
| The viewer restarts on every render in React | `options` is created inside the component. Define it outside, or memoize it |
| "Unsupported" or missing image data for one series | The server does not hand out the instance the series needs. See [data sources](data-sources.md) |

Safari and Firefox have not been run through the matrix. Chromium is the tested browser.
