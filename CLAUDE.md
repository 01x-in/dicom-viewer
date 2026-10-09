# CLAUDE.md

## Planning
- The plan, architecture, and milestones are in @docs/plan.md. Read it before starting a milestone.
- Work milestones in order. M1 (packaging spike) is a go/no-go gate: don't build UI before it passes.

## Branches
- Never commit to `main`. Work on `milestone/<n>-<slug>` or `task/<slug>` branches.
- Commit after each passing step, with the milestone ID in the message (for example `M1: ...`).

## Coding standards
- TypeScript strict, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `isolatedDeclarations`.
- No `any`, and no `as unknown as X` (ESLint enforces both).
- Named exports only. Default exports are allowed only in tool config files and in framework-mandated entry points (for example Next.js `layout.tsx` and `page.tsx` in `examples/`).
- Explicit return types on exported functions.
- Validate external data (DICOM JSON, measurement imports, URL state) with Zod.
- TDD: write the test first, and never weaken an assertion to make a test pass.

## Architecture rules
- Only `packages/core/src/engine/**` and `packages/core/workers/**` may import `@cornerstonejs/*`. Everything else goes through `RenderingPort`. ESLint enforces this.
- The public API never exposes Cornerstone types, except under `viewer.unsafe`.
- Cornerstone packages are exact-pinned `devDependencies` of `@scope/viewer-core`, bundled into its lazily loaded engine chunk, and never peers (docs/adr/0003-prebundled-engine.md).
- Vue code must keep Cornerstone and viewer objects out of reactivity (`shallowRef` + `markRaw`).
- Viewer state is `ViewerStateV1`. Every change a host asks for, and every call that touches the engine, goes through the queue in `viewer-core.ts` (the one exception is `viewer.thumbnails`, which is read-only and has its own two-at-a-time limiter, so a slow picture never holds up the viewport; see docs/adr/0007-styled-shell.md) (docs/adr/0004-viewer-state-and-ordering.md). Only the engine's reports of user input (the mouse wheel, and dragging to change the window or zoom) update the state directly; pan is not part of `ViewportStateV1`.
- What a viewport looks like (window, invert, zoom) is part of `ViewportStateV1`. Changes the host asks for (the API, keys, presets, cine, `navigateTo`) go through the queue and are tagged `api`; changes the user makes with the mouse are recorded from the engine's view report and tagged `user` (docs/adr/0006-view-state-and-input.md). Do not add a host-driven path that changes the engine without going through `viewer-core.ts`.
- The viewport element is never inside a shadow root: `<dv-viewer>` appends it to its own light DOM and shows it through a named slot. Only chrome (toolbar, panels, series browser) uses shadow DOM (docs/adr/0007-styled-shell.md). Side panels are registered with `viewer.ui.registerPanel`, and every visible color is a `--dv-*` token from `packages/elements/src/tokens.ts`.
- Measurements are plain data in `packages/core/src/measurements` (`measurements/v1`, patient millimetres, Zod), kept by the viewer whatever is on screen. The engine only draws a copy for the stacks that are on screen and gives it back when a stack goes (docs/adr/0008-measurements.md). Converting between a measurement, the engine's shape, and a Cornerstone annotation is done by the pure functions in `measurements/mappers.ts` and `engine/annotation-shape.ts`; the latter imports no Cornerstone code, so it stays testable. Changing a measurement and reading pixels for it go through the queue; what the mouse does does not.
- SEGs are kept by the viewer in `packages/core/src/segmentations` (plain data, one registry), and what is drawn for them is worked out by the pure `displayOf`, not in the engine. A binary SEG is decoded on the compute worker: `segmentations/decode-binary.ts` and `segment-index.ts` import nothing, and `workers/comlink-expose.ts` adds them to Cornerstone's one compute worker. The engine only registers the result with Cornerstone as labelmap segmentations (a second one draws outlines) and gives all of it back on `dispose()`. Loading and changing a SEG go through the queue, and a SEG goes with its study (docs/adr/0009-segmentations.md).
- The shell's look is the tokens, the icons in `packages/elements/src/icons.ts` (our own, inline SVG, hidden from assistive technology), and the palettes in `tokens.ts` (every palette is contrast-tested in both themes). A button with only a picture is named by its `aria-label`; the tooltip is extra. Do not change the `data-*` attributes and class names the tests and the matrix use when you restyle a piece (docs/adr/0010-shell-polish.md).
- Settings are `ViewerConfigV1` in `packages/core/src/config` (Zod, JSON-serializable, strict keys), put in layers in this order: defaults, the config given at the start, the options written in code, then `viewer.config.apply`. Anything a host can say in a config file must stay data: a toolbar button names a command in `viewer.commands`, never a function. The overlay shows a tag that can identify a patient only with `showPatientInfo`, whatever a config says (`config/tags.ts`). `viewer-config.schema.json` is generated from the schema: run `UPDATE_SCHEMA=1 pnpm test` after changing it (docs/adr/0011-config-layer.md).
- Layouts are the table in `packages/core/src/layouts.ts` (`1x1`, `1x2`, `2x2`, `1+3`; ids `vp-0` to `vp-3`); `ViewerStateV1.viewports` holds exactly the ids the layout shows, and `setLayout` goes through the queue. The toolbar, the commands, and the panels act on `viewer.viewports.active`, which is not in the state. A viewport can ask for a plane (`orientation`); `decideMpr` (pure) says whether the stack can be reformatted and the volume fits `memory.maxCacheBytes`, and if not, or if the engine throws `VolumeUnsupportedError`, the viewport shows slices with the reason in `viewport.mpr`. `RenderingPort.renderVolume` returns a `StackPort`, so nothing above it knows a plane from a stack. Planes of one stack share a volume, a tool group, and a window, and a SEG over a plane is a copy in a volume (docs/adr/0012-layouts-and-mpr.md).
- Whatever the engine acquires (workers, cache, metadata, WebGL) must be given back when the viewer or stack is destroyed (docs/adr/0005-engine-runtime-lifecycle.md). `pnpm matrix --only headless` runs the 20-cycle leak check.
- UIDs that come from a link or a host are validated with `assertDicomUid` before they reach a request path.

## Data
- Only the synthetic phantom in `fixtures/phantom` may be committed. Never commit real, licensed, or de-identified patient data.

## Commands
- `pnpm check` runs everything (build, format check, lint, typecheck, test). Build comes first because packages resolve each other through `dist`.
- `pnpm package-check` (publint and are-the-types-wrong on the packed tarballs), `pnpm size` (brotli budgets in `.size-limit.json`: raising one is a decision, say why in the PR), and `pnpm docs:api` (TypeDoc, warnings are errors) run in CI after `pnpm check`. Run `pnpm build` first.
- `pnpm visual` compares screenshots with `scripts/visual/baselines`. Make baselines only in the pinned Playwright image (docs/guides/visual-regression.md), never on a laptop.
- A change to a package needs a changeset (`pnpm changeset`). Never publish by hand: `.github/workflows/release.yml` does it, and only when `RELEASE_ENABLED` is `true` (docs/guides/releasing.md).
- Phantom: `cd tools/phantom && uv run pytest -q`.
- `pnpm matrix` packs the tarballs (it does not build: run `pnpm build` first), installs each example in `examples/` from them, builds it, and runs the browser smoke test (`--only <name>`, `--dev`). Needs Playwright's Chromium; set `DV_CHROMIUM` to use an existing one. The `headless` variant also generates the 300 MB SEG of the performance budget into `.matrix/perf-fixtures` (once, with uv, never committed); `DV_SEG_BUDGET_MS` changes its limit (3000 by default).
