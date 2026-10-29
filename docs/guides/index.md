# DICOM viewer guides

The [README](https://github.com/01x-in/dicom-viewer#readme) shows how to put the viewer on a page. These guides go
further, one topic each. The API reference (every exported function, type, and element) is generated from the source
comments by TypeDoc: run `pnpm docs:api` and open `.docs/api/index.html`.

| Guide | Read it when |
|---|---|
| [Tutorial: Next.js](nextjs-tutorial.md) | You are new to the viewer and want a working page in ten minutes, from an empty Next.js app to a study on screen |
| [Installing in a framework](installing.md) | You are adding the viewer to Vite, Next.js, Nuxt, or a plain page, and want to know why it needs no bundler setup, and what to do if a page has a strict CSP |
| [Data sources](data-sources.md) | You are connecting a DICOMweb server (tokens, retries, a server that limits what it hands out), or opening local files |
| [Observability](observability.md) | You are sending the viewer's errors and events to your own logging and metrics, and want to know what you can and cannot see |
| [Measurements and segmentations](measurements-and-segmentations.md) | You are drawing measurements from code, exporting them, or loading DICOM SEG overlays |
| [Visual regression](visual-regression.md) | You are changing how the viewer looks and want to see what moved |
| [Releasing](releasing.md) | You are cutting a version |

Other documents:

- [docs/plan.md](../plan.md) holds the architecture and each milestone's outcome.
- `docs/adr` holds the decisions and why they were made, one file each (for example [ADR 0001, the asset strategy](../adr/0001-asset-strategy.md)).
- The milestone reports (`docs/m1-report.md` to `docs/m8-report.md`) say what each one proved and what it left open.
