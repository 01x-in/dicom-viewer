'use client';

import {
  createDicomWebDataSource,
  type LoadedSeries,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-react';
import { type JSX, useEffect, useState } from 'react';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: LoadedSeries;
    __dvError?: string;
  }
}

interface Config {
  readonly options: ViewerOptions;
  readonly study: string;
  readonly series: string;
}

export function Viewer(): JSX.Element {
  const [config, setConfig] = useState<Config | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const assets = params.get('assets');
    setConfig({
      options: {
        dataSource: createDicomWebDataSource({ wadoRoot: params.get('wadoRoot') ?? '' }),
        assets: assets === null ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
        cpuRendering: params.has('cpu'),
      },
      study: params.get('study') ?? '',
      series: params.get('series') ?? '',
    });
  }, []);

  return (
    <div style={{ width: 512, height: 512 }}>
      {config === undefined ? null : (
        <DicomViewer
          options={config.options}
          studyInstanceUID={config.study}
          seriesInstanceUID={config.series}
          onReady={(series) => {
            window.__dv = series;
            document.documentElement.dataset['dvStatus'] = 'ready';
          }}
          onError={(error) => {
            window.__dvError = error.message;
            document.documentElement.dataset['dvStatus'] = 'error';
          }}
        />
      )}
    </div>
  );
}
