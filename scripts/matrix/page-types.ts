// What the example pages expose to the matrix on `window`, as the scenarios use it. One declaration,
// because every script that touches `window.__dvViewer` must agree on its type.

export interface ViewerHandle {
  getState(): {
    studyInstanceUID?: string;
    viewports: {
      id: string;
      seriesInstanceUID?: string;
      stackIndex?: number;
      imageIndex?: number;
      window?: { center: number; width: number };
      invert?: boolean;
      zoom?: number;
    }[];
  };
  navigateTo(target: {
    seriesInstanceUID: string;
    sopInstanceUID: string;
    segmentations?: { seriesInstanceUID: string; visible: boolean; highlightSegments?: number[] }[];
  }): Promise<{
    imageIndex: number;
    stackIndex: number;
    sopInstanceUID: string;
    failedSegmentations?: { seriesInstanceUID: string; error: { message: string } }[];
  }>;
  viewports: {
    attach(viewportId: string, element: HTMLElement): void;
    detach(viewportId: string): void;
    get(viewportId: string): { setImageIndex(index: number): Promise<void> } | undefined;
  };
  thumbnails: {
    get(seriesInstanceUID: string, options?: { size?: number }): Promise<string | undefined>;
  };
  tools: { setActive(tool: string): Promise<void> };
  setViewportSeries(viewportId: string, seriesInstanceUID: string): Promise<void>;
  measurements: {
    add(measurement: object): Promise<MeasurementSummary>;
    list(): MeasurementSummary[];
    getSelected(): string | undefined;
    get(id: string): MeasurementSummary | undefined;
    clear(): Promise<number>;
    remove(id: string): Promise<boolean>;
    exportJson(): { format: string; measurements: (MeasurementSummary & { values: Values })[] };
    importJson(input: string): Promise<{ added: number; replaced: number }>;
  };
  segmentations: {
    load(seriesInstanceUID: string): Promise<SegmentationSummary>;
    unload(seriesInstanceUID: string): Promise<boolean>;
    list(): SegmentationSummary[];
    get(seriesInstanceUID: string): SegmentationSummary | undefined;
    setVisible(seriesInstanceUID: string, visible: boolean): Promise<void>;
    setSegmentVisible(seriesInstanceUID: string, segment: number, visible: boolean): Promise<void>;
    setSegmentColor(
      seriesInstanceUID: string,
      segment: number,
      color: number[] | string,
    ): Promise<void>;
    setSegmentOpacity(seriesInstanceUID: string, segment: number, opacity: number): Promise<void>;
    setOpacity(seriesInstanceUID: string, opacity: number): Promise<void>;
    highlight(
      seriesInstanceUID: string,
      segments: number[] | undefined,
      options?: { mode?: string },
    ): Promise<void>;
    jumpToSegment(
      seriesInstanceUID: string,
      segment: number,
      options?: { strategy?: string; viewportId?: string },
    ): Promise<{ imageIndex: number; sopInstanceUID: string; viewportId: string }>;
  };
  on(event: string, handler: (payload: { origin?: string }) => void): () => void;
}

export interface SegmentationSummary {
  seriesInstanceUID: string;
  label: string;
  visible: boolean;
  opacity: number;
  referencedStackIndex: number;
  segments: {
    number: number;
    label: string;
    color: number[];
    opacity: number;
    visible: boolean;
    voxelCount: number;
    imageCount: number;
    centroid?: number[];
  }[];
  highlight?: { mode: string; segments: number[] };
  warnings: { code: string; message: string }[];
}

export type Values = Record<string, number | undefined>;

export interface MeasurementSummary {
  id: string;
  type: string;
  reference: { sopInstanceUID: string; seriesInstanceUID: string; frameOfReferenceUID?: string };
  points: number[][];
  stats?: { pixelCount: number; meanHu: number; stdDevHu: number; minHu: number; maxHu: number };
  hu?: number;
}

declare global {
  interface Window {
    __dvViewer?: ViewerHandle;
    __dvDiagnostics?: () =>
      | { annotations: number; segmentations: number; cacheBytes: number }
      | undefined;
  }
}
