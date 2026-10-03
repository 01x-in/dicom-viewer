// Stands in for Node's `url` inside the prebundled engine. xmlbuilder2 (via vtk.js) requires it for
// XML features the viewer never uses, but a bundler would otherwise leave a bare `require("url")`.
export const URL: typeof globalThis.URL = globalThis.URL;
export const URLSearchParams: typeof globalThis.URLSearchParams = globalThis.URLSearchParams;
