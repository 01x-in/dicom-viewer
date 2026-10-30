# Observability

This guide says what a host project can see of the viewer, how to send it to your own logging and metrics, and what you cannot see today.

The viewer does not log, count, or send anything itself. It gives your code events and promises. You decide what to record, where to send it, and what to remove first. See [Servers, security, and errors](../../README.md#servers-security-and-errors) for who is responsible for what.

## What you can see

| What | Where it comes from | What it tells you |
|---|---|---|
| Errors the viewer finds by itself | `dv-error` (the element), `onError` (React and Vue), `viewer.on('error')` | Something failed that no call of yours is waiting for |
| Failures of calls you make | The promise that you `await` | The call failed, for example `viewer.loadStudy()` with an HTTP 401 |
| What the user and your code do | `viewer.on(...)` events | Slice, window, zoom, tool, layout, and state changes |
| Requests to the server | Your `getRequestHeaders` and `onUnauthorized` functions, and the `fetch` option | A request was made, or the server answered 401 |

### Errors

`dv-error` and `viewer.on('error')` carry `{ error, context }`. The `onError` of the React and Vue components is called with the `error` only: the `context` is not passed to it. To get the `context` in React or Vue, use `viewer.on('error')` from `onReady` (it has the contexts `attach`, `cine`, `keyboard`, `measurement`, and `segmentation`), or add a `dv-error` listener on the component's `dv-viewer` element. The `context` says where the error came from. The element reports more places than the viewer object, because the element also loads the study, the config, and the panels:

| `context` | Reported by | Meaning |
|---|---|---|
| `load` | `<dv-viewer>` | The study or series named by its attributes could not be loaded or shown |
| `config` | `<dv-viewer>` | A config (from `config`, or from `config-url`) was refused, or could not be fetched |
| `drop` | `<dv-viewer>` | A series dragged from the series browser onto a viewport could not be shown |
| `series`, `toolbar`, `panel` | `<dv-viewer>` | The series browser, a toolbar action, or a panel failed |
| `attach` | `viewer.on('error')` and `dv-error` | A viewport could not attach to its element, or restoring the state at attach failed |
| `cine`, `keyboard` | `viewer.on('error')` and `dv-error` | Cine playback stopped on an error, or a key action failed |
| `measurement`, `segmentation` | `viewer.on('error')` and `dv-error` | A measurement or a SEG action failed |

An error from the data source has a `status`, the HTTP status of the answer (a 401 or 403 means the server refused; a 404 means it does not have the object). Read it with `Reflect.get(error, 'status')` when you do not want to import the error class.

### Failures of your own calls

An event reports what the viewer does by itself. A call that you `await` reports its failure to you, and does **not** send an event. This is true of `viewer.loadStudy()`, `viewer.setViewportSeries()`, `viewport.cine.play()`, and every other call that returns a promise. Catch these yourself and send them to the same place:

```ts
async function logged<T>(name: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    report({ context: name, message: scrub(String(error)), status: Reflect.get(Object(error), 'status') });
    throw error;
  }
}

const study = await logged('loadStudy', () => viewer.loadStudy(studyInstanceUid));
```

### Events about use

`viewer.on(name, handler)` returns a function that removes the handler. The events with a payload that is useful for analytics:

| Event | Payload (fields) | Use it for |
|---|---|---|
| `study:loaded` | `study` | Counting studies opened. Do not send the whole `study`: it holds UIDs and series descriptions |
| `viewport:image` | `viewportId`, `imageIndex`, `imageCount`, `sopInstanceUID`, `origin` | Scroll depth, and time to the first image (see below). Do not log or send `sopInstanceUID`: it is a UID of the instance on screen |
| `viewport:voi` | `viewportId`, `window`, `invert`, `origin` | Window presets and inversion in use |
| `viewport:camera` | `viewportId`, `zoom`, `origin` | Zoom use |
| `viewport:cine` | `viewportId`, `playing`, `fps` | Cine use |
| `tool:active` | `tool`, `previous` | Which tools people use |
| `state:changed` | `state`, `previous`, `origin` | Any change, as one stream |
| `config:changed` | `config` | Which config is in force |

`origin` says who made a change: `user` is the mouse, `api` is a call from your code (and keys, presets, and cine), `url` is a state restored from a link, and `init` is the first state.

## Wiring it up

This sends errors and a few events to your own functions `report` (a logger) and `track` (a metrics call). Both are yours. It removes UIDs from every message first:

```ts
// A UID is three or more numbers joined by dots. This also hides version numbers, which does no harm in a log.
const scrub = (text: string): string => text.replace(/\b\d+(?:\.\d+){2,}\b/g, '<uid>');

element.addEventListener('dv-error', (event) => {
  const { error, context } = (event as CustomEvent<{ error: Error; context: string }>).detail;
  report({ context, message: scrub(error.message), status: Reflect.get(error, 'status') });
});

element.addEventListener('dv-ready', (event) => {
  const { viewer } = (event as CustomEvent<{ viewer: Viewer }>).detail;
  viewer.on('tool:active', ({ tool }) => track('viewer_tool', { tool }));
  viewer.on('viewport:cine', ({ playing }) => track('viewer_cine', { playing }));
  viewer.on('viewport:voi', ({ origin, invert }) => track('viewer_window', { origin, invert }));
});
```

Add the handlers when the viewer is ready. `viewer.on` returns a function that removes the handler, so call it in `dv-teardown` if your page keeps running after the viewer is gone.

### Time to the first image

The viewer has no timer. Measure it from your own call to the first `viewport:image`:

```ts
const started = performance.now();
const off = viewer.on('viewport:image', () => {
  off();
  track('viewer_first_image_ms', { ms: Math.round(performance.now() - started) });
});
await viewer.loadStudy(studyInstanceUid);
await viewer.setViewportSeries('vp-0', seriesInstanceUid);
```

### Requests to the server

- `getRequestHeaders` is called for every request, including the frame requests of the image loader. `onUnauthorized` is called after a 401. You can count requests and refreshes in them, but you do not get the status or the duration of a request that worked.
- The `fetch` option of `createDicomWebDataSource` takes your own `fetch`. A function that wraps it sees the requests of the data source itself: the series list, the series metadata, and whole-instance retrieval (SEG and SR). It does **not** see frame requests: the image loader makes those, and it only takes its headers from `getRequestHeaders`. The option is described in the source as made for tests. It works for this, and it is not part of a promise to keep the same behavior.

```ts
const timed: typeof fetch = async (input, init) => {
  const started = performance.now();
  const response = await fetch(input, init);
  track('dicomweb_request', { status: response.status, ms: Math.round(performance.now() - started) });
  return response; // do not put the URL in the event: it holds UIDs
};
const dataSource = createDicomWebDataSource({ wadoRoot, fetch: timed, getRequestHeaders });
```

## What to keep out of your logs

- Study, Series, and SOP Instance UIDs, if your rules count them as identifying. They are in request paths and in many error messages.
- The `study` of `study:loaded`, the `sopInstanceUID` of `viewport:image`, and any DICOM tag. Series descriptions are free text that a person typed.
- Tokens and the headers from `getRequestHeaders`.
- Patient names, ids, and dates, whether they come from an overlay, from measurements you export, or from a screenshot.

## What you cannot see today

These are not in the package. Each has the workaround written above, and none of them is promised:

- **A callback for every request**, with the status, the duration, and the number of retries, for the image requests as well. Retries after a 5xx and the refresh after a 401 are silent.
- **Timing marks** such as time to the first image. Measure them yourself as shown.
- **A stable code on an error.** An error is an `Error` with a message, a `context`, and for the data source a `status`. Do not match on the text of a message: it can change between versions.
- **Errors inside the rendering engine** (Cornerstone) that the viewer does not catch. Watch `window.onerror` and `unhandledrejection` on your page as well.
