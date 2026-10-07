# ADR 0010: The shell's look is icons, tokens, and palettes, with no change to what the pieces do

Status: accepted (M6.5). Builds on [ADR 0007](0007-styled-shell.md) (chrome in shadow DOM, every colour a `--dv-*` token).

## Context

After M6 the shell worked, passed axe, and could be used from the keyboard, but it looked plain: a toolbar of text buttons, a Segments list whose names broke one letter to a line in a 17 rem dock, and an overlay in a monospace font. OHIF's viewer is the reference a host compares it with, and the host can be anything from a hospital portal to a small tool, so the colours must be the host's choice.

## Decision

- **The icons are ours.** [icons.ts](../../packages/elements/src/icons.ts) holds 28 pictures on a 24 by 24 grid, drawn for this package, as plain strings written in the source and nowhere else. A picture is an inline SVG that takes the colour of its text and is hidden from assistive technology. No icon font, no icon package, and nothing copied from OHIF.
- **A button with a picture is named by its `aria-label`.** The built-in toolbar buttons show only the picture, with the name and the bound key in a tooltip. The tooltip is not what names the button, so it adds nothing a screen reader needs. It opens on hover and on keyboard focus, stays open while the pointer is on it, and closes on Escape until the pointer or the focus moves on (WCAG 1.4.13). `labels="inline"` on `<dv-toolbar>`, `toolbar-labels` on `<dv-viewer>`, and `toolbarLabels` in React and Vue put the name beside the picture. An item with no `icon` shows its label as text, so a host's own actions still work.
- **The key in a tooltip is the key that is bound.** `viewer.tools.shortcuts()` lists the chords of the keymap, with the host's changes, and is empty when the keyboard is off. A tool, or an action that says which key action it stands for (`shortcut`), prints its own key. `aria-label` stays the name, so a rebinding changes no accessible name.
- **A menu button shows the picture of the entry that is chosen.** The Measure button is the ruler until a tool is chosen, and then that tool's picture, filled like the active tool.
- **Two kinds of "on".** The tool the left button drives, and a menu with a chosen entry, are filled with the accent. A switch that is on (invert, cine) is outlined, so they cannot be mistaken for the active tool.
- **A palette is a set of colours for both themes.** `palette` on `<dv-viewer>` is `default`, `navy` (deep blue with a cyan accent), or `graphite` (neutral with a teal accent). The default is what the shell always was. Every palette is tested against the same contrast minimums as the default, in both themes. A host can still change any single colour with its own `--dv-color-*` property, which wins over a palette, or add a palette by writing the same tokens; `styles.css` carries every palette for a host's own page.
- **New tokens.** `--dv-font-mono`, `--dv-radius-lg`, `--dv-icon-size`, `--dv-control-size`, and `--dv-color-overlay-accent` (the tint of the series line, which does not change with the theme, because the picture is black in both).
- **The dock folds.** A button at the end of the tab row folds a dock to a strip of pictures down its edge, and a click on a tab opens it again. Folding hides the panels but does not unmount them. The built-in panels have pictures; a panel of the host's has its title only (a panel definition has no icon yet). In a dock narrower than 24 rem only the open tab shows its name, and the others are pictures with a tooltip, so any number of tabs fit. The collapse button is outside the tab list, which holds tabs only.
- **The Segments panel keeps its hooks and changes its parts.** Visibility is still a real checkbox, drawn as an eye; the colour is still a colour input, drawn as a round swatch; Highlight and Go to are icon buttons with a name and a tooltip. The names are plain text in a column that can shrink, so they wrap whole. A warning has a picture and, for a screen reader, the word "Warning". The `data-*` attributes and class names that the tests and the matrix use did not change, apart from how the matrix finds the Segments tab (by its panel, since an unopened tab has no text).
- **The overlay takes the shell's font and tint.** The series line is tinted, the modality and size are bold, digits are tabular so numbers do not jitter while the slices scroll, and the font is `--dv-font-family` when the viewport is inside a `<dv-viewer>` and the system font when it is not. The text did not change.
- **A SEG loads when its series is not on screen.** The port's `loadSegmentation` takes the stack, not a list of image ids. The engine tells Cornerstone what the images' headers say for the images no stack holds, and keeps them until the SEG is disposed. Before this, pressing Load on a SEG whose CT was not the one on screen failed with `Cannot read properties of undefined (reading 'rows')`, and the panel offered Load for every SEG of the study.

## Evidence

Unit tests cover the palettes (same names in both themes, contrast, the order of the CSS), the toolbar (a picture on every built-in button, names, tooltips and keys, rebinding, no key when the keyboard is off, `inline`, Escape, the Measure picture), the dock (pictures, fold and open, names, the tab list holds tabs only), the Segments panel, the overlay, and `viewer.tools.shortcuts()`. The `segmentation` scenario of the matrix loads a SEG while the other series is on screen, and then reads its colours when its own series comes.

## Consequences

- **No visual regression suite yet.** The look was checked by eye in a browser. Screenshots are M8.
- **The tooltip uses `:has()`**, which every current browser has. In an older one the tooltip stays hidden, and the `aria-label` is still there.
- **A host's own panels have no picture** until `PanelDefinition` gets an `icon`.
- **Only three palettes.** A fourth is a block of tokens in `tokens.ts`.
- **The key of an action is the first one bound**, so zoom in prints `+` and not `=`.
