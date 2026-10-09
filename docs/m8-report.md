# M8 report: hardening and 1.0

**Ready to release, not released.** Everything the plan's done-when asks for is built and runs in CI, except the one thing that needs a decision and credentials that only the maintainer has: the npm scope, and a token. The `1.0.0` changeset is in `.changeset/`, and the release workflow is written and switched off until `RELEASE_ENABLED` is set (see [releasing](guides/releasing.md)). The limits are listed at the end.

## Done-when, item by item

| Plan item | Where | Evidence |
|---|---|---|
| Publint + are-the-types-wrong | [scripts/package-check.ts](../scripts/package-check.ts), `pnpm package-check`, CI | Packs each package as `npm publish` would, then runs publint (strict) and attw (profile `esm-only`, since the packages are ESM only) on the four tarballs. All eight checks pass. attw cannot resolve a CSS file, so `@scope/viewer-elements/styles.css` is excluded by name; every other entry point resolves, with types, for Node ESM and for bundlers |
| Size-limit budgets | [.size-limit.json](../.size-limit.json), `pnpm size`, CI | One brotli budget for each emitted chunk, 10 to 15% above where they are now (table below). A budget that is exceeded exits 1 (checked by lowering one) |
| Visual regression suite | [scripts/visual](../scripts/visual), `pnpm visual`, [visual.yml](../.github/workflows/visual.yml) | Ten scenes (empty state, two themes, two palettes, a measurement, a SEG, four viewports, three planes, a fallback notice) against baselines, with pixelmatch. On the machine it was built on, two runs in a row are identical (0.000% of pixels differ) and a changed baseline fails the run. **No baselines are committed yet**: see the limits |
| TypeDoc + guides | [typedoc.json](../typedoc.json), `pnpm docs:api`, [docs/guides](guides/index.md) | The API reference of all four packages builds with warnings as errors, in CI. Guides: installing in a framework (SSR, assets, CSP, what to do when it does not start), data sources, measurements and segmentations, visual regression, releasing |
| `1.0.0` with provenance | [release.yml](../.github/workflows/release.yml), the changeset, each `package.json` | `changeset status` says all four go from 0.0.0 to 1.0.0. `publishConfig` has `provenance: true`, `repository` points at this repository (which provenance checks), and each package has a README and a LICENSE in its tarball. **Nothing was published** |

## Budgets

Brotli sizes of the emitted files, at the end of M8:

| Chunk | Size | Budget |
|---|---|---|
| core: eager chunks (entry, state, data) | 27.6 kB | 32 kB |
| core: engine chunk (lazy: Cornerstone, vtk.js, tools, adapters) | 800 kB | 880 kB |
| core: inline assets chunk (lazy: workers and WASM as text) | 959 kB | 1,050 kB |
| core: dicom-parser chunk (lazy) | 6.6 kB | 8 kB |
| core/local, core/testing | 1.4 kB, 3.1 kB | 2 kB, 4 kB |
| elements: JavaScript | 23.6 kB | 28 kB |
| elements: styles.css | 621 B | 1 kB |
| react, vue | 2.7 kB, 3.0 kB | 3.5 kB each |

What a page downloads is the eager chunks plus the engine chunk (the inline chunk only in `inline` mode): about 830 kB brotli for the headless core, plus 24 kB for the shell. The per-example totals the matrix measures are in [m1-bundle-sizes.md](m1-bundle-sizes.md).

## Verification

- `pnpm check`: build, format, lint, typecheck, and 1,501 unit tests (1,496 at the end of M7) pass.
- `pnpm package-check`, `pnpm size`, and `pnpm docs:api` pass.
- `pnpm matrix`: 64 rows (`inline` and `url`); 57 pass in the full run and 58 once the one flaky row is re-run. The failures are the same ones `main` has on this machine: five are a favicon 404 that the full Chromium used here requests (the CI's headless shell does not), and one is the two-layer SEG colour check in `url` mode (`overlap: the disc alone is 94,154,101`). The same colour check also failed in `inline` mode in the full run and passed when that scenario was run again, so it is timing-sensitive here; it passed in CI on every run of M7
- `pnpm visual --update`, then `pnpm visual`: ten scenes, all within 0.000% of their own baselines; a baseline damaged on purpose fails with 2.3% differing.

## What running it found

| Problem | Cause | Fix |
|---|---|---|
| attw reported `@scope/viewer-elements/styles.css` as "resolution failed" | The checker only knows JavaScript and types; a CSS file has neither | The entry point is excluded by name in `package-check.ts`, with the reason |
| TypeDoc failed with warnings about `{@link css}` in six elements | The `static styles` property inherits a comment from Lit that links to a symbol only Lit has | The property is marked `@internal` (it is not API), which is also correct |
| TypeDoc listed 23 types "referenced but not exported" | They are real types of exported signatures, and not worth exporting for the reference | `validation.notExported` is off; broken links in comments still fail |
| ESLint tried to lint the generated API reference | `.docs` is output, and the lint config did not know it | `.docs` and `.visual` are ignored by ESLint and Git |

## Changes

- **Tooling (dev only):** `@arethetypeswrong/cli`, `size-limit` with `@size-limit/file`, `typedoc`, `pixelmatch`, `pngjs`, all exact-pinned. New commands `pnpm package-check`, `pnpm size`, `pnpm docs:api`, `pnpm visual`.
- **Shared code:** the matrix's "copy an example and point it at the tarballs" step is in `scripts/matrix/example.ts`, used by the matrix and by the visual suite.
- **Packages:** `repository`, `homepage`, `bugs`, `keywords`, and `publishConfig` on all four; a README and a LICENSE in each tarball. No source or API change.

## Not done, or not proven

- **Nothing is published.** The packages are still `@scope/viewer-*`, and publishing needs a real scope and an npm token. `docs/guides/releasing.md` lists the steps, and the workflow is off until `RELEASE_ENABLED` is `true`. The provenance path is therefore written but has not run.
- **The visual baselines are not committed.** Pixels depend on the browser build and the fonts, and the baselines have to be made in the pinned Playwright image, which could not be run where this was built (the sandbox has a different Chromium and no Docker). The suite runs in CI and reports every scene as `NEW` with its picture in the `visual` artifact; run the workflow with `update`, commit the pictures, and set `DV_VISUAL_STRICT=1`. Until then the suite checks only that every scene draws without a page error. The image tag (`v1.63.0-noble`) follows the `playwright` version and was not pulled here.
- **No documentation site.** The plan's architecture sketch has VitePress; M8's done-when asks for TypeDoc and guides, and those are Markdown and generated HTML. A site is a hosting decision.
- **Only Chromium** has run the matrix and the visual suite. Safari, Firefox, React 18, and touch input are still open.
- **Open questions from the plan** that this milestone does not answer: the package name and scope, and whether the default keys should match OHIF.
