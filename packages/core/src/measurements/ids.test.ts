import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('makes a version 4 UUID', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 200 }, newId)).size).toBe(200);
  });
});
