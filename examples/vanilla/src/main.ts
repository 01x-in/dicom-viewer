import type { ViewportApi } from '@scope/viewer-core';
import '@scope/viewer-elements/define';
import type { DvViewerElement } from '@scope/viewer-elements';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvError?: string;
  }
}

const params = new URLSearchParams(location.search);
const viewer = document.querySelector<DvViewerElement>('#viewer');
if (viewer === null) throw new Error('missing <dv-viewer>');

viewer.addEventListener('dv-ready', (event) => {
  window.__dv = (event as CustomEvent<{ viewport: ViewportApi }>).detail.viewport;
  document.documentElement.dataset['dvStatus'] = 'ready';
});
viewer.addEventListener('dv-error', (event) => {
  window.__dvError = (event as CustomEvent<{ error: Error }>).detail.error.message;
  document.documentElement.dataset['dvStatus'] = 'error';
});

const assets = params.get('assets');
if (assets !== null) viewer.assetsBaseUrl = assets;
viewer.cpuRendering = params.has('cpu');
viewer.wadoRoot = params.get('wadoRoot') ?? undefined;
viewer.studyInstanceUid = params.get('study') ?? undefined;
viewer.seriesInstanceUid = params.get('series') ?? undefined;
