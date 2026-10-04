import { describe, expect, it } from 'vitest';
import { extractFirstPart } from './multipart';

function body(
  boundary: string,
  payload: Uint8Array,
  headers = 'Content-Type: application/dicom',
): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(`--${boundary}\r\n${headers}\r\n\r\n`);
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + payload.length + tail.length);
  out.set(head, 0);
  out.set(payload, head.length);
  out.set(tail, head.length + payload.length);
  return out;
}

describe('extractFirstPart', () => {
  it('returns the bytes between the part headers and the closing boundary', () => {
    const payload = Uint8Array.from([1, 2, 3, 4]);
    const part = extractFirstPart(
      'multipart/related; type="application/dicom"; boundary=abc',
      body('abc', payload),
    );
    expect(Array.from(part)).toEqual([1, 2, 3, 4]);
  });

  it('keeps binary payloads that contain CRLF and dashes intact', () => {
    const payload = Uint8Array.from([13, 10, 45, 45, 13, 10, 0, 255]);
    const part = extractFirstPart('multipart/related; boundary="b-1"', body('b-1', payload));
    expect(Array.from(part)).toEqual(Array.from(payload));
  });

  it('rejects a response that is not multipart', () => {
    expect(() => extractFirstPart('application/json', new Uint8Array())).toThrow(/multipart/i);
  });

  it('rejects a multipart response with no closing boundary', () => {
    const truncated = new TextEncoder().encode('--abc\r\nContent-Type: x\r\n\r\nhello');
    expect(() => extractFirstPart('multipart/related; boundary=abc', truncated)).toThrow(
      /boundary/i,
    );
  });

  it('skips a preamble, even one that contains a blank line', () => {
    const encoder = new TextEncoder();
    const preamble = encoder.encode('ignored text\r\n\r\nmore ignored\r\n');
    const part = body('abc', Uint8Array.from([5, 6]));
    const joined = Uint8Array.from([...preamble, ...part]);
    expect(Array.from(extractFirstPart('multipart/related; boundary=abc', joined))).toEqual([5, 6]);
  });

  it('does not end the part at a payload line that merely starts with the boundary text', () => {
    const encoder = new TextEncoder();
    const payload = Uint8Array.from([1, ...encoder.encode('\r\n--abcX'), 2]);
    const part = extractFirstPart('multipart/related; boundary=abc', body('abc', payload));
    expect(Array.from(part)).toEqual(Array.from(payload));
  });

  it('accepts transport padding after the opening delimiter', () => {
    const encoder = new TextEncoder();
    const raw = Uint8Array.from([
      ...encoder.encode('--abc  \r\nContent-Type: x\r\n\r\n'),
      7,
      ...encoder.encode('\r\n--abc--'),
    ]);
    expect(Array.from(extractFirstPart('multipart/related; boundary=abc', raw))).toEqual([7]);
  });
});
