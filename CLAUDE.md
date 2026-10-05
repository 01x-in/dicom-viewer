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
- Viewer state is `ViewerStateV1`. Every change a host asks for, and every call that touches the engine, goes through the queue in `viewer-core.ts` (docs/adr/0004-viewer-state-and-ordering.md). Only the engine's reports of user input (the mouse wheel, and dragging to change the window, zoom, or pan) update the state directly.
- What a viewport looks like (window, invert, zoom) is part of `ViewportStateV1`. Changes the host asks for (the API, keys, presets, cine, `navigateTo`) go through the queue and are tagged `api`; changes the user makes with the mouse are recorded from the engine's view report and tagged `user` (docs/adr/0006-view-state-and-input.md). Do not add a host-driven path that changes the engine without going through `viewer-core.ts`.
- Whatever the engine acquires (workers, cache, metadata, WebGL) must be given back when the viewer or stack is destroyed (docs/adr/0005-engine-runtime-lifecycle.md). `pnpm matrix --only headless` runs the 20-cycle leak check.
- UIDs that come from a link or a host are validated with `assertDicomUid` before they reach a request path.

## Data
- Only the synthetic phantom in `fixtures/phantom` may be committed. Never commit real, licensed, or de-identified patient data.

## Commands
- `pnpm check` runs everything (build, format check, lint, typecheck, test). Build comes first because packages resolve each other through `dist`.
- Phantom: `cd tools/phantom && uv run pytest -q`.
- `pnpm matrix` packs the tarballs, installs each example in `examples/` from them, builds it, and runs the browser smoke test (`--only <name>`, `--dev`). Needs Playwright's Chromium; set `DV_CHROMIUM` to use an existing one.
