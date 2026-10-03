import { wasmFiles } from 'dv-inline-wasm';
import { INLINE_WASM_BASE } from '../src/engine/inline-base.ts';

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const embedded = Object.keys(wasmFiles).length > 0;

if (embedded) {
  const realFetch = self.fetch.bind(self);
  self.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.startsWith(INLINE_WASM_BASE)) {
      const base64 = wasmFiles[url.slice(INLINE_WASM_BASE.length)];
      if (base64 !== undefined) {
        return Promise.resolve(
          new Response(base64ToBytes(base64), { headers: { 'content-type': 'application/wasm' } }),
        );
      }
    }
    return realFetch(input, init);
  };
}
