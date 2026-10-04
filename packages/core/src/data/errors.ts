/** Thrown for any failed DICOMweb request or malformed response. `status` is the HTTP status, if any. */
export class DataSourceError extends Error {
  override readonly name = 'DataSourceError';
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
