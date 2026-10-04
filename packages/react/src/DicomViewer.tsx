import { createViewer, type ViewerOptions, type ViewportApi } from '@scope/viewer-core';
import { type CSSProperties, type JSX, useEffect, useRef } from 'react';

export interface DicomViewerProps {
  readonly options: ViewerOptions;
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
  readonly onReady?: (viewport: ViewportApi) => void;
  readonly onError?: (error: Error) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * M1 spike of the React adapter. The viewer is created in an effect, so nothing touches the
 * browser during SSR and Next.js hosts need no `dynamic(..., { ssr: false })`.
 */
export function DicomViewer(props: DicomViewerProps): JSX.Element {
  const { options, studyInstanceUID, seriesInstanceUID, className, style } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  // Callbacks change identity every render; the effect must not restart for them. `options` is a
  // real input, so a new object restarts the viewer: keep it stable (useMemo) in the host.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    const viewer = createViewer(options);
    const fail = (error: unknown): void => {
      if (!cancelled) {
        latest.current.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    try {
      viewer.viewports.attach('vp-0', host);
    } catch (error) {
      // A failure before the load starts: the viewer must not be left running.
      viewer.destroy();
      fail(error);
      return;
    }
    viewer
      .setState({
        studyInstanceUID,
        viewports: [{ id: 'vp-0', seriesInstanceUID }],
      })
      .then(
        () => {
          const viewport = viewer.viewports.get('vp-0');
          if (!cancelled && viewport !== undefined) latest.current.onReady?.(viewport);
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
  }, [options, studyInstanceUID, seriesInstanceUID]);

  return (
    <div ref={hostRef} className={className} style={{ width: '100%', height: '100%', ...style }} />
  );
}
