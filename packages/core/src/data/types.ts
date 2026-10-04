/** One instance as DICOMweb JSON: tag (upper-case hex) to value representation and values. */
export type DicomJsonInstance = Record<string, { vr: string; Value?: unknown[] | undefined }>;

export interface SeriesInstance {
  readonly sopInstanceUID: string;
  readonly instanceNumber: number | undefined;
  readonly imageId: string;
  /** DICOMweb JSON for this instance, to register with the rendering engine. */
  readonly metadata: DicomJsonInstance;
}

export interface LoadedSeriesData {
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
  /** In display order (along the slice normal). */
  readonly instances: readonly SeriesInstance[];
  readonly imageIds: readonly string[];
}

export interface DataSource {
  getSeries(studyInstanceUID: string, seriesInstanceUID: string): Promise<LoadedSeriesData>;
  /** Retrieves one whole Part 10 instance. Only SEG and SR are retrievable this way through the OncoTrace proxy. */
  getInstanceBytes(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
  ): Promise<ArrayBuffer>;
}
