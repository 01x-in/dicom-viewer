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
  }): Promise<{ imageIndex: number; stackIndex: number; sopInstanceUID: string }>;
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
    setVisible(seriesInstanceUID: string, visible: boolean): Promise<void>;
  };
  on(event: string, handler: (payload: { origin?: string }) => void): () => void;
}

export interface SegmentationSummary {
  label: string;
  segments: { number: number; label: string; voxelCount: number; imageCount: number }[];
  warnings: unknown[];
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
  }
}
