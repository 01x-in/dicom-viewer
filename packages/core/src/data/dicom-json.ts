import { DataSourceError } from './errors';
import type { DicomJsonInstance } from './types';

/** DS and IS values may arrive as numbers or as numeric strings in DICOM JSON; blanks are dropped. */
export function numbers(metadata: DicomJsonInstance, tag: string): number[] {
  const values = metadata[tag]?.Value ?? [];
  return values.flatMap((value) => {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN;
    return Number.isFinite(parsed) ? [parsed] : [];
  });
}

export function optionalString(metadata: DicomJsonInstance, tag: string): string | undefined {
  const value = metadata[tag]?.Value?.[0];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function requiredString(metadata: DicomJsonInstance, tag: string): string {
  const value = optionalString(metadata, tag);
  if (value === undefined) throw new DataSourceError(`Instance metadata is missing ${tag}.`);
  return value;
}

export function firstNumber(metadata: DicomJsonInstance, tag: string): number | undefined {
  return numbers(metadata, tag)[0];
}
