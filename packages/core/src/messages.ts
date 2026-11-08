/**
 * English text of the styled viewer, and the list of every key a host can translate. Named
 * placeholders use single braces, such as `{name}` or `{count}`. Read this object to see the full
 * set of keys and the English wording to start from.
 */
export const DEFAULT_VIEWER_MESSAGES = {
  viewerLabel: 'DICOM viewer',
  toolbarLabel: 'Viewer tools',
  seriesPanel: 'Series',
  measurementsPanel: 'Measurements',
  segmentationsPanel: 'Segments',
  leftPanels: 'Left panels',
  rightPanels: 'Right panels',
  expandLeftPanels: 'Expand the left panels',
  collapseLeftPanels: 'Collapse the left panels',
  expandRightPanels: 'Expand the right panels',
  collapseRightPanels: 'Collapse the right panels',
  chooseSeries: 'Choose a series to view.',
  noSeries: 'No series.',
  image: 'image',
  images: 'images',
  loading: 'Loading…',
  load: 'Load',
  loadItem: 'Load {name}',
  unload: 'Unload',
  unloadItem: 'Unload {name}',
  showItem: 'Show {name}',
  colorItem: '{name} colour',
  highlight: 'Highlight',
  highlightItem: 'Highlight {name}',
  goTo: 'Go to',
  goToItem: 'Go to {name}',
  opacity: 'Opacity',
  opacityItem: '{name} opacity',
  segmentsItem: '{name} segments',
  noPixels: 'No pixels',
  noSegmentations: 'This study has no segmentations.',
  warnings: 'Warnings',
  warningPrefix: 'Warning: ',
  warningFrameOfReference:
    'The SEG is in another frame of reference than the images, so it may not be where it is drawn.',
  warningImageSize:
    'The SEG is {rows} by {columns} pixels. The images are {imageRows} by {imageColumns} pixels.',
  warningPlaneOrientation: 'The SEG lies in a different direction than the images.',
  warningPixelSpacing:
    'The SEG pixel spacing is {segSpacing}. The image pixel spacing is {imageSpacing}.',
  warningPlanePosition:
    'Number of SEG frames outside their image planes: {count}. Maximum distance: {distance} mm.',
  warningMissingReferences: 'Number of referenced images outside the series on screen: {count}.',
  warningOverlappingSegments: 'Segments share pixels: {pairs}.',
  warningOverlappingSegmentsMore: 'Segments share pixels: {pairs}. Additional pairs: {count}.',
  warningEmptySegment: 'The segment {name} has no pixels.',
  warningNotDrawn:
    'The SEG is not drawn on screen: the engine could not draw it, which happens when it renders without WebGL.',
  toolWindowLevel: 'Window / level',
  toolPan: 'Pan',
  toolZoom: 'Zoom',
  toolScroll: 'Scroll',
  toolCrosshairs: 'Crosshairs',
  toolLength: 'Length',
  toolBidirectional: 'Bidirectional',
  toolEllipse: 'Ellipse',
  toolRectangle: 'Rectangle',
  toolProbe: 'Probe',
  toolAngle: 'Angle',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  invert: 'Invert',
  reset: 'Reset',
  cine: 'Cine',
  presets: 'Presets',
  layout: 'Layout',
  measure: 'Measure',
  presetLung: 'Lung',
  presetSoftTissue: 'Soft tissue',
  presetBone: 'Bone',
  presetBrain: 'Brain',
  presetLiver: 'Liver',
  layoutSingle: 'One viewport',
  layoutSideBySide: 'Two side by side',
  layoutGrid: 'Two by two',
  layoutLarge: 'One large, three small',
  layoutMpr: 'Three planes and slices',
  measurementLong: 'Long',
  measurementShort: 'Short',
  measurementArea: 'Area',
  measurementMean: 'Mean',
  measurementStandardDeviation: 'SD',
  measurementMin: 'Min',
  measurementMax: 'Max',
  measurementValue: 'Value',
  measurementActions: 'Measurement actions',
  measurementSlice: 'Slice {slice}',
  previousMeasurement: 'Previous',
  nextMeasurement: 'Next',
  measurementSelection: 'Selection',
  selectAll: 'Select all',
  selectedCount: '{count} selected',
  showTogether: 'Show together',
  deleteSelected: 'Delete selected',
  showingFirstSelected: 'Showing the first {shown} of {total} selected.',
  noMeasurements: 'No measurements yet. Choose a tool from the Measure menu and draw on the image.',
  name: 'Name',
  save: 'Save',
  cancel: 'Cancel',
  rename: 'Rename',
  delete: 'Delete',
  viewportIndex: 'Viewport {index} of {count}, ',
  viewportNoImage: 'No image shown',
  viewportImage: 'image {index} of {count}',
  viewportPlane: '{plane} plane',
  viewportWindow: 'window {width}, level {center}',
  viewportInverted: 'inverted',
  viewportZoom: 'zoom {zoom} times',
  planeAxial: 'axial',
  planeSagittal: 'sagittal',
  planeCoronal: 'coronal',
  slices: 'Slices',
  fallbackMissingGeometry:
    'The images have no position or orientation, so they cannot be reformatted.',
  fallbackTooFewSlices: 'The series has too few slices to be reformatted.',
  fallbackMissingPixelSpacing:
    'The images do not say how large a pixel is, so they cannot be reformatted.',
  fallbackInconsistentImageSize:
    'The images are not all the same size, so they cannot be reformatted.',
  fallbackTilted:
    'The slices lean against the direction they are stacked in, so they cannot be reformatted.',
  fallbackNonUniformSpacing: 'The slices are not evenly spaced, so they cannot be reformatted.',
  fallbackOverMemoryBudget:
    'The volume is larger than the memory the viewer may use, so the slices are shown.',
  fallbackEngineUnsupported:
    'This browser cannot draw a reformatted view, so the slices are shown.',
  error: 'The viewer could not complete this action.',
} as const;

/**
 * Host text for the styled shell. Pass a `Partial<ViewerMessages>` as the `messages` prop of the
 * React or Vue `DicomViewer`, or as the `messages` property of `<dv-viewer>`. Omitted entries keep
 * their English defaults. Keep the placeholders of the English text in each translation. Text the
 * patient data provides (series descriptions, measurement names, segment names) is not translated.
 *
 * @example
 * ```ts
 * const es: Partial<ViewerMessages> = {
 *   viewerLabel: 'Visor DICOM',
 *   toolPan: 'Desplazar',
 *   showItem: 'Mostrar {name}',
 * };
 * ```
 */
export type ViewerMessages = { readonly [Key in keyof typeof DEFAULT_VIEWER_MESSAGES]: string };

/** Resolves partial host text without changing the English defaults. */
export const resolveViewerMessages = (messages?: Partial<ViewerMessages>): ViewerMessages => ({
  ...DEFAULT_VIEWER_MESSAGES,
  ...messages,
});

/** Substitutes named placeholders. The result remains plain text. */
export const formatViewerMessage = (
  template: string,
  values: Readonly<Record<string, string | number>>,
): string =>
  template.replace(/\{(\w+)\}/g, (match: string, key: string): string => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
