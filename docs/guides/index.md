# DICOM viewer guides

The [README](https://github.com/01x-in/dicom-viewer#readme) shows how to put the viewer on a page. These guides go
further, one topic each. The API reference (every exported function, type, and element) is generated from the source
comments by TypeDoc: run `pnpm docs:api` and open `.docs/api/index.html`.

| Guide | Read it when |
|---|---|
| [Installing in a framework](installing.md) | You are adding the viewer to Vite, Next.js, Nuxt, or a plain page, and want to know why it needs no bundler setup, and what to do if a page has a strict CSP |
| [Data sources](data-sources.md) | You are connecting a DICOMweb server (tokens, retries, a server that limits what it hands out), or opening local files |
| [Measurements and segmentations](measurements-and-segmentations.md) | You are drawing measurements from code, exporting them, or loading DICOM SEG overlays |
| [Visual regression](visual-regression.md) | You are changing how the viewer looks and want to see what moved |

Other documents:

- [docs/plan.md](../plan.md) holds the architecture and each milestone's outcome.
- [docs/adr](../adr) holds the decisions and why they were made.
- The milestone reports (`docs/m1-report.md` to `docs/m8-report.md`) say what each one proved and what it left open.
