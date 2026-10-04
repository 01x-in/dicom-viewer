'use client';

import {
  createDicomWebDataSource,
  type LoadedSeries,
  type ViewerOptions,
} from '@scope/viewer-core';
import { DicomViewer } from '@scope/viewer-react';
import { type JSX, useEffect, useState } from 'react';
import { z } from 'zod';

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

// URL state is external data, so it is validated before it reaches the data source.
const queryState = z.object({
  wadoRoot: z.url(),
  study: z.string().min(1),
  series: z.string().min(1),
  assets: z.string().min(1).optional(),
});

function fail(message: string): void {
  window.__dvError = message;
  document.documentElement.dataset['dvStatus'] = 'error';
}

export function Viewer(): JSX.Element {
  const [config, setConfig] = useState<Config | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const parsed = queryState.safeParse(Object.fromEntries(params));
    if (!parsed.success) {
      fail(`Invalid query string: ${parsed.error.message}`);
      return;
    }
    const { wadoRoot, study, series, assets } = parsed.data;
    setConfig({
      options: {
        dataSource: createDicomWebDataSource({ wadoRoot }),
        assets: assets === undefined ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
        cpuRendering: params.has('cpu'),
      },
      study,
      series,
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
