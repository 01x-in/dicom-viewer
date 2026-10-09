# Releasing

The four packages (`viewer-core`, `viewer-elements`, `viewer-react`, `viewer-vue`) are versioned **together**
(changesets `fixed` group), so a host never has a core and an adapter from different versions.

## Before the first release

These are decisions for the maintainer, not things the workflow can do:

1. **Choose the npm scope.** Every package is `@scope/viewer-*` until then. Rename in each `package.json` (`name`, and
   the `workspace:*` dependencies keep working), in the imports of `examples/`, `scripts/matrix`, `docs`, and the
   `README`s, and in `.changeset/config.json` (`fixed: [["@scope/viewer-*"]]`). `grep -rn "@scope/"` finds them all.
2. **Create the scope on npm** (an organization, or your user name) and make an automation token with publish rights.
   Save it as the repository secret `NPM_TOKEN`.
3. **Confirm the name `dv-`** for the elements, and the licence holder in `LICENSE`.
4. Set the repository variable `RELEASE_ENABLED` to `true`. Until it is set, `.github/workflows/release.yml` does nothing.

## How a release goes

1. Every pull request that changes a package adds a changeset: `pnpm changeset` (pick the packages, the bump, and write
   one sentence for the changelog). The 1.0.0 changeset is already in `.changeset/`.
2. When pull requests with changesets reach `main`, the release workflow opens a *Version Packages* pull request that
   bumps the versions and writes the changelogs. It also runs the gates below.
3. Merging that pull request publishes: `pnpm release` runs `pnpm build` and `changeset publish`, which publishes the
   packages whose version is not yet on npm, tags them, and (with `NPM_CONFIG_PROVENANCE`) signs the build.

## Gates

A change cannot reach a release without passing, in the order the workflow runs them:

| Gate | Command | What it catches |
|---|---|---|
| Everything | `pnpm check` | build, format, lint, strict TypeScript, and the unit tests |
| Packed packages | `pnpm package-check` | publint (strict) and are-the-types-wrong on the real tarballs: a wrong `exports` map, a missing type, a file that is not in the package |
| Size budgets | `pnpm size` | a chunk that grew past its brotli budget in `.size-limit.json` |
| API reference | `pnpm docs:api` | a broken link or a bad tag in a doc comment (TypeDoc, warnings are errors) |
| Installability | `pnpm matrix` | the packed tarballs install, build, and draw in Vite, Next.js (both bundlers), Nuxt, and a plain page; runs in CI on every pull request |
| Visual regression | `pnpm visual` | the look of the shell, in the pinned Playwright image (see [visual regression](visual-regression.md)) |

## Provenance

With `provenance: true` in each package's `publishConfig` and the `id-token: write` permission, npm records which
repository, commit, and workflow built the tarball, and shows it on the package page. For it to verify, `repository.url`
in each `package.json` must be the repository that runs the workflow (it is).

## Raising a budget

`.size-limit.json` has one budget per emitted chunk, about 10 to 15% above the size at 1.0. Raising one is a decision:
say why in the pull request (a new feature, a dependency), and change the number in the same commit.
