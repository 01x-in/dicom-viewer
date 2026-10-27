# dicom-viewer

A DICOM viewer that you install from npm into React, Next.js, Vue, or Nuxt. It is built on [Cornerstone3D](https://www.cornerstonejs.org/) and aims for OHIF-level tools. It ships with a styled default interface and a headless core (a core that has no interface of its own).

> Status: milestones M0 to M8 (with M6.5, shell polish, and M6.6, the config layer) are done, and `1.0.0` is on npm under the `01x` organization. Releases are made by hand from GitHub Actions (see [docs/guides/releasing.md](docs/guides/releasing.md)).

> **Not a medical device.** This is software for building viewers. It is not cleared or approved for diagnosis or any clinical decision, and it comes with no warranty (see [LICENSE](LICENSE)). Whoever uses it in a product is responsible for that product's regulatory and privacy duties. The viewer hides patient-identifying overlay tags unless you turn them on.

## What works today

- Loading: studies from a DICOMweb server (headers, token refresh, and retries are configurable) or from local files.
- Navigation: scroll, window and level with presets, zoom, pan, invert, cine playback, keyboard shortcuts, and an overlay with the slice number.
- Series browser: a list of the series in the study, with a thumbnail for each series that has pictures.
- Measurements: length, bidirectional, ellipse, rectangle, probe, and angle. Ellipse and rectangle show Hounsfield statistics (the mean, spread, minimum, and maximum of the pixels inside). A list panel lets you jump to, rename, and delete a measurement. You can export and import measurements as JSON.
- Segmentations: DICOM SEG overlays. A SEG is loaded against the series it names, and each segment can be shown, hidden, recoloured, made more or less opaque, highlighted (the others fade, or the chosen ones get an outline), and gone to (the image with most of it, the one nearest its middle, or the one nearest the image on screen). The same state shows in every viewport. A SEG that does not lie on its images is drawn with a warning. A binary SEG of 512 by 512 by 300 pixels with 100 segments loads in about 2 seconds. A Segments panel lists the SEGs of the study.
- Interface: an icon toolbar, side panels that fold, slots for your own content, a light and a dark theme, and three palettes (`palette="navy"`, `palette="graphite"`, or the default). Any single colour is a `--dv-color-*` CSS property, so the viewer can take the colours of the page it sits in. The interface passes automated accessibility checks (axe) and works from the keyboard.
- Frameworks: the same interface runs in plain HTML, React, Vue, Next.js (Turbopack and webpack), and Nuxt, with no bundler configuration.
- Layouts and planes: four layouts (`1x1`, `1x2`, `2x2`, and one large with three small), series dragged from the browser into any viewport, hanging protocols that lay a study out by rule, and reformatted planes (axial, sagittal, and coronal) of a volume with crosshairs, a shared window, and a SEG drawn over each plane. A series that is tilted, unevenly spaced, or too large for the memory budget is shown as slices, and the viewport says why.

Which servers work, what you must provide for security, and how to log errors: [Servers, security, and errors](#servers-security-and-errors).

Not built yet: the OncoTrace-like example (M9). The plan is in [docs/plan.md](docs/plan.md).

## Packages

| Package | What it is |
|---|---|
| `@01x/dicom-viewer-core` | Headless core: Cornerstone engine, state store, tools, measurements, and the DICOMweb data source |
| `@01x/dicom-viewer-elements` | Styled interface as Lit web components (`<dv-viewer>`, toolbar, panels) |
| `@01x/dicom-viewer-react` | React adapter (Vite, Next.js App Router) |
| `@01x/dicom-viewer-vue` | Vue 3 adapter (Vite, Nuxt) |

## Install

Install the core and the package for your framework:

```bash
npm install @01x/dicom-viewer-core @01x/dicom-viewer-elements   # plain HTML or any other framework
npm install @01x/dicom-viewer-core @01x/dicom-viewer-react       # React 19 and Next.js
npm install @01x/dicom-viewer-core @01x/dicom-viewer-vue         # Vue 3.5 and Nuxt
```

The tests run in Chromium. The examples also pass in WebKit, the engine of Safari (`DV_BROWSER=webkit pnpm matrix`), and the demo has been checked by hand in Safari. Firefox has not been tested yet. See [the installing guide](docs/guides/installing.md) for what each setup needs.

## Using it

Every setup needs two things: a data source (where the images come from) and a study UID (which study to open). Give the viewer a box with a height, because it fills its parent.

**Plain HTML**

```html
<dv-viewer id="viewer" style="display: block; height: 100vh"></dv-viewer>
<script type="module">
  import '@01x/dicom-viewer-elements/define';
  import { createDicomWebDataSource } from '@01x/dicom-viewer-core';

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
import { createDicomWebDataSource, type ViewerOptions } from '@01x/dicom-viewer-core';
import { DicomViewer } from '@01x/dicom-viewer-react';
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
import { createDicomWebDataSource, type ViewerOptions } from '@01x/dicom-viewer-core';
import { DicomViewer } from '@01x/dicom-viewer-vue';

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

## Servers, security, and errors

### Which servers work

The viewer loads images from a **DICOMweb** server, or from local files. You give it a Study Instance UID (the `study-uid` attribute, or `studyInstanceUid` in code), and optionally a `series-uid`.

- **QIDO-RS** lists the series of that one study: `GET {qidoRoot}/studies/{StudyInstanceUID}/series`. `qidoRoot` is the same as `wadoRoot` unless you set it.
- **WADO-RS** gives the metadata of each series, the images (one frame request for each instance), and the whole instance of a SEG or SR object.
- The answers are DICOM JSON. A server that leaves out the `vr` of an element, such as a static WADO server, is accepted. OHIF's public server works.
- **Local files** work too, and they never leave the machine.

Not supported:

- WADO-URI (`?requestType=WADO`).
- STOW-RS, which uploads images.
- A study list or a search across studies (QIDO at the study level). The viewer shows the study you name. Your page finds the study.
- A DIMSE connection (C-FIND, C-MOVE). Put a DICOMweb gateway in front of such a server.
- OHIF's `?StudyInstanceUIDs=` address. The viewer does not read the page address: read it in your page, check it, and pass it as `study-uid`.

The browser talks to the DICOMweb server directly. The server must **allow your page's origin (CORS)**, and it must accept the headers you send (such as `Authorization`), including the preflight request. If it cannot, put a proxy on your own origin and point `wadoRoot` at it.

### Security: what the package does, and what you do

**You** are responsible for who may see what. The package has no login and makes no access decisions:

- Sign users in, and decide which studies each user may open.
- Give the viewer a short-lived token that only allows what that user may see (see [Sign-in and tokens](#sign-in-and-tokens)), and make the server check it. A viewer in a browser can be changed by its user, so a rule that only the viewer follows is not a rule.
- Serve the page and the images over HTTPS, set CORS, and set a Content Security Policy. [The installing guide](docs/guides/installing.md) lists what the viewer needs from it.
- Keep patient data rules (privacy law, audit logs, retention) in your product. See also the notice at the top of this file.

**The package** handles the data it is given with care:

- It does not store your token. It asks your `getRequestHeaders` function for every request, and it never puts a token in a link.
- A UID that comes from a link or from your code is checked before it reaches a request path.
- What a server sends is checked against a schema, so a wrong answer is an error with a message.
- The overlay hides every tag that can identify a patient (names, ids, dates of birth, accession numbers, institution, physicians, and private tags) while `showPatientInfo` is off, and it is off by default. A config can set `showPatientInfo`, but an overlay item that names such a tag shows nothing while it is off. Decide who may turn it on: it is a setting of the host.
- Text from a DICOM file is shown as text, never as markup.
- A config loaded from a URL must come from an origin you list, is fetched without cookies, is refused if the server redirects, and has a size limit.
- The package sends no analytics and no usage data. Its requests go to your DICOMweb server, to the config URL if you set one, and to the worker and WASM files if you serve them yourself. Check this in the network panel of your browser.
- A saved or shared viewer state (`encodeViewerState`) has UIDs, the layout, the slice, the window, and the zoom. It has no names and no token.

To report a vulnerability, read [SECURITY.md](SECURITY.md). Do not post patient data in an issue.

### Errors and logging

The package does not log and does not send errors anywhere. It reports them as events, and your project decides what to do with them:

```ts
// <dv-viewer>
element.addEventListener('dv-error', (event) => {
  const { error, context } = (event as CustomEvent<{ error: Error; context: string }>).detail;
  myLogger.error({ context, message: scrub(error.message), status: Reflect.get(error, 'status') });
});

// The viewer object (all frameworks)
viewer.on('error', ({ error, context }) => myLogger.error({ context, message: scrub(error.message) }));
```

In React and Vue, `onError` receives only the `Error`, not the `context` (the `status` of a data-source error is on the error, so you can read it). `dv-error` and `viewer.on('error')` carry the `context`. The `context` says where the error came from. `<dv-viewer>` reports `load`, `config`, `drop`, `series`, `toolbar`, `panel`, `attach`, `cine`, `keyboard`, `measurement`, and `segmentation`. `viewer.on('error')` reports only `attach`, `cine`, `keyboard`, `measurement`, and `segmentation`. An error from the data source has the HTTP `status` of the answer (a 401 or 403 means the server refused). A 403 and a 404 are not tried again, and a 5xx is tried again twice.

Error messages and request paths can contain Study, Series, and SOP Instance UIDs. If your rules count those as identifying, remove them before an error leaves the page:

```ts
const scrub = (text: string): string => text.replace(/\b\d+(?:\.\d+){2,}\b/g, '<uid>');
```

The pattern hides every run of three or more numbers joined by dots. That covers every real UID, including the short `2.25.<number>` form. It also hides version numbers, which does no harm in a log.

**Events are not everything.** An event reports what the viewer does by itself: loading from the attributes of `<dv-viewer>`, attaching, the keys, cine, and the panels. When your own code calls the API with `await`, a failure rejects that promise and is **not** sent as an event. This is true of `viewer.loadStudy()`, `viewer.setViewportSeries()`, `viewport.cine.play()`, and the other calls that return a promise, including an HTTP 401 or 403 from the server. Catch those yourself and send them to the same logger:

```ts
try {
  await viewer.loadStudy(studyInstanceUid);
} catch (error) {
  myLogger.error({ context: 'loadStudy', message: scrub(String(error)) });
}
```

What else you can see (events about use, timing, requests) and what you cannot is in the [observability guide](docs/guides/observability.md).

The viewer also shows the message of an error to the user, in its own error panel, and writes one `console.warn` when the compute worker cannot run and the work moves to the page.

## Customizing

Everything below is optional. The viewer works with the data source and the study UID only.

### Window presets

A window preset is a brightness and contrast setting for CT, such as "Lung" or "Bone". The menu with the sliders icon in the toolbar lists them, and the number keys `1` to `9` choose the first nine. Pass your own list in `windowLevelPresets`. The list replaces the built-in one, so to add to it, start with `DEFAULT_WINDOW_PRESETS`:

```ts
import { DEFAULT_WINDOW_PRESETS, type ViewerOptions } from '@01x/dicom-viewer-core';

const options: ViewerOptions = {
  dataSource,
  windowLevelPresets: [
    ...DEFAULT_WINDOW_PRESETS, // lung, soft tissue, bone, brain, liver
    { id: 'mediastinum', label: 'Mediastinum', center: 50, width: 350 },
  ],
};
```

Each preset needs an `id` that is unique, a `label`, a `center` and a `width` in Hounsfield units. The `width` must be above zero. A preset that breaks these rules throws a `RangeError` that says which one. Presets are set when the viewer starts. To change the list later, put a layer with new `windowLevelPresets` on with `viewer.config.apply` (see "Settings as a config file"), or create the viewer again. You can apply a preset from code with `viewer.viewports.get('vp-0')?.applyWindowPreset('mediastinum')`.

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

An action is one of `scroll`, `scroll-to`, `zoom`, `invert`, `reset`, `cine`, `tool`, `preset`, and `delete-measurement`. The type `KeyAction` in `@01x/dicom-viewer-core` lists the fields of each.

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
import { TOOLBAR_ACTIONS, type ToolbarItem } from '@01x/dicom-viewer-elements';

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

### Settings as a config file

Most of the settings above can also be written as data, in one JSON file that you can keep apart from your code, edit without a build, and share between pages. The file has a `version` and any of these keys: `theme`, `palette`, `toolbar`, `keybindings`, `overlay`, `panels`, `windowLevelPresets`, and `tools`. An editor completes and checks it if you point it at the schema that ships with the package (`@01x/dicom-viewer-core/viewer-config.schema.json`):

```json
{
  "$schema": "./node_modules/@01x/dicom-viewer-core/schema/viewer-config.schema.json",
  "version": 1,
  "palette": "navy",
  "toolbar": {
    "labels": "inline",
    "items": [
      { "type": "tool", "tool": "window-level" },
      { "type": "tool", "tool": "pan", "label": "Move" },
      { "type": "separator" },
      { "type": "command", "id": "zoom-in", "label": "Zoom in", "icon": "zoom-in", "command": "view.zoomIn" },
      {
        "type": "menu",
        "id": "windows",
        "label": "Windows",
        "icon": "presets",
        "items": [
          { "id": "mediastinum", "label": "Mediastinum", "command": "preset.apply", "args": { "id": "mediastinum" } }
        ]
      }
    ]
  },
  "keybindings": { "m": { "type": "tool", "tool": "pan" }, "r": null },
  "windowLevelPresets": [{ "id": "mediastinum", "label": "Mediastinum", "center": 50, "width": 350 }],
  "overlay": {
    "corners": {
      "topRight": [
        { "id": "kvp", "kind": "tag", "tag": "KVP", "label": "kVp", "format": "number" },
        { "id": "size", "kind": "remove" }
      ]
    }
  },
  "panels": { "hide": ["segmentations"] }
}
```

How to give it to the viewer:

- **In your code:** `config` on `<dv-viewer>` (a property, or an attribute with the JSON text), `config` in React and Vue, and `config` in the options of `createViewer`. Give several layers as an array, and the last one wins.
- **From a file:** `config-url` (`configUrl`). It works only for origins that you list in `config-origins` (`configOrigins`), so a URL that comes from outside cannot send the viewer to a server of someone else's choosing. Add `location.origin` to allow the page's own server. The file is read as data, is limited to 256 KB, and is never run. No cookies go with the request.
- **Who wins:** a setting you write in code (a prop such as `theme`, `palette`, or `toolbar`, or an option such as `keybindings`) wins over the config, and a config you give in code wins over one from `config-url`. A layer put on later with `viewer.config.apply(...)` wins over all of them.

A config that has a problem is refused as a whole, and the viewer starts without it. You get a `dv-error` (or `onError`, which has the error but not the context) for the `config` context, and a message that names the path of each problem, such as `toolbar.items.2.command: There is no command "acme.export".` Check the file against the schema in your editor first, and you will rarely see one.

**What a toolbar button can run.** A button names a command. The built-in ones are `tool.set` (with `{ "tool": "pan" }`), `view.zoomIn`, `view.zoomOut`, `view.invert`, `view.reset`, `cine.toggle`, and `preset.apply` (with `{ "id": "bone" }`). To add one of your own, give it a name with a namespace, such as `acme.export`, in the `commands` option (or the `commands` prop), and the config can then name it. A config is data, so it cannot hold a function.

```ts
const options: ViewerOptions = {
  dataSource,
  commands: {
    'acme.export': ({ viewer }) => download(JSON.stringify(viewer.measurements.exportJson())),
  },
};
```

**Lines over the picture.** Each corner of the overlay is a list of items. The built-in lines are `patientName`, `patientId`, `series`, `modality`, `size`, `window`, `zoom`, `inverted`, and `image`. An item with the id of an existing one replaces it in its place, a new id adds a line at the end of the corner, and `{ "id": "size", "kind": "remove" }` takes one out. A `tag` item shows a DICOM tag of the image on screen, by keyword (`KVP`, `SeriesDescription`, and about 50 more) or as eight hex digits (`"00181030"`), with an optional `label` and a `format` of `text`, `date`, `time`, `number` (with `decimals`), or `person-name`. A tag the image does not have shows no line. **A tag that can identify a patient never shows unless `overlay.showPatientInfo` is on**, whatever the items say. That covers every tag of the groups about the patient, the request, the visit, the procedure, and the report (0010, 0032, 0038, 0040, and 4008), the physicians and their identification sequences, the institution, the accession number, and every private tag.

**Changing the settings while the viewer runs.** `viewer.config.apply(layer)` puts a layer over what is in force and returns a function that takes it off. The keys, the window presets, the overlay, and the shell (palette, panels, toolbar) change at once. A layer with a problem throws a `RangeError` and changes nothing. `viewer.config.get()` shows what is in force, and the `config:changed` event tells you when it changes.

```ts
const off = viewer.config.apply({ version: 1, palette: 'graphite', overlay: false });
// ... later
off(); // the viewer is as it was
```

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

The state of the viewer (layout, and in each viewport the series, plane, slice, window, and zoom) is `viewer.getState()`, and `viewer.subscribe` and `viewer.on(...)` tell you when it changes. React and Vue take it as a controlled `state` prop (with `onStateChange` in React and `@state-change` in Vue): the viewer shows the state it is given, and a state that is the one it is in changes nothing.

### Layouts, planes, and hanging protocols

```ts
await viewer.setLayout('2x2'); // '1x1' | '1x2' | '2x2' | '1+3'; the viewports are vp-0 to vp-3
await viewer.setViewportSeries('vp-1', seriesInstanceUID, { orientation: 'coronal' });
await viewer.showMpr(); // axial, sagittal, coronal, and the slices, of the series on screen

viewer.viewports.get('vp-1')?.mpr; // { requested: 'coronal', mode: 'volume' }, or mode: 'stack' with a reason
await viewer.tools.setActive('crosshairs'); // click in one plane, and the others go to that point
```

A plane needs the slices to be evenly spaced and square to the direction they are stacked in, and its volume (about four bytes a voxel) must fit `memory: { maxCacheBytes }` (1 GiB, or 512 MiB on a small device). When it cannot, the viewport shows the slices, `viewport.mpr.reason` says why (`tilted`, `non-uniform-spacing`, `over-memory-budget`, and five more), and the shell writes it in the viewport. The window and the inversion are shared between the planes of one volume. Measurements are drawn on slices, not on planes.

A hanging protocol is plain data. The best fit for the study is applied when the page asks for no series and none is restored:

```ts
import { DEFAULT_HANGING_PROTOCOLS } from '@01x/dicom-viewer-core';

createViewer({
  dataSource,
  hangingProtocols: [
    ...DEFAULT_HANGING_PROTOCOLS,
    {
      id: 'lung-and-bone',
      layout: '1x2',
      priority: 1,
      viewports: [
        { id: 'vp-0', series: { modality: 'CT', descriptionIncludes: 'lung' } },
        { id: 'vp-1', series: { modality: 'CT', pick: 'largest' } },
      ],
    },
  ],
});
// viewer.hangingProtocols.match() says which fits; apply(id?) lays the study out.
```

Drag a series from the series browser onto a viewport to put it there; choosing a row with the keyboard fills the active viewport (the last one you pressed or focused).

## Examples

The `examples` folder has one project for each setup that the tests cover: `vanilla`, `headless` (the core with no interface), `vite-react`, `vite-vue`, `next-app`, and `nuxt`. Each one loads a study from a DICOMweb server. `embedded-card` is not part of the tests: it puts the viewer in a host page card with your own study dropdown, series buttons, window presets, and full screen, and it can read from any DICOMweb server (`?wadoRoot=` and `?study=`). Read the source of an example to see how to wire the viewer into your own project.

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
| `pnpm package-check` | Packs the packages and runs publint and are-the-types-wrong on the tarballs |
| `pnpm size` | Brotli size budgets for every emitted chunk (`.size-limit.json`) |
| `pnpm docs:api` | Builds the API reference (TypeDoc) into `.docs/api`; a broken link in a comment fails it |
| `pnpm visual` | Screenshots ten scenes of the shell and compares them with baselines (see [the guide](docs/guides/visual-regression.md)) |
| `pnpm matrix` | Packs the packages (run `pnpm build` first), installs each example from the packs, builds it, and runs browser tests in Chromium. The `headless` example also generates a 300 MB SEG with uv for the performance check |

`pnpm matrix` needs the Chromium that Playwright installs. To use another Chromium, set the `DV_CHROMIUM` environment variable to its path. Add `--only <name>` to run one example.

### Documentation

- [docs/plan.md](docs/plan.md): the plan, the architecture, and the milestones, with the outcome of each finished milestone.
- [docs/adr](docs/adr): the architecture decisions, one file for each.
- [docs/guides](docs/guides/index.md): guides for installing in a framework, data sources, measurements and segmentations, visual regression, and releasing. `pnpm docs:api` builds the API reference.
- The reports `docs/m1-report.md` to `docs/m8-report.md`: what each milestone proved and what it left open.

### Test data

Tests use only the synthetic phantom in [fixtures/phantom](fixtures/phantom/README.md), generated by [tools/phantom](tools/phantom/phantom.py). Never commit real or licensed imaging data.

```bash
cd tools/phantom
uv run pytest -q
uv run python phantom.py ../../fixtures/phantom
```

## License

MIT. See [LICENSE](LICENSE).
