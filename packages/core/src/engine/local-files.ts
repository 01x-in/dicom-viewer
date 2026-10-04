import { loadImageFromNaturalizedMetadata } from '@cornerstonejs/dicom-image-loader/wadouri';
import { utilities as metadataUtilities } from '@cornerstonejs/metadata';
import { getLocalFile } from '../data/local-files';

/** Image ids the local-file data source hands out. */
export const LOCAL_FILE_SCHEME = 'dicomfile';

export function isLocalFileImageId(imageId: string): boolean {
  return imageId.startsWith(`${LOCAL_FILE_SCHEME}:`);
}

/**
 * Tells the metadata system where a local file is. The file is read, parsed, and cached only when
 * Cornerstone first asks about the image, so registering a whole series reads nothing.
 */
export async function registerLocalFile(imageId: string): Promise<void> {
  const file = getLocalFile(imageId);
  if (file === undefined) {
    throw new Error(
      `The file for ${imageId} is no longer available. Was the data source disposed while a viewer still used it?`,
    );
  }
  await metadataUtilities.addDicomPart10Instance(imageId, () => file.arrayBuffer());
}

/** The loader for `dicomfile:` image ids. With the metadata registered above it needs no network or file manager. */
export const loadLocalFileImage: typeof loadImageFromNaturalizedMetadata =
  loadImageFromNaturalizedMetadata;
