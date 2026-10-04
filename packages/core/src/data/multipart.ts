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

/** Returns the payload of the first part of a `multipart/related` body, without copying it. */
export function extractFirstPart(contentType: string, body: Uint8Array): Uint8Array {
  const boundary = boundaryOf(contentType);
  const encoder = new TextEncoder();
  const headerEnd = indexOfBytes(body, Uint8Array.from(CRLF_CRLF));
  if (headerEnd === -1) throw new DataSourceError('Multipart response has no part headers.');
  const start = headerEnd + CRLF_CRLF.length;
  const end = indexOfBytes(body, encoder.encode(`\r\n--${boundary}`), start);
  if (end === -1) {
    throw new DataSourceError(`Multipart response has no closing boundary "${boundary}".`);
  }
  return body.subarray(start, end);
}
