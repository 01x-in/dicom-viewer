'use client';

import {
  createDicomWebDataSource,
  type Viewer,
  type ViewportApi,
  type ViewerOptions,
} from '@tushar-im/dicom-viewer-core';
import { DicomViewer } from '@tushar-im/dicom-viewer-react';
import { type JSX, useEffect, useState } from 'react';
import { z } from 'zod';

// The installability matrix drives this page through the query string and reads the result
// back from `data-dv-status` and `window.__dv`.
declare global {
  interface Window {
    __dv?: ViewportApi | undefined;
    __dvViewer?: Viewer | undefined;
    __dvError?: string;
  }
}

interface Config {
  readonly options: ViewerOptions;
  readonly study: string;
  readonly series: string;
  readonly configUrl: string | undefined;
  readonly configOrigins: readonly string[] | undefined;
}

// URL state is external data, so it is validated before it reaches the data source.
const queryState = z.object({
  wadoRoot: z.url(),
  study: z.string().min(1),
  series: z.string().min(1),
  assets: z.string().min(1).optional(),
  // A settings file: a URL, or a path on this page's own server.
  config: z
    .string()
    .min(1)
    .refine((value) => URL.canParse(value, location.href), 'Not a URL')
    .optional(),
});

function fail(message: string): void {
  window.__dvError = message;
  document.documentElement.dataset['dvStatus'] = 'error';
}

export function Viewer(): JSX.Element {
  const [config, setConfig] = useState<Config | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    // params.get keeps the first value of a repeated parameter; Object.fromEntries would keep the last.
    const parsed = queryState.safeParse({
      wadoRoot: params.get('wadoRoot') ?? undefined,
      study: params.get('study') ?? undefined,
      series: params.get('series') ?? undefined,
      assets: params.get('assets') ?? undefined,
      config: params.get('config') ?? undefined,
    });
    if (!parsed.success) {
      fail(`Invalid query string: ${parsed.error.message}`);
      return;
    }
    const { wadoRoot, study, series, assets, config: configUrl } = parsed.data;
    setConfig({
      options: {
        dataSource: createDicomWebDataSource({ wadoRoot }),
        assets: assets === undefined ? { mode: 'inline' } : { mode: 'url', baseUrl: assets },
        cpuRendering: params.has('cpu'),
      },
      study,
      series,
      // A settings file, from the same server as the images in the tests. It needs its origin listed.
      configUrl,
      configOrigins:
        configUrl === undefined ? undefined : [new URL(configUrl, location.href).origin],
    });
  }, []);

  return (
    <div style={{ width: 800, height: 600 }}>
      {config === undefined ? null : (
        <DicomViewer
          options={config.options}
          configUrl={config.configUrl}
          configOrigins={config.configOrigins}
          studyInstanceUID={config.study}
          seriesInstanceUID={config.series}
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
      )}
    </div>
  );
}
