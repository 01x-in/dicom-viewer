/** Helpers for the content tree of a Structured Report as dcmjs names it. They import no Cornerstone code. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A content sequence that holds one item is a bare item in the named form, not a list of one. */
export function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

export function itemsOf(value: unknown): Record<string, unknown>[] {
  return toArray(value).filter(isRecord);
}

/** The meaning of the concept name of a content item. */
export function meaningOf(item: Record<string, unknown>): unknown {
  const name = toArray(item['ConceptNameCodeSequence']).find(isRecord);
  return name?.['CodeMeaning'];
}

export const REPORT_MEANING = 'Imaging Measurements';
export const GROUP_MEANING = 'Measurement Group';

/** The content item that holds the measurement groups of a TID 1500 report. */
export function reportOf(dataset: unknown): Record<string, unknown> | undefined {
  if (!isRecord(dataset)) return undefined;
  return itemsOf(dataset['ContentSequence']).find((item) => meaningOf(item) === REPORT_MEANING);
}

export function measurementGroups(dataset: unknown): Record<string, unknown>[] {
  const report = reportOf(dataset);
  if (report === undefined) return [];
  return itemsOf(report['ContentSequence']).filter((item) => meaningOf(item) === GROUP_MEANING);
}

export function isCoordinates(item: Record<string, unknown>): boolean {
  return item['ValueType'] === 'SCOORD' || item['ValueType'] === 'SCOORD3D';
}

/**
 * What a browser's "latin1" decoder makes of the bytes 0x80 to 0x9F: it is really Windows-1252, so
 * these come out as other characters, in order. The rest of the bytes come out as the same number.
 */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** A string that dcmjs read one byte to a character, which was written in UTF-8, as the original text. */
function repairedString(value: string): string {
  // Plain ASCII is the same in every character set.
  let ascii = true;
  for (let at = 0; at < value.length && ascii; at += 1) ascii = value.charCodeAt(at) < 0x80;
  if (ascii) return value;
  const bytes = new Uint8Array(value.length);
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    const high = WINDOWS_1252_HIGH.indexOf(code);
    if (code <= 0xff && !(code >= 0x80 && code <= 0x9f && high < 0)) {
      bytes[at] = code;
    } else if (high >= 0) {
      bytes[at] = 0x80 + high;
    } else {
      // A character that no single byte gives: the string is already text.
      return value;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not valid UTF-8: it was Latin-1 text after all.
    return value;
  }
}

/**
 * dcmjs reads every text value one byte to a character, whatever the file's character set. A
 * report written in UTF-8 (`ISO_IR 192`, which is what the viewer writes, and what most tools
 * write) would show `Ã©` for `é`. This puts the text right, in place (the reader that follows
 * needs the objects as dcmjs made them), for such a file.
 */
export function repairUtf8(value: unknown): void {
  if (Array.isArray(value)) {
    for (const [at, entry] of value.entries()) {
      if (typeof entry === 'string') value[at] = repairedString(entry);
      else repairUtf8(entry);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (typeof entry === 'string') value[key] = repairedString(entry);
    else repairUtf8(entry);
  }
}

/** Whether a dataset says it is in UTF-8. */
export function isUtf8(dataset: Record<string, unknown>): boolean {
  return toArray(dataset['SpecificCharacterSet']).some(
    (entry) => typeof entry === 'string' && entry.trim() === 'ISO_IR 192',
  );
}
