import {
  createDicomWebDataSource,
  type ViewportApi,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-vue';
import { createApp, h } from 'vue';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: ViewportApi;
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

createApp({
  render: () =>
    h('div', { style: 'width:512px;height:512px' }, [
      h(DicomViewer, {
        options,
        studyInstanceUid: params.get('study') ?? '',
        seriesInstanceUid: params.get('series') ?? '',
        onReady: (series: ViewportApi) => {
          window.__dv = series;
          document.documentElement.dataset['dvStatus'] = 'ready';
        },
        onError: (error: Error) => {
          window.__dvError = error.message;
          document.documentElement.dataset['dvStatus'] = 'error';
        },
      }),
    ]),
}).mount('#app');
