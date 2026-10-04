import { DataSourceError } from './errors';

/**
 * A DICOM UID is digits and dots, 64 characters at most. UIDs end up in request paths and come
 * from URLs and hosts, so anything else (`..`, `?`, `/`) is refused before it can reach a request.
 */
const UID = /^[0-9]+(\.[0-9]+)*$/;

export function isDicomUid(value: string): boolean {
  return value.length <= 64 && UID.test(value);
}

export function assertDicomUid(value: string, name: string): void {
  if (!isDicomUid(value)) {
    throw new DataSourceError(`${name} is not a valid DICOM UID: ${JSON.stringify(value)}.`);
  }
}
