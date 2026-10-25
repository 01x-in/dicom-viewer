# Releasing

The four packages (`viewer-core`, `viewer-elements`, `viewer-react`, `viewer-vue`) are versioned **together**
(changesets `fixed` group), so a host never has a core and an adapter from different versions.

## Before the first release

These are decisions and steps for the maintainer, not things the workflow can do. The workflow publishes with **npm
trusted publishing** (no token), which npm only allows for a package that already exists. So the first version of each
package is published by hand, once, and the workflow takes over from then on.

1. **The npm scope is `@tushar-im`** and the packages are `@tushar-im/dicom-viewer-core`, `-elements`, `-react`, and
   `-vue` (already renamed in every `package.json`, import, doc, and in `.changeset/config.json`). The scope has to be
   the name of an npm **user or organization you own**, and an npm user name is not always the GitHub one: check with
   `npm whoami` (or the organization page) before going on. If it is different, rename again with the same search:
   `grep -rIl "@tushar-im/" .`.
2. **Publish the first version by hand.** This is the one exception to "the workflow publishes" (the rule in
   `CLAUDE.md`): trusted publishing only works for a package that already exists, so each package name has to be
   published once with your own npm login (and your one-time password). Each package's `publishConfig` asks for
   provenance, which npm refuses to make outside CI, so the script below publishes a copy of each package with that one
   line removed. That first version therefore has no provenance badge; every later one has. It publishes the packed
   copy, the one whose `workspace:*` dependencies were turned into real versions, which a plain `npm publish` of the
   folder would not do.

   Save this as a script (a script, not pasted lines, so that it stops at the first error and `npm` can ask for your
   one-time password), and run it first with `DRY_RUN=1 bash first-publish.sh`. It is safe to run again after a failure:
   it skips a package that is already on npm.

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   git checkout main && git pull
   pnpm install --frozen-lockfile && pnpm build
   OUT=/tmp/dv-publish; rm -rf "$OUT" && mkdir "$OUT"
   for p in core elements react vue; do
     pnpm --filter "@tushar-im/dicom-viewer-$p" pack --pack-destination "$OUT"
   done
   cd "$OUT"
   for p in core elements react vue; do   # core first: the others depend on it
     name="@tushar-im/dicom-viewer-$p"
     if npm view "$name@1.0.0" version >/dev/null 2>&1; then echo "$name@1.0.0 is already on npm"; continue; fi
     mkdir "$p" && tar xzf "tushar-im-dicom-viewer-$p"-*.tgz -C "$p"
     (cd "$p/package" && npm pkg delete publishConfig.provenance && npm publish --access public ${DRY_RUN:+--dry-run})
   done
   if [ -n "${DRY_RUN:-}" ]; then echo "dry run: nothing was published"; exit 0; fi
   for p in core elements react vue; do npm view "@tushar-im/dicom-viewer-$p@1.0.0" version; done   # all four, or it stops
   ```

   Change `1.0.0` to the version you are releasing. When it prints four versions, tag what you published, in the
   repository: `pnpm exec changeset tag && git push --tags`.
3. **Add a trusted publisher to each of the four packages** on npmjs.com (the package's Settings, then *Trusted
   Publisher*, then GitHub Actions):
   - Organization or user: `01x-in` (the owner of the GitHub repository, which is not the npm scope)
   - Repository: `dicom-viewer`
   - Workflow filename: `release.yml` (the file name only)
   - Environment: empty
   - Allowed actions: `npm publish`
4. Set the repository variable `RELEASE_ENABLED` to `true`. Until it is set, `.github/workflows/release.yml` does nothing.
   There is no `NPM_TOKEN` secret to make; if you made one, delete it.

## How a release goes

1. Every pull request that changes a package adds a changeset: `pnpm changeset` (pick the packages, the bump, and write
   one sentence for the changelog).
2. A release is not part of merging pull requests. Merging to `main` runs the usual checks and nothing else: it
   never opens a release pull request and never publishes. You start the release workflow yourself, from
   Actions > Release > Run workflow, on `main`, and choose a step.
3. Step `version`: the workflow opens a *Version Packages* pull request that bumps the versions and writes the
   changelogs from the changesets on `main`. It publishes nothing. If GitHub Actions cannot open the pull request,
   turn on "Allow GitHub Actions to create and approve pull requests" (Settings > Actions > General > Workflow
   permissions), or open the pull request from the branch `changeset-release/main` by hand. Review and merge it like
   any other change.
4. Step `publish`: run the workflow again with this step when you want the release. It runs the first four gates
   below, stops if a changeset is still waiting (the *Version Packages* pull request was not merged), and then runs
   `pnpm release`: `pnpm build` and `changeset publish`, which publishes the packages whose version is not yet on npm
   and tags them. The job then pushes the tags. It authenticates with the workflow's OIDC identity (the trusted
   publisher you set up), and npm signs the build as provenance. It runs only for `main`, one at a time, and only
   when `RELEASE_ENABLED` is `true`.

## Gates

The release workflow runs the first four gates itself, in this order, before it versions or publishes. The last two are
workflows of their own that run on every pull request: the release workflow does not wait for them, so **protect `main`
with them as required checks** (Settings > Branches), and a pull request that fails either cannot be merged into a
release.

| Gate | Command | Where it runs | What it catches |
|---|---|---|---|
| Everything | `pnpm check` | CI and the release workflow | build, format, lint, strict TypeScript, and the unit tests |
| Packed packages | `pnpm package-check` | CI and the release workflow | publint (strict) and are-the-types-wrong on the real tarballs: a wrong `exports` map, a missing type, a file that is not in the package |
| Size budgets | `pnpm size` | CI and the release workflow | a chunk that grew past its brotli budget in `.size-limit.json` |
| API reference | `pnpm docs:api` | CI and the release workflow | a broken link or a bad tag in a doc comment (TypeDoc, warnings are errors) |
| Installability | `pnpm matrix` | the *CI* workflow, on every pull request | the packed tarballs install, build, and draw in Vite, Next.js (both bundlers), Nuxt, and a plain page |
| Visual regression | `pnpm visual` | the *Visual regression* workflow, on every pull request | the look of the shell, in the pinned Playwright image (see [visual regression](visual-regression.md)) |

## Provenance and trusted publishing

The workflow has the `id-token: write` permission and no npm token. npm checks that the request comes from the
repository and workflow file you named as the trusted publisher, and records which repository, commit, and workflow
built the tarball, and shows it on the package page. `pnpm publish` (which changesets runs) packs the package and then runs the real `npm publish` on it, so it is the npm command that does the OIDC login. `publishConfig.provenance` in each `package.json` keeps that on.
For it to verify, `repository.url` in each `package.json` must be the repository that runs the workflow (it is). The
workflow stops early if the runner's npm is older than 11.5.1, which trusted publishing needs.

If a release fails with `ENEEDAUTH` or a 404 on the publish, the usual cause is a trusted publisher that is missing or
does not match: the owner, the repository, and the file name `release.yml` must be exactly as above, for every package.

## Raising a budget

`.size-limit.json` has one budget per emitted chunk, 15 to 30% above the size at 1.0 (more for the tiny files). Raising one is a decision:
say why in the pull request (a new feature, a dependency), and change the number in the same commit.
