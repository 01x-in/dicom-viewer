/**
 * Cornerstone keeps one metadata record for each instance, not for each frame: its key is the image
 * id with the frame taken out (`/frames/3` for DICOMweb, `?frame=3` for a local file). So the
 * engine registers an instance once however many of its frames are on screen, and forgets it only
 * when the last frame is gone.
 */
export function instanceKey(imageId: string): string {
  return imageId.replace(/\/frames\/\d+/, '').replace(/[?&]frame=\d+/, '');
}
