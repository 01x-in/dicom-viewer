// Stands in for `comlink` when @cornerstonejs/tools' compute worker imports it (see
// scripts/build-workers.ts). Everything is the real comlink, except that `expose` adds the viewer's
// own methods to the ones the worker offers, so the viewer can run work on the worker Cornerstone
// already registers as 'compute'.
import { expose as exposeUpstream } from 'dv-real-comlink';
import { buildSegmentIndex } from '../src/segmentations/segment-index.ts';

export * from 'dv-real-comlink';

const viewerMethods = {
  /** Where each segment of a labelmap is: see src/segmentations/segment-index.ts. */
  segmentIndex: buildSegmentIndex,
};

export function expose(api: object, endpoint?: unknown, allowedOrigins?: unknown): void {
  exposeUpstream({ ...api, ...viewerMethods }, endpoint, allowedOrigins);
}
