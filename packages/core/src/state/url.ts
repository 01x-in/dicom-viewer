import { type ParseResult, parseViewerState, type ViewerStateV1 } from './viewer-state';

/** A state with four viewports is well under 1 KB; this leaves room for later fields and no more. */
const MAX_ENCODED_LENGTH = 8192;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** URL-safe (base64url of the state's JSON), so it can go in a query or hash without escaping. */
export function encodeViewerState(state: ViewerStateV1): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Reads what `encodeViewerState` wrote. Input comes from a link, so this validates and never throws. */
export function decodeViewerState(encoded: string): ParseResult {
  const token = encoded.replace(/^[#?]/, '');
  if (token.length > MAX_ENCODED_LENGTH) {
    return { ok: false, error: 'The state is too long to be a viewer state.' };
  }
  if (!BASE64URL.test(token)) return { ok: false, error: 'The state is not base64url text.' };
  let json: unknown;
  try {
    const binary = atob(token.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: 'The state is not valid encoded JSON.' };
  }
  return parseViewerState(json);
}
