import { createViewer, type LoadedSeries, type ViewerOptions } from '@scope/viewer-core';
import { type CSSProperties, type JSX, useEffect, useRef } from 'react';

export interface DicomViewerProps {
  readonly options: ViewerOptions;
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
  readonly onReady?: (series: LoadedSeries) => void;
  readonly onError?: (error: Error) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * M1 spike of the React adapter. The viewer is created in an effect, so nothing touches the
 * browser during SSR and Next.js hosts need no `dynamic(..., { ssr: false })`.
 */
export function DicomViewer(props: DicomViewerProps): JSX.Element {
  const { studyInstanceUID, seriesInstanceUID, className, style } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  // Callbacks and options change identity every render; the effect must not restart for them.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    const viewer = createViewer(latest.current.options);
    viewer.loadSeries(host, studyInstanceUID, seriesInstanceUID).then(
      (series) => {
        if (!cancelled) latest.current.onReady?.(series);
      },
      (error: unknown) => {
        if (!cancelled) {
          latest.current.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
    return (): void => {
      cancelled = true;
      viewer.destroy();
    };
  }, [studyInstanceUID, seriesInstanceUID]);

  return (
    <div ref={hostRef} className={className} style={{ width: '100%', height: '100%', ...style }} />
  );
}
