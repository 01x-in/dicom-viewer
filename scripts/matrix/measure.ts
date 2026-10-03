import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

export interface FileSize {
  readonly name: string;
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

export async function sizeOf(path: string, name = path): Promise<FileSize> {
  const bytes = await readFile(path);
  return {
    name,
    raw: bytes.length,
    gzip: gzipSync(bytes).length,
    brotli: brotliCompressSync(bytes).length,
  };
}

/** Sizes of every `.js` file under `dir` (relative names), largest first. */
export async function measureJavaScript(dir: string): Promise<FileSize[]> {
  const sizes: FileSize[] = [];
  for await (const path of walk(dir)) {
    if (path.endsWith('.js')) sizes.push(await sizeOf(path, path.slice(dir.length + 1)));
  }
  return sizes.sort((a, b) => b.raw - a.raw);
}

export async function fileBytes(path: string): Promise<number> {
  return (await stat(path)).size;
}

export function total(sizes: readonly FileSize[]): FileSize {
  return {
    name: 'total',
    raw: sizes.reduce((sum, item) => sum + item.raw, 0),
    gzip: sizes.reduce((sum, item) => sum + item.gzip, 0),
    brotli: sizes.reduce((sum, item) => sum + item.brotli, 0),
  };
}

export function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KiB`;
}
