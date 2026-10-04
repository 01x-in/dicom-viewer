// React adapter. M1 ships a spike of <DicomViewer>; the full component set (ViewerViewport,
// useViewer, useViewerState) arrives in M4, see docs/plan.md.
// The 'use client' directive is added to the bundle by tsdown.config.ts, because
// bundlers drop module-level directives from source files.
export { DicomViewer } from './DicomViewer';
export type { DicomViewerProps } from './DicomViewer';
