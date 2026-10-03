import {
  createDicomWebDataSource,
  type LoadedSeries,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-react';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: LoadedSeries;
    __dvError?: string;
  }
}

function App() {
  const params = new URLSearchParams(location.search);
  const options = useMemo<ViewerOptions>(() => {
    const assets = params.get('assets');
    return {
      dataSource: createDicomWebDataSource({ wadoRoot: params.get('wadoRoot') ?? '' }),
      assets: assets === null ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
      cpuRendering: params.has('cpu'),
    };
  }, []);

  return (
    <div style={{ width: 512, height: 512 }}>
      <DicomViewer
        options={options}
        studyInstanceUID={params.get('study') ?? ''}
        seriesInstanceUID={params.get('series') ?? ''}
        onReady={(series) => {
          window.__dv = series;
          document.documentElement.dataset['dvStatus'] = 'ready';
        }}
        onError={(error) => {
          window.__dvError = error.message;
          document.documentElement.dataset['dvStatus'] = 'error';
        }}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
