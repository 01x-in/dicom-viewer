import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
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
  const find = (suffix: string): string => {
    const file = files.find((candidate) => candidate.endsWith(`${suffix}-0.0.0.tgz`));
    if (file === undefined) throw new Error(`No tarball for ${suffix} in ${destination}`);
    return join(destination, file);
  };
  return {
    core: find('viewer-core'),
    elements: find('viewer-elements'),
    react: find('viewer-react'),
    vue: find('viewer-vue'),
  };
}
