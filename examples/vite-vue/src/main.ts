import {
  createDicomWebDataSource,
  type Viewer,
  type ViewportApi,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-vue';
import { createApp, h } from 'vue';

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
const assets = params.get('assets');
const options: ViewerOptions = {
  dataSource: createDicomWebDataSource({ wadoRoot: params.get('wadoRoot') ?? '' }),
  assets: assets === null ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
  cpuRendering: params.has('cpu'),
};

// A settings file, from the same server as the images in the tests. It needs its origin listed.
const configUrl = params.get('config') ?? undefined;
const configOrigins =
  configUrl === undefined ? undefined : [new URL(configUrl, location.href).origin];

createApp({
  render: () =>
    h('div', { style: 'width:800px;height:600px' }, [
      h(DicomViewer, {
        options,
        configUrl,
        configOrigins,
        studyInstanceUid: params.get('study') ?? '',
        seriesInstanceUid: params.get('series') ?? '',
        onReady: (viewer: Viewer, viewport: ViewportApi | undefined) => {
          window.__dv = viewport;
          window.__dvViewer = viewer;
          document.documentElement.dataset['dvStatus'] = 'ready';
        },
        onError: (error: Error) => {
          window.__dvError = error.message;
          document.documentElement.dataset['dvStatus'] = 'error';
        },
      }),
    ]),
}).mount('#app');
