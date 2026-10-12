# ADR 0011: One serializable config, named commands, and layers

Status: accepted (M6.6). Builds on [ADR 0004](0004-viewer-state-and-ordering.md) (every change goes through one queue), [ADR 0007](0007-styled-shell.md) (slots, panels, tokens), and [ADR 0010](0010-shell-polish.md) (palettes).

## Context

A host sets up the viewer today in four places: `ViewerOptions` (keybindings, overlay, window presets, prefetch), attributes and props on `<dv-viewer>` (theme, palette, which panels to hide, toolbar labels), a `toolbar` array of items, and slots. That is easy to write in code and hard to move around. The toolbar items hold functions (`run`, `pressed`), so a toolbar cannot be written as JSON or HTML. The text on the overlay is fixed in code. A deployment cannot keep its settings in a file, and OncoTrace will receive settings from outside the page.

OHIF is the reference (the customization service docs in `platform/docs/docs/platform/services/customization-service` of [OHIF/Viewers](https://github.com/OHIF/Viewers)). Its configurable layer has six ideas:
1. One `window.config` object, mostly data.
2. A command registry, so a toolbar button names a command and gives its options as data.
3. Named customization points with defaults that a part of the viewer owns (`viewportOverlay.topLeft`), and a host overrides them by id.
4. Layers (bootstrap, global, mode) applied in a fixed order, and a mode's changes are reverted when it ends.
5. Features that are opt-in, with no cost when off.
6. Customization files that are data, loaded from an allowlist, and never executed.

We keep the ideas and leave out the mechanisms. OHIF merges with `$set`, `$push`, and `$apply` operations, and uses `inheritsFrom` and `$transform` functions. These are hard to type, and a function in a config file is code from outside.

## Decision

- **`ViewerConfigV1` is one JSON-serializable object, checked by Zod.** It has `version: 1` and these optional keys: `theme`, `palette`, `toolbar` (`labels`, `hidden`, `items`), `keybindings`, `overlay`, `panels` (`hide`), `windowLevelPresets`, and `tools` (`active`). `prefetch`, `assets`, the data source, and sign-in are not in the config: they are how the page talks to a server and to the engine, so they stay in code. Unknown keys are an error, so a typo is found, not ignored. A JSON Schema is generated from the Zod schema, for editors.
- **Where it goes in.** `createViewer({ config })`, `<dv-viewer config>` (a property, or an attribute with JSON), `config` in React, and `config` in Vue. `viewer.config.get()` returns what is in force: every layer merged, with the defaults filled in.
- **The code wins over the config.** Precedence, last wins: built-in defaults, then the config layers given at the start in order, then the options and props written in code, then layers applied later with `viewer.config.apply`. A call to `apply` is code too, and a later call is a later decision. A config can come from outside the page, so the host's own code must be able to overrule it. The existing options and props stay, unchanged, and `hideSeriesPanel` and the other two become aliases of `panels.hide`.
- **Commands are a registry.** `viewer.commands` has `register(id, command)`, `run(id, args, { viewportId })`, `has(id)`, and `list()`. A command is a function, or `{ run, pressed?, enabled? }` when a button needs to show that it is on or off. The built-ins are the ones the toolbar uses: `tool.set`, `view.zoomIn`, `view.zoomOut`, `view.invert`, `view.reset`, `cine.toggle`, and `preset.apply`. Each checks its own arguments. A command runs through the same queue as the API it calls (ADR 0004), so it adds no new path to the engine. A host registers its own, and a config names it.
- **The toolbar can be data.** A config item is `{ type: 'tool', tool }`, `{ type: 'command', id, label, icon?, command, args? }`, `{ type: 'menu', ... }` with entries of the same kind, or `{ type: 'separator' }`. The shell turns it into the `ToolbarItem` it already draws. A toolbar in a later layer replaces the earlier one, because items such as separators have no id to merge by. The code form (`run`, `pressed`, `custom`) stays for what data cannot say, and is not allowed in a config. `icon` is a name from `icons.ts`. A command that is not registered is an error when the config is read, not when the button is pressed.
- **The overlay is a list of items for each corner.** An item is `{ id, kind: 'builtin', name }` (`series`, `size`, `window`, `zoom`, `image`, `modality`), or `{ id, kind: 'tag', tag, label?, format? }`, where `tag` is a keyword or a DICOM tag and `format` is `text`, `date`, `time`, `number` (with `decimals`), or `person-name`. An item with the same `id` in a later layer replaces the earlier one in its place, a new `id` is added at the end, and `{ id, kind: 'remove' }` removes one. The built-in names are `patientName`, `patientId`, `series`, `modality`, `size`, `window`, `zoom`, `inverted`, and `image`, and the default items are the ones that give today's text. The text is set as text, never as markup. **Tags that identify a patient** (every tag of the groups about the patient, the request, the visit, the procedure, and the report, which are 0010, 0032, 0038, 0040, and 4008; the physicians and their identification sequences; the institution; the accession number; and every private tag, as a fixed rule in the core) show only when `overlay.showPatientInfo` is on, exactly as now, whatever the config says.
- **Layers can be switched and reverted.** `viewer.config.apply(layer)` merges a layer over the current ones and returns a function that takes it off again. Objects merge key by key. `null` for a top-level key puts it back to the default. Overlay items merge by `id`. Any other array replaces, and so do the window presets. `tools.active` is read when the viewer starts, so a layer given to `apply` may not have it. Chords are written in the spelling the keymap uses before layers are merged, so `Shift+I` and `shift+i` are one key. M7 can use it for layouts, and M9 for the OncoTrace profile. Applying a layer is synchronous. It changes the keys, the window presets, and the text over the pictures, and touches no engine, so it does not go through the queue. A layer is checked, and the keys and presets are worked out, before anything changes, so a layer that cannot work leaves the viewer as it was. The shell redraws from the `config:changed` event.
- **A config can be loaded from a URL, off by default.** `configUrl` on `<dv-viewer>` works only with `configOrigins`, an allowlist of origins. The file is fetched as JSON, limited in size, checked, and never executed. A layer that fails the check is rejected whole, with a `dv-error` that has the context `config` and the path of each problem, and the layers below it stay.
- **The JSON Schema ships.** `viewer-config.schema.json` is made from the same Zod schema (`viewerConfigJsonSchema()`), and a test fails when the shipped file and the schema differ. A config file may name it in `$schema`, which the viewer ignores. The schema says what the shape allows. A command that is registered and a chord that can be pressed are checked when the config is read.
- **Left out:** merge operations such as `$set`, `inheritsFrom`, `$transform`, an extension and mode module system, string namespaces for modules, and functions in a config.

## How it is built

1. The schema, `mergeConfig`, the layers, and the order of precedence, in the core, with tests.
2. The command registry, and the toolbar from a config.
3. The overlay items from a config, with the patient-tag guard.
4. Panels, keybindings, palette, and labels from a config in the element, React, and Vue.
5. `configUrl` with its allowlist, the JSON Schema, a config file in `examples/vanilla`, and the guide.

## Done when

- The same config, as a JSON file, gives the same toolbar, overlay, keys, and palette in vanilla, React, Vue, Next, and Nuxt, and the matrix checks it.
- A config with an unknown key, an unregistered command, or a bad layer is rejected with a message that names the path, and the viewer still starts. A patient tag with `showPatientInfo` off is not rejected: it is accepted and never shown.
- `viewer.config.apply(layer)` and the function it returns leave the toolbar, overlay, and keys as they were.
- No config means the viewer is what it is now: every existing test passes unchanged.

## As built

All five slices are in, one commit each. Where the build differs from the plan above:

- A removal in an overlay corner is `{ id, kind: 'remove' }`, not `{ id, remove: true }`, so the three kinds of item are told apart by `kind` and the JSON Schema is exact.
- `commands` is also an option of `createViewer` (and a prop), so a config given at the start can name a command of the host.
- `<dv-viewer>` reads `theme`, `palette`, and `toolbarLabels` as unset until the page sets them, and then lets the config decide. Before, they started as `dark`, `default`, and `tooltip`, which the page could not tell from a choice. A page that set one of them is unchanged.
- A config that is fine alone but cannot work with the viewer (a toolbar that names a command nobody registered) is reported, and the viewer starts without it, so a mistake in settings does not take the viewer away. `createViewer` itself throws, because there a mistake is a bug in the host's code.
- `cine.toggle` (the command, the toolbar button, and the cine key) goes through one `viewport.cine.toggle()` that decides on what the last call asked for. Reading `playing` first and then calling `play()` let two quick presses both start playback, because the first `play()` was still in the queue.
- While writing the scenario the matrix found that the engine did not tell the viewer when invert alone changed, so the state, the overlay, and the pressed state of a toolbar button were stale after the `i` key. It does now.

## Evidence

Unit tests cover the schema (every key, every path named, strict keys), the merge rules, `viewer.config` (start-up layers, precedence, apply and revert, a layer that cannot work, keys turned on and off for an attached element, overlay switched), the commands, the toolbar as data, the overlay items and the patient-tag guard, the element, React, and Vue, and `config-url` (allowed, refused, failing, too large, no cookies, no redirect). The `config` scenario of `pnpm matrix` fetches `examples/viewer-config.json` in every example, in `inline` and `url` mode, and checks the palette and theme, the toolbar and its labels, the hidden panel, the lines over the picture (a tag shown, a line taken out, no patient), the keys of the file next to the usual ones, the presets from the menu and from a digit, and a command button, against the real engine.

## Consequences

- **A second way to say the same thing.** The props and the config overlap, and the precedence rule is the only thing that keeps that clear. The guide must show it.
- **A config is not a plugin system.** A host that needs behavior writes a command in code and names it from the config.
- **The overlay item list is a new public shape.** `overlayLines` and `OverlayOptions` stay, and the old options map onto the new items.
- **Decided:** `windowLevelPresets` and `tools.active` are in the config and `prefetch` is not. Layers have no names: `apply` returns the function that takes the layer off, and `viewer.config.get()` shows the result. A name can be added later without breaking anyone.
