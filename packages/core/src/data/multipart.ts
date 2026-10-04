import { DataSourceError } from './errors';

const CRLF_CRLF = [13, 10, 13, 10] as const;

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const limit = haystack.length - needle.length;
  outer: for (let start = from; start <= limit; start += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

function boundaryOf(contentType: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined) {
    throw new DataSourceError(`Expected a multipart response, got "${contentType}".`);
  }
  return boundary;
}

const CR = 13;
const LF = 10;
const DASH = 45;
const SPACE = 32;
const TAB = 9;

/** True when `--boundary` at `index` is a real delimiter: followed by `--` (closing) or optional padding and CRLF. */
function isDelimiterEnd(body: Uint8Array, end: number): boolean {
  if (body[end] === DASH && body[end + 1] === DASH) return true;
  let cursor = end;
  while (body[cursor] === SPACE || body[cursor] === TAB) cursor += 1;
  return body[cursor] === CR && body[cursor + 1] === LF;
}

/** Index of the next delimiter line for `boundary` at or after `from`, or -1. Skips lookalike payload bytes. */
function findDelimiter(
  body: Uint8Array,
  boundary: string,
  from: number,
  afterCrlf: boolean,
): number {
  const encoder = new TextEncoder();
  const needle = encoder.encode(afterCrlf ? `\r\n--${boundary}` : `--${boundary}`);
  let cursor = from;
  for (;;) {
    const found = indexOfBytes(body, needle, cursor);
    if (found === -1) return -1;
    if (isDelimiterEnd(body, found + needle.length)) return found;
    cursor = found + 1;
  }
}

/**
 * Returns the payload of the first part of a `multipart/related` body, without copying it.
 * Handles a preamble before the first delimiter and ignores payload text that only looks like one.
 */
export function extractFirstPart(contentType: string, body: Uint8Array): Uint8Array {
  const boundary = boundaryOf(contentType);
  const delimiterLength = `--${boundary}`.length;

  // The opening delimiter is at the very start, or after a preamble that ends with CRLF.
  let open = findDelimiter(body, boundary, 0, false);
  while (open > 0 && !(body[open - 2] === CR && body[open - 1] === LF)) {
    open = findDelimiter(body, boundary, open + 1, false);
  }
  if (open === -1) {
    throw new DataSourceError(`Multipart response has no opening boundary "${boundary}".`);
  }

  const headerEnd = indexOfBytes(body, Uint8Array.from(CRLF_CRLF), open + delimiterLength);
  if (headerEnd === -1) throw new DataSourceError('Multipart response has no part headers.');
  const start = headerEnd + CRLF_CRLF.length;
  const end = findDelimiter(body, boundary, start - 2, true);
  if (end === -1) {
    throw new DataSourceError(`Multipart response has no closing boundary "${boundary}".`);
  }
  return body.subarray(start, end);
}
