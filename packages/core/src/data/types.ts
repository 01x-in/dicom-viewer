import type { DicomWebRequest } from './request';

/**
 * One instance as DICOMweb JSON: tag (upper-case hex) to value representation and values. The
 * `vr` is missing from what static WADO servers send, so a reader must not rely on it.
 */
export type DicomJsonInstance = Record<
  string,
  { vr?: string | undefined; Value?: unknown[] | undefined }
>;

/**
 * One image that can be shown. For a single-frame instance that is the instance. For a multi-frame
 * instance it is one frame of it: the entries of one instance share the SOP instance UID and differ
 * in `frameNumber` and `imageId`. In `LoadedSeriesData.instances`, an entry is a whole instance.
 */
export interface SeriesInstance {
  readonly sopInstanceUID: string;
  /** 1-based. 1 for a single-frame instance. */
  readonly frameNumber: number;
  /** NumberOfFrames of the instance. 1 for a single-frame instance, and for one that is not an image (a SEG). */
  readonly frameCount: number;
  readonly instanceNumber: number | undefined;
  readonly imageId: string;
  /**
   * DICOMweb JSON to register with the rendering engine. For a frame of a multi-frame instance it
   * is the instance's metadata with that frame's geometry at the top level and without the two
   * functional group sequences, so it reads as a single-frame instance would.
   */
  readonly metadata: DicomJsonInstance;
  /**
   * The DICOM JSON of the whole instance, as the server gave it. The same object for every frame of
   * an instance. The engine registers this one, because Cornerstone reads the functional groups
   * itself and keeps one record for each instance.
   */
  readonly instanceMetadata: DicomJsonInstance;
}

/** Why a stack cannot be shown as a volume (MPR). It is still shown as a stack of slices. */
export type NotReconstructable =
  | 'missing-geometry'
  | 'too-few-slices'
  | 'missing-pixel-spacing'
  | 'inconsistent-image-size'
  | 'tilted'
  | 'non-uniform-spacing';

export type Reconstructability =
  | { readonly ok: true; readonly spacingMm: number }
  | { readonly ok: false; readonly reason: NotReconstructable };

/** Slices that belong together on screen: one orientation, one slice per position. */
export interface SeriesStack {
  /** Position in `LoadedSeriesData.stacks`. Stack 0 is the largest. */
  readonly index: number;
  /** In display order (along the slice normal). */
  readonly instances: readonly SeriesInstance[];
  readonly imageIds: readonly string[];
  readonly reconstructable: Reconstructability;
}

export interface LoadedSeriesData {
  readonly studyInstanceUID: string;
  readonly seriesInstanceUID: string;
  readonly modality: string;
  readonly description: string | undefined;
  /** Every instance of the series, in instance-number order, whether or not it can be displayed. */
  readonly instances: readonly SeriesInstance[];
  /** What can be displayed. A series splits into several stacks when its orientation or its slice positions differ. Empty for SEG and SR. */
  readonly stacks: readonly SeriesStack[];
}

/** One row of a study's series list. */
export interface SeriesSummary {
  readonly seriesInstanceUID: string;
  readonly modality: string;
  readonly description: string | undefined;
  readonly seriesNumber: number | undefined;
  /** `undefined` when the server does not say. */
  readonly instanceCount: number | undefined;
}

export interface StudyData {
  readonly studyInstanceUID: string;
  readonly series: readonly SeriesSummary[];
}

/**
 * What the frame loader needs to apply the host's request policy to its own requests. The loader
 * fetches frames itself, so headers and token refresh reach it through here.
 */
export interface FrameRequestPolicy {
  /**
   * Whether an image id was handed out by this source. Two sources with the same root and
   * different credentials must not claim each other's frames, so this is per source, not per root.
   */
  owns(imageId: string): boolean;
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
  /** Lists the series of one study. */
  getStudy(studyInstanceUID: string): Promise<StudyData>;
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
