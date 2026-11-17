import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/**
 * Looks for a place that finds an image by SOP instance UID alone. An instance can have many
 * frames, so such a place puts a measurement or a SEG on frame 1 or on the last frame. It must
 * name the frame in the lines around it, or be one of the few places where it is right.
 */
const COMPARISON =
  /sopInstanceUID\s*===|===\s*[\w.?]*sopInstanceUID|\.has\(\s*[\w.]*sopInstanceUID/;
const FRAME_NEARBY = /frameNumber|frameOf|sliceKey|findSlice/;

/** Where a SOP instance alone is the right key, and why. */
const ALLOWED: readonly { readonly file: string; readonly why: string }[] = [
  { file: 'data/local.ts', why: 'finds the file of an instance, which holds all its frames' },
  { file: 'data/series.ts', why: 'findSlice itself, which checks the frame on the next line' },
  {
    file: 'segmentations/registry.ts',
    why: 'picks the stack a SEG names the most images of; a SEG on frames is refused after it',
  },
  {
    file: 'viewer-core.ts',
    why: 'finds the instance to read its frame count; the frame is checked after it',
  },
];

describe('lookups by SOP instance UID', () => {
  it('name the frame, or are where an instance is the right key', () => {
    const loose: string[] = [];
    for (const path of sources(ROOT)) {
      const relative = path.slice(ROOT.length);
      if (ALLOWED.some(({ file }) => file === relative)) continue;
      const lines = readFileSync(path, 'utf8').split('\n');
      for (const [at, line] of lines.entries()) {
        // `typeof x.sopInstanceUID === 'string'` is a check of a type, not a lookup.
        if (!COMPARISON.test(line) || line.includes('typeof')) continue;
        const around = lines.slice(Math.max(0, at - 3), at + 4).join('\n');
        if (!FRAME_NEARBY.test(around))
          loose.push(`${relative}:${(at + 1).toString()}: ${line.trim()}`);
      }
    }
    expect(loose).toEqual([]);
  });
});
