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
- Named exports only. Default exports are allowed only in tool config files.
- Explicit return types on exported functions.
- Validate external data (DICOM JSON, measurement imports, URL state) with Zod.
- TDD: write the test first, and never weaken an assertion to make a test pass.

## Architecture rules
- Only `packages/core/src/engine/**` and `packages/core/workers/**` may import `@cornerstonejs/*`. Everything else goes through `RenderingPort`. ESLint enforces this.
- The public API never exposes Cornerstone types, except under `viewer.unsafe`.
- Cornerstone packages are exact-pinned dependencies of `@scope/viewer-core`, not peers.
- Vue code must keep Cornerstone and viewer objects out of reactivity (`shallowRef` + `markRaw`).

## Data
- Only the synthetic phantom in `fixtures/phantom` may be committed. Never commit real, licensed, or de-identified patient data.

## Commands
- `pnpm check` runs everything (build, format check, lint, typecheck, test). Build comes first because packages resolve each other through `dist`.
- Phantom: `cd tools/phantom && uv run pytest -q`.
