import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Tarballs {
  readonly core: string;
  readonly elements: string;
  readonly react: string;
  readonly vue: string;
}

const PACKAGES = {
  core: '@scope/viewer-core',
  elements: '@scope/viewer-elements',
  react: '@scope/viewer-react',
  vue: '@scope/viewer-vue',
} as const;

/** Runs `pnpm pack` on every package, exactly as `npm publish` would see it. Returns absolute paths. */
export async function packTarballs(root: string): Promise<Tarballs> {
  const destination = join(root, '.tarballs');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const name of Object.values(PACKAGES)) {
    await run('pnpm', ['--filter', name, 'pack', '--pack-destination', destination], { cwd: root });
  }
  const files = await readdir(destination);
  const find = async (directory: keyof Tarballs): Promise<string> => {
    // Changesets bumps the fixed versions, so the tarball name carries the manifest's version.
    const manifest = JSON.parse(
      await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    const version = manifest.version;
    if (typeof version !== 'string') throw new Error(`packages/${directory} has no version`);
    const file = files.find((candidate) =>
      candidate.endsWith(`viewer-${directory}-${version}.tgz`),
    );
    if (file === undefined) throw new Error(`No tarball for ${directory} in ${destination}`);
    return join(destination, file);
  };
  return {
    core: await find('core'),
    elements: await find('elements'),
    react: await find('react'),
    vue: await find('vue'),
  };
}
