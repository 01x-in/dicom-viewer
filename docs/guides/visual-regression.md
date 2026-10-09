# Visual regression

`pnpm visual` builds the `vanilla` example from the packed tarballs (as `pnpm matrix` does), opens it against the
synthetic phantom in a real browser, and compares a screenshot of each scene with a baseline.

| Scene | What it shows |
|---|---|
| `empty-state` | the shell with no study |
| `stack-dark`, `stack-light` | one stack in each theme |
| `palette-navy`, `palette-graphite-light` | the other palettes (graphite in the light theme) |
| `measurement-length` | a length drawn with the mouse, and the measurements panel |
| `segmentation` | a SEG over the stack |
| `layout-2x2` | four viewports, four slices |
| `mpr-planes` | axial, sagittal, and coronal planes of one volume |
| `mpr-fallback-notice` | the tilted series asked for a plane, shown as slices with the reason |

The scenes are in `scripts/visual/scenes.ts`. A scene is a function over the page: add one to cover a new look.

## How a picture is compared

- The page is 1200 by 800, the colour scheme is dark, motion is reduced, and the time zone and locale are fixed.
- A scene waits until two screenshots in a row are identical (volumes stream in, and Cornerstone draws a frame
  later), so there are no fixed sleeps.
- [pixelmatch](https://github.com/mapbox/pixelmatch) compares with a colour threshold of 0.1. A scene fails when more than
  0.2% of its pixels differ (`DV_VISUAL_MAX_DIFF`, a fraction, changes it) or when the size differs. A failure writes the
  picture to `.visual/actual/<scene>.png` and a diff to `.visual/diff/<scene>.png`.

## Baselines

The baselines are in `scripts/visual/baselines/<scene>.png`. Pixels depend on the browser build and the fonts, so
**make them where they are compared: in the pinned Playwright image**, not on a laptop.

- In CI, run the *Visual regression* workflow by hand with `update` ticked. Download the `visual` artifact and commit
  `scripts/visual/baselines/*.png`. Every run uploads the pictures it made, so a pull request that changes the look on
  purpose can take the new ones from its own run.
- With Docker, from the repository root (keep the tag equal to `playwright` in `package.json`):
  `docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-noble sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm build && pnpm visual --update"`

A scene with no baseline is reported as `NEW`, and fails the run only with `DV_VISUAL_STRICT=1`. Set it in
`.github/workflows/visual.yml` once the baselines are committed, so a new scene cannot go unchecked.

## Without the pinned image

`DV_CHROMIUM` points `pnpm visual` at another Chromium. The pictures it makes are only good for checking that a
scene still draws; do not commit them as baselines. Run twice in the same place and the pictures are identical
(0.000% differ on the machine this was built on), so a failure there is a change, not noise.
