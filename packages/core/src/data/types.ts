import type { DicomWebRequest } from './request';

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

/**
 * What the frame loader needs to apply the host's request policy to its own requests. The loader
 * fetches frames itself, so headers and token refresh reach it through here.
 */
export interface FrameRequestPolicy {
  /** Image ids that start with this belong to the source (`wadors:<wadoRoot>/`). */
  readonly imageIdPrefix: string;
  headers(request: DicomWebRequest): Record<string, string>;
  /** How many credential refreshes have finished. Read when a request is sent. */
  generation(): number;
  /**
   * Runs the host's refresh hook after a 401, unless a refresh already finished since the request
   * was sent (`sentAt` is the `generation()` at that moment). Resolves to `false` when the host
   * gave no hook.
   */
  refresh(request: DicomWebRequest, sentAt: number): Promise<boolean>;
}

export interface DataSource {
  getSeries(studyInstanceUID: string, seriesInstanceUID: string): Promise<LoadedSeriesData>;
  /**
   * Retrieves one whole Part 10 instance. Servers differ in what they allow (the OncoTrace proxy
   * serves only SEG and SR), so the source's `capabilities` decide, by the instance's modality.
   */
  getInstanceBytes(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    modality: string,
  ): Promise<ArrayBuffer>;
  readonly capabilities: ResolvedCapabilities;
  /** Absent for sources whose images the loader reads without HTTP. */
  readonly frameRequests?: FrameRequestPolicy | undefined;
}

export interface DataSourceCapabilities {
  /** Which whole instances the server will hand out. Default `seg-sr-only`. */
  readonly instanceRetrieve?: 'all' | 'seg-sr-only' | 'none';
}

export type ResolvedCapabilities = Required<DataSourceCapabilities>;
