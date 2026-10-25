# Releasing

The four packages (`viewer-core`, `viewer-elements`, `viewer-react`, `viewer-vue`) are versioned **together**
(changesets `fixed` group), so a host never has a core and an adapter from different versions.

## Before the first release

These are decisions and steps for the maintainer, not things the workflow can do. The workflow publishes with **npm
trusted publishing** (no token), which npm only allows for a package that already exists. So the first version of each
package is published by hand, once, and the workflow takes over from then on.

1. **The npm scope is `@01x`** and the packages are `@01x/dicom-viewer-core`, `-elements`, `-react`, and
   `-vue` (already renamed in every `package.json`, import, doc, and in `.changeset/config.json`). The scope has to be
   the name of an npm **user or organization you own**, and the npm organization (`01x`) is not the GitHub one (`01x-in`), so check
   that you are a member of it (`npm org ls 01x`) before going on. To rename again, search with `grep -rIl "@01x/" .`.
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
     pnpm --filter "@01x/dicom-viewer-$p" pack --pack-destination "$OUT"
   done
   cd "$OUT"
   for p in core elements react vue; do   # core first: the others depend on it
     name="@01x/dicom-viewer-$p"
     if npm view "$name@1.0.0" version >/dev/null 2>&1; then echo "$name@1.0.0 is already on npm"; continue; fi
     mkdir "$p" && tar xzf "01x-dicom-viewer-$p"-*.tgz -C "$p"
     (cd "$p/package" && npm pkg delete publishConfig.provenance && npm publish --access public ${DRY_RUN:+--dry-run})
   done
   if [ -n "${DRY_RUN:-}" ]; then echo "dry run: nothing was published"; exit 0; fi
   for p in core elements react vue; do npm view "@01x/dicom-viewer-$p@1.0.0" version; done   # all four, or it stops
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

A release is its own action, apart from the development flow. Pull requests are how code gets into `main`. They never
start a release, and a release does not need a pull request.

### Before a release: normal development

1. A developer changes a package on a `task/...` branch and adds a changeset with `pnpm changeset`. A changeset is a
   small file in `.changeset/`. It names the packages, the bump (patch, minor, or major), and one sentence for the
   changelog.
2. The pull request is merged into `main`. This starts nothing that releases. The changesets wait in `.changeset/`.

### Starting a release

1. Open Actions > Release > Run workflow in GitHub, choose `main`, and run it.
2. To look first, tick `dry_run`. The run does everything up to the version step, prints the version and changelog
   changes it would write (the diff of `package.json` and `CHANGELOG.md` of each package), and stops. It publishes and
   pushes nothing.

### What a real run does, in order

1. **Checks the setup.** The branch is `main`, `RELEASE_ENABLED` is `true`, and npm is 11.5.1 or newer (trusted
   publishing needs it).
2. **Runs the first four gates** below: `pnpm check`, `pnpm package-check`, `pnpm size`, and `pnpm docs:api`. A failure
   stops the run before anything changes.
3. **Applies the waiting changesets** in a commit named `Release` on the runner. Each package gets its new version and
   changelog, and the changeset files are deleted. The commit is not on GitHub yet. The workflow saves its SHA.
4. **Publishes.** `pnpm release` runs `pnpm build` and `changeset publish`. It publishes each package whose version is
   not yet on npm and creates a git tag for it. There is no npm token: npm trusts the workflow through its OIDC identity
   (the trusted publisher set on each package), and it signs a provenance record of which repository, commit, and
   workflow built the package.
5. **Pushes** the `Release` commit and the tags to `main`. This happens only after the publish worked.

Only one release runs at a time, and a run that has started is never cancelled.

### When something fails

| Where it fails | What is on npm | What to do |
|---|---|---|
| The setup check or a gate (steps 1 and 2) | Nothing | Fix the cause and run the release again. |
| Versioning (step 3) | Nothing | Fix the cause (usually a changeset that names a package that does not exist) and run again. |
| The publish (step 4) | Some packages, maybe | Run the release again. It skips each version that is already on npm and publishes the rest. |
| The push to `main` (step 5), for example because `main` moved | Every package | Do not run the release again. The workflow keeps the release commit on a branch named `release-unpushed-<run id>`, pushes the tags, and prints an error that names the branch. Merge that branch into `main` (a fast-forward or a rebase), then delete it. |

A published version cannot be taken back. If a release has a bad package, publish a fixed version (add a changeset and
release again), and deprecate the bad one with `npm deprecate`.

### Settings that the flow relies on

- The repository variable `RELEASE_ENABLED` is `true`. Until it is, the workflow does nothing.
- Each package has a trusted publisher on npm: owner `01x-in`, repository `dicom-viewer`, workflow `release.yml`, and
  no environment. The first version of a new package name is published by hand (see above), because npm trusted
  publishing needs the package to exist.
- The release commit goes straight to `main`, made by `github-actions[bot]`. `main` must not require a pull request for
  that user. Today `main` is not protected. If you protect it later, let that bot bypass the rule, and keep the required
  checks for pull requests.
- The repository is public, because npm provenance works only for a public repository.

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
