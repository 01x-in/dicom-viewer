import type { Viewer, ViewportApi } from '@scope/viewer-core';
import '@scope/viewer-elements/define';
import type { DvViewerElement } from '@scope/viewer-elements';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvViewer?: Viewer | undefined;
    __dvError?: string;
  }
}

const params = new URLSearchParams(location.search);
const viewer = document.querySelector<DvViewerElement>('#viewer');
if (viewer === null) throw new Error('missing <dv-viewer>');

viewer.addEventListener('dv-ready', (event) => {
  window.__dv = (event as CustomEvent<{ viewport: ViewportApi }>).detail.viewport;
  window.__dvViewer = viewer.viewer;
  document.documentElement.dataset['dvStatus'] = 'ready';
});
viewer.addEventListener('dv-error', (event) => {
  window.__dvError = (event as CustomEvent<{ error: Error }>).detail.error.message;
  document.documentElement.dataset['dvStatus'] = 'error';
});

const assets = params.get('assets');
if (assets !== null) viewer.assetsBaseUrl = assets;
// The page is 800 by 600 so the tests see the same size every time. `?fill` makes it fill the window.
if (params.has('fill')) {
  viewer.style.width = '100vw';
  viewer.style.height = '100vh';
}
viewer.cpuRendering = params.has('cpu');
// A settings file, from the same server as the images in the tests. It needs its origin listed.
const configUrl = params.get('config');
if (configUrl !== null) {
  viewer.configUrl = configUrl;
  viewer.configOrigins = [new URL(configUrl, location.href).origin];
}
viewer.wadoRoot = params.get('wadoRoot') ?? undefined;
viewer.studyInstanceUid = params.get('study') ?? undefined;
viewer.seriesInstanceUid = params.get('series') ?? undefined;
