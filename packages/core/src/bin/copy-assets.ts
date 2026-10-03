import { cp, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface CopyCommand {
  readonly command: 'copy';
  readonly destination: string;
}

const USAGE = 'Usage: viewer-assets copy <destination-dir>';

export function parseCliArguments(args: readonly string[]): CopyCommand {
  const [command, destination, ...rest] = args;
  if (command !== 'copy' || destination === undefined || rest.length > 0) {
    throw new Error(USAGE);
  }
  return { command, destination };
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    ),
  );
  return nested.flat();
}

/** Copies the decode worker and codec WASM to `destination` and returns the relative paths copied. */
export async function copyAssets(source: string, destination: string): Promise<string[]> {
  const present = await stat(source).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!present) {
    throw new Error(`This package contains no assets to copy (looked in ${source}).`);
  }
  await cp(source, destination, { recursive: true });
  return listFiles(source);
}
