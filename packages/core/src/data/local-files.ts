/**
 * The files behind `dicomfile:<n>` image ids. The data layer (which cannot import Cornerstone)
 * hands out the ids, and the engine's loader for that scheme reads the files back from here.
 */
const files = new Map<string, File>();
let next = 0;

export function addLocalFile(file: File): string {
  const imageId = `dicomfile:${next.toString()}`;
  next += 1;
  files.set(imageId, file);
  return imageId;
}

export function getLocalFile(imageId: string): File | undefined {
  return files.get(imageId);
}

export function removeLocalFile(imageId: string): void {
  files.delete(imageId);
}
