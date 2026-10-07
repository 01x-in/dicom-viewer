import {
  createDicomWebDataSource,
  type Viewer,
  type ViewportApi,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-react';
import { type JSX, StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvViewer?: Viewer | undefined;
    __dvError?: string;
  }
}

function App(): JSX.Element {
  const params = new URLSearchParams(location.search);
  const options = useMemo<ViewerOptions>(() => {
    const assets = params.get('assets');
    return {
      dataSource: createDicomWebDataSource({ wadoRoot: params.get('wadoRoot') ?? '' }),
      assets: assets === null ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
      cpuRendering: params.has('cpu'),
    };
  }, []);

  // A settings file, from the same server as the images in the tests. It needs its origin listed.
  const configUrl = params.get('config') ?? undefined;
  const configOrigins = useMemo(
    () => (configUrl === undefined ? undefined : [new URL(configUrl, location.href).origin]),
    [configUrl],
  );

  return (
    <div style={{ width: 800, height: 600 }}>
      <DicomViewer
        options={options}
        configUrl={configUrl}
        configOrigins={configOrigins}
        studyInstanceUID={params.get('study') ?? ''}
        seriesInstanceUID={params.get('series') ?? ''}
        onReady={(viewer, viewport) => {
          window.__dv = viewport;
          window.__dvViewer = viewer;
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
