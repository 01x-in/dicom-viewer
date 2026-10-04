import { describe, expect, it } from 'vitest';
import { decodeViewerState, encodeViewerState } from './url';
import type { ViewerStateV1 } from './viewer-state';

const state: ViewerStateV1 = {
  version: 1,
  studyInstanceUID: '1.2.840.113619.2.55',
  layout: '1x1',
  viewports: [
    { id: 'vp-0', seriesInstanceUID: '1.2.840.113619.2.55.3', stackIndex: 0, imageIndex: 31 },
  ],
};

describe('encodeViewerState', () => {
  it('produces only URL-safe characters, so it needs no escaping in a query or hash', () => {
    const encoded = encodeViewerState(state);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is the same for the same state', () => {
    expect(encodeViewerState(state)).toBe(encodeViewerState({ ...state }));
  });
});

describe('decodeViewerState', () => {
  it('round-trips a state', () => {
    expect(decodeViewerState(encodeViewerState(state))).toEqual({ ok: true, state });
  });

  it('round-trips a state without a study', () => {
    const empty: ViewerStateV1 = { version: 1, layout: '1x1', viewports: [{ id: 'vp-0' }] };
    expect(decodeViewerState(encodeViewerState(empty))).toEqual({ ok: true, state: empty });
  });

  it('accepts the token with a leading # or ?, as copied from a URL', () => {
    const encoded = encodeViewerState(state);
    expect(decodeViewerState(`#${encoded}`)).toEqual({ ok: true, state });
    expect(decodeViewerState(`?${encoded}`)).toEqual({ ok: true, state });
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'not valid!!'],
    ['base64 of text that is not JSON', btoa('hello').replace(/=+$/, '')],
    [
      'JSON of the wrong shape',
      btoa(JSON.stringify({ version: 1, layout: 'zzz' })).replace(/=+$/, ''),
    ],
    [
      'a state with a hostile UID',
      btoa(JSON.stringify({ version: 1, studyInstanceUID: '../x' })).replace(/=+$/, ''),
    ],
    ['bytes that are not UTF-8', '_w'],
  ])('rejects %s without throwing', (_name, input) => {
    const result = decodeViewerState(input);
    expect(result.ok).toBe(false);
  });

  it('refuses a token that is too long to be a state, before decoding it', () => {
    const result = decodeViewerState('A'.repeat(20_000));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/too long/i);
  });
});
