import {
  DEFAULT_VIEWER_MESSAGES,
  resolveViewerMessages,
  formatViewerMessage,
  type MprFallbackReason,
  type PrimaryTool,
  type SegmentationWarningCode,
  type SegmentationWarning,
  type ViewerMessages,
} from '@01x/dicom-viewer-core';
import { TOOLBAR_ACTIONS, type MenuEntry, type MenuItem, type ToolbarItem } from './toolbar-config';

const TOOL_MESSAGES: Readonly<Record<PrimaryTool, keyof ViewerMessages>> = {
  'window-level': 'toolWindowLevel',
  pan: 'toolPan',
  zoom: 'toolZoom',
  'stack-scroll': 'toolScroll',
  crosshairs: 'toolCrosshairs',
  length: 'toolLength',
  bidirectional: 'toolBidirectional',
  ellipse: 'toolEllipse',
  rectangle: 'toolRectangle',
  probe: 'toolProbe',
  angle: 'toolAngle',
};

export const toolLabel = (tool: PrimaryTool, messages?: Partial<ViewerMessages>): string =>
  resolveViewerMessages(messages)[TOOL_MESSAGES[tool]];

const ITEM_MESSAGES: Readonly<Record<string, keyof ViewerMessages>> = {
  'zoom-in': 'zoomIn',
  'zoom-out': 'zoomOut',
  invert: 'invert',
  reset: 'reset',
  cine: 'cine',
  presets: 'presets',
  layout: 'layout',
  measure: 'measure',
  'layout-1x1': 'layoutSingle',
  'layout-1x2': 'layoutSideBySide',
  'layout-2x2': 'layoutGrid',
  'layout-1+3': 'layoutLarge',
  'layout-mpr': 'layoutMpr',
  'preset-lung': 'presetLung',
  'preset-soft-tissue': 'presetSoftTissue',
  'preset-bone': 'presetBone',
  'preset-brain': 'presetBrain',
  'preset-liver': 'presetLiver',
  ...Object.fromEntries(Object.entries(TOOL_MESSAGES).map(([tool, key]) => [`tool-${tool}`, key])),
};

/** Host labels remain untouched; only the English labels of built-in items are replaced. */
export const itemLabel = (
  item: Exclude<ToolbarItem, { readonly type: 'tool' | 'separator' | 'custom' }> | MenuEntry,
  messages?: Partial<ViewerMessages>,
  parent?: MenuItem,
): string => {
  const builtInItems = Object.values(TOOLBAR_ACTIONS);
  const isBuiltIn = builtInItems.some((builtIn) => builtIn === item || builtIn === parent);
  if (!isBuiltIn) return item.label;
  const key = ITEM_MESSAGES[item.id];
  return key !== undefined && item.label === DEFAULT_VIEWER_MESSAGES[key]
    ? resolveViewerMessages(messages)[key]
    : item.label;
};

const FALLBACK_MESSAGES: Readonly<Record<MprFallbackReason, keyof ViewerMessages>> = {
  'missing-geometry': 'fallbackMissingGeometry',
  'too-few-slices': 'fallbackTooFewSlices',
  'missing-pixel-spacing': 'fallbackMissingPixelSpacing',
  'inconsistent-image-size': 'fallbackInconsistentImageSize',
  tilted: 'fallbackTilted',
  'non-uniform-spacing': 'fallbackNonUniformSpacing',
  'over-memory-budget': 'fallbackOverMemoryBudget',
  'engine-unsupported': 'fallbackEngineUnsupported',
};

export const fallbackMessage = (
  reason: MprFallbackReason,
  messages?: Partial<ViewerMessages>,
): string => resolveViewerMessages(messages)[FALLBACK_MESSAGES[reason]];

const WARNING_MESSAGES: Readonly<Record<SegmentationWarningCode, keyof ViewerMessages>> = {
  'frame-of-reference': 'warningFrameOfReference',
  'image-size': 'warningImageSize',
  'plane-orientation': 'warningPlaneOrientation',
  'pixel-spacing': 'warningPixelSpacing',
  'plane-position': 'warningPlanePosition',
  'missing-references': 'warningMissingReferences',
  'overlapping-segments': 'warningOverlappingSegments',
  'empty-segment': 'warningEmptySegment',
  'not-drawn': 'warningNotDrawn',
};

export const warningMessage = (
  warning: SegmentationWarning,
  messages?: Partial<ViewerMessages>,
): string => {
  const parameters = warning.parameters ?? {};
  const messageKey =
    warning.code === 'overlapping-segments' &&
    typeof parameters['count'] === 'number' &&
    parameters['count'] > 0
      ? 'warningOverlappingSegmentsMore'
      : WARNING_MESSAGES[warning.code];
  return formatViewerMessage(resolveViewerMessages(messages)[messageKey], parameters);
};
