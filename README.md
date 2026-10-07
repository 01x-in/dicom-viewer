# dicom-viewer

A DICOM viewer that you install from npm into React, Next.js, Vue, or Nuxt. It is built on [Cornerstone3D](https://www.cornerstonejs.org/) and aims for OHIF-level tools. It ships with a styled default interface and a headless core (a core that has no interface of its own).

> Status: milestones M0 to M6 and M6.5 (shell polish) are done. The package is not published yet. Package names use the `@scope/` placeholder until the npm scope is chosen.

## What works today

- Loading: studies from a DICOMweb server (headers, token refresh, and retries are configurable) or from local files.
- Navigation: scroll, window and level with presets, zoom, pan, invert, cine playback, keyboard shortcuts, and an overlay with the slice number.
- Series browser: a list of the series in the study, with a thumbnail for each series that has pictures.
- Measurements: length, bidirectional, ellipse, rectangle, probe, and angle. Ellipse and rectangle show Hounsfield statistics (the mean, spread, minimum, and maximum of the pixels inside). A list panel lets you jump to, rename, and delete a measurement. You can export and import measurements as JSON.
- Segmentations: DICOM SEG overlays. A SEG is loaded against the series it names, and each segment can be shown, hidden, recoloured, made more or less opaque, highlighted (the others fade, or the chosen ones get an outline), and gone to (the image with most of it, the one nearest its middle, or the one nearest the image on screen). The same state shows in every viewport. A SEG that does not lie on its images is drawn with a warning. A binary SEG of 512 by 512 by 300 pixels with 100 segments loads in about 2 seconds. A Segments panel lists the SEGs of the study.
- Interface: an icon toolbar, side panels that fold, slots for your own content, a light and a dark theme, and three palettes (`palette="navy"`, `palette="graphite"`, or the default). Any single colour is a `--dv-color-*` CSS property, so the viewer can take the colours of the page it sits in. The interface passes automated accessibility checks (axe) and works from the keyboard.
- Frameworks: the same interface runs in plain HTML, React, Vue, Next.js (Turbopack and webpack), and Nuxt, with no bundler configuration.

Not built yet: layouts and MPR (M7), and the 1.0 release (M8). The plan is in [docs/plan.md](docs/plan.md).

## Packages

| Package | What it is |
|---|---|
| `@scope/viewer-core` | Headless core: Cornerstone engine, state store, tools, measurements, and the DICOMweb data source |
| `@scope/viewer-elements` | Styled interface as Lit web components (`<dv-viewer>`, toolbar, panels) |
| `@scope/viewer-react` | React adapter (Vite, Next.js App Router) |
| `@scope/viewer-vue` | Vue 3 adapter (Vite, Nuxt) |

## Using it

Every setup needs two things: a data source (where the images come from) and a study UID (which study to open). Give the viewer a box with a height, because it fills its parent.

**Plain HTML**

```html
<dv-viewer id="viewer" style="display: block; height: 100vh"></dv-viewer>
<script type="module">
  import '@scope/viewer-elements/define';
  import { createDicomWebDataSource } from '@scope/viewer-core';

  const viewer = document.querySelector('#viewer');
  viewer.options = {
    dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
  };
  viewer.studyInstanceUid = '1.2.840.113619.2.55.3';
</script>
```

For a quick test you can also use attributes: `<dv-viewer wado-root="..." study-uid="...">`.

**React and Next.js**

```tsx
'use client';
import { createDicomWebDataSource, type ViewerOptions } from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-react';
import type { JSX } from 'react';

// Keep the options object the same between renders. A new object restarts the viewer.
const options: ViewerOptions = {
  dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
};

export function Viewer(): JSX.Element {
  return (
    <div style={{ height: '100vh' }}>
      <DicomViewer options={options} studyInstanceUID="1.2.840.113619.2.55.3" />
    </div>
  );
}
```

**Vue and Nuxt**

```vue
<script setup lang="ts">
import { createDicomWebDataSource, type ViewerOptions } from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-vue';

const options: ViewerOptions = {
  dataSource: createDicomWebDataSource({ wadoRoot: 'https://pacs.example.org/dicom-web' }),
};
</script>

<template>
  <div style="height: 100vh">
    <DicomViewer :options="options" study-instance-uid="1.2.840.113619.2.55.3" />
  </div>
</template>
```

In all three, the viewer starts on the first series that has pictures. Add `series-uid` (`seriesInstanceUID` in React, `seriesInstanceUid` in Vue) to start on a different one. The examples in [examples](examples) are complete, working versions of each setup.

## Customizing

Everything below is optional. The viewer works with the data source and the study UID only.

### Window presets

A window preset is a brightness and contrast setting for CT, such as "Lung" or "Bone". The menu with the sliders icon in the toolbar lists them, and the number keys `1` to `9` choose the first nine. Pass your own list in `windowLevelPresets`. The list replaces the built-in one, so to add to it, start with `DEFAULT_WINDOW_PRESETS`:

```ts
import { DEFAULT_WINDOW_PRESETS, type ViewerOptions } from '@scope/viewer-core';

const options: ViewerOptions = {
  dataSource,
  windowLevelPresets: [
    ...DEFAULT_WINDOW_PRESETS, // lung, soft tissue, bone, brain, liver
    { id: 'mediastinum', label: 'Mediastinum', center: 50, width: 350 },
  ],
};
```

Each preset needs an `id` that is unique, a `label`, a `center` and a `width` in Hounsfield units. The `width` must be above zero. A preset that breaks these rules throws a `RangeError` that says which one. Presets are fixed when the viewer starts. To change the list, create the viewer again. You can apply a preset from code with `viewer.viewports.get('vp-0')?.applyWindowPreset('mediastinum')`.

### Keyboard shortcuts

Shortcuts work while a viewport has the focus. Pass `keybindings` to change them. A key with the value `null` is removed, and `keybindings: false` turns the keyboard off. The tooltips in the toolbar show the keys that are in force.

```ts
const options: ViewerOptions = {
  dataSource,
  keybindings: {
    m: { type: 'tool', tool: 'length' }, // M starts the length tool
    'Shift+i': { type: 'invert' },
    r: null, // remove the default "reset" key
  },
};
```

An action is one of `scroll`, `scroll-to`, `zoom`, `invert`, `reset`, `cine`, `tool`, `preset`, and `delete-measurement`. The type `KeyAction` in `@scope/viewer-core` lists the fields of each.

### Other options

All of these go in the same options object:

| Option | What it does |
|---|---|
| `tools: { active: 'pan' }` | The tool the left mouse button drives at the start. The default is window and level |
| `overlay: { showPatientInfo: true }` | Shows the patient's name and ID in the corner of the image. They are off by default, so a screenshot or a shared screen does not carry them. `overlay: false` removes the overlay |
| `prefetch: { radius: 32 }` | How many slices either side of the one on screen are loaded ahead of time. The default is 64. `false` loads only what is asked for |
| `assets` | Where the decode worker and the codec files come from. The default is `{ mode: 'inline' }`, which needs no setup. `{ mode: 'url', baseUrl }` serves them from your own URL. Run `npx viewer-assets copy <folder>` to copy the files there |
| `cpuRendering: true` | Draws without WebGL. It is slower, and segmentation overlays are not drawn this way |

### Sign-in and tokens

The data source takes two functions. `getRequestHeaders` is called for every request, so a token that changes is always read fresh. `onUnauthorized` is called after a 401 response. Refresh your token in it, and the request is tried once more.

```ts
const dataSource = createDicomWebDataSource({
  wadoRoot: 'https://pacs.example.org/dicom-web',
  getRequestHeaders: () => ({ Authorization: `Bearer ${session.token}` }),
  onUnauthorized: async () => {
    await session.refresh();
  },
});
```

Requests are tried again after a 5xx response, with a short wait. A 403 or a 404 is never tried again.

### Look and feel

- `theme`: `dark` (the default) or `light`.
- `palette`: `default`, `navy` (deep blue with a cyan accent), or `graphite` (neutral grey with a teal accent). Each one works in both themes.
- Any single colour: set a `--dv-color-*` property on `<dv-viewer>` from your own CSS. It wins over the theme and the palette. The colours are `--dv-color-bg`, `-surface`, `-surface-raised`, `-border`, `-text`, `-text-muted`, `-accent`, `-accent-text`, `-focus`, `-danger`, and `-overlay-accent`. The sizes are `--dv-radius`, `--dv-radius-lg`, `--dv-icon-size`, `--dv-control-size`, `--dv-toolbar-height`, and `--dv-panel-width`. The fonts are `--dv-font-family` and `--dv-font-mono`.

```css
dv-viewer {
  --dv-color-accent: #ff7a00;
  --dv-color-accent-text: #1a0d00;
  --dv-radius: 2px;
}
```

In HTML, write `theme="light" palette="navy"`. In React and Vue, pass `theme` and `palette` as props. Keep the text on the accent colour readable: `--dv-color-accent-text` must contrast with `--dv-color-accent`. The built-in palettes are checked for this, and yours are not.

### The toolbar

`toolbar-labels="inline"` (the `toolbarLabels` prop in React and Vue) puts the name of each button beside its icon. `hide-toolbar` (or `toolbar={false}`) removes the toolbar. To choose the buttons yourself, pass a list of items. Each item is a `tool`, an `action`, a `menu`, a `separator`, or `custom`. The built-in actions are in `TOOLBAR_ACTIONS`.

```ts
import { TOOLBAR_ACTIONS, type ToolbarItem } from '@scope/viewer-elements';

const toolbar: ToolbarItem[] = [
  { type: 'tool', tool: 'window-level' },
  { type: 'tool', tool: 'pan' },
  { type: 'separator' },
  TOOLBAR_ACTIONS.measure,
  TOOLBAR_ACTIONS.presets,
  {
    type: 'action',
    id: 'export',
    label: 'Export measurements',
    // `download` is your own function: save the text as a file.
    run: ({ viewer }) => download(JSON.stringify(viewer.measurements.exportJson())),
  },
];
// <dv-viewer>: element.toolbarItems = toolbar   React and Vue: toolbar={toolbar}
```

An action with no `icon` shows its label as text. To use one of the built-in icons, set `icon` to its name, such as `'zoom-in'`.

### Panels and slots

The right dock has two built-in tabs (Measurements and Segments) and the left dock has the series list. Hide any of them with `hide-series-panel`, `hide-measurements-panel`, and `hide-segmentations-panel` (the props `hideSeriesPanel` and so on). Add a panel of your own with `viewer.ui.registerPanel`, or in React with the `panels` prop and in Vue with `panels` and a `panel-<id>` slot:

```ts
viewer.ui.registerPanel({
  id: 'notes',
  title: 'Notes',
  icon: 'highlight', // optional: the name of one of the built-in icons
  placement: 'right',
  mount: (container) => {
    container.textContent = 'Anything you like.';
    return () => container.replaceChildren(); // runs when the panel is removed
  },
});
```

You can also put your own content in these slots of `<dv-viewer>`: `banner` (a strip above the toolbar, such as a "not for diagnosis" notice), `toolbar-start`, `toolbar-end`, `panel-left`, `panel-right`, `viewport-overlay`, and `empty-state`. React has the props `banner`, `toolbarStart`, `toolbarEnd`, `panelLeft`, and `panelRight`.

### Reacting to the viewer, and driving it

`<dv-viewer>` fires `dv-ready` (with the `viewer` and the first `viewport`), `dv-error`, and `dv-teardown`. React and Vue have `onReady` and `onError`. The `viewer` has the whole API:

```ts
// Show an image from outside the viewer, with a SEG segment highlighted on it.
await viewer.navigateTo({
  seriesInstanceUID,
  sopInstanceUID,
  segmentations: [{ seriesInstanceUID: segSeries, visible: true, highlightSegments: [2] }],
});

await viewer.tools.setActive('length');
const json = viewer.measurements.exportJson(); // and importJson(json)
await viewer.segmentations.load(segSeries); // then setVisible, setSegmentColor, highlight, jumpToSegment
```

The state of the viewer (series, slice, window, zoom) is `viewer.getState()`, and `viewer.subscribe` and `viewer.on(...)` tell you when it changes.

## Examples

The `examples` folder has one project for each setup that the tests cover: `vanilla`, `headless` (the core with no interface), `vite-react`, `vite-vue`, `next-app`, and `nuxt`. Each one loads a study from a DICOMweb server. Read the source of an example to see how to wire the viewer into your own project.

## Development

Prerequisites: Node 22.22.2+ or 24.15+, pnpm 10, and [uv](https://docs.astral.sh/uv/) for the phantom generator.

```bash
pnpm install
pnpm check      # build, format check, lint, typecheck, test
```

| Command | What it does |
|---|---|
| `pnpm test` | Vitest across all packages |
| `pnpm lint` | ESLint (typescript-eslint strict, type-checked) |
| `pnpm typecheck` | `tsc` for every package and the configuration files |
| `pnpm build` | tsdown builds and publint checks |
| `pnpm format` | Biome formatting |
| `pnpm matrix` | Packs the packages (run `pnpm build` first), installs each example from the packs, builds it, and runs browser tests in Chromium. The `headless` example also generates a 300 MB SEG with uv for the performance check |

`pnpm matrix` needs the Chromium that Playwright installs. To use another Chromium, set the `DV_CHROMIUM` environment variable to its path. Add `--only <name>` to run one example.

### Documentation

- [docs/plan.md](docs/plan.md): the plan, the architecture, and the milestones, with the outcome of each finished milestone.
- [docs/adr](docs/adr): the architecture decisions, one file for each.
- The reports `docs/m1-report.md` to `docs/m6-report.md`: what each milestone proved and what it left open.

### Test data

Tests use only the synthetic phantom in [fixtures/phantom](fixtures/phantom/README.md), generated by [tools/phantom](tools/phantom/phantom.py). Never commit real or licensed imaging data.

```bash
cd tools/phantom
uv run pytest -q
uv run python phantom.py ../../fixtures/phantom
```

## License

MIT. See [LICENSE](LICENSE).
