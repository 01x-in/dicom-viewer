import { type ChildProcess } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Tarballs } from './pack.ts';

export function tarballOverrides(tarballs: Tarballs): Record<string, string> {
  return {
    '@scope/viewer-core': `file:${tarballs.core}`,
    '@scope/viewer-elements': `file:${tarballs.elements}`,
    '@scope/viewer-react': `file:${tarballs.react}`,
    '@scope/viewer-vue': `file:${tarballs.vue}`,
  };
}

/** Copies an example to `.matrix/<name>` and points its dependencies at the packed tarballs. */
export async function prepareExample(
  root: string,
  name: string,
  example: string,
  tarballs: Tarballs,
): Promise<string> {
  const target = join(root, '.matrix', name);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, 'examples', example), target, {
    recursive: true,
    filter: (source) => !/\/(node_modules|dist|\.next|\.nuxt|\.output)(\/|$)/.test(source),
  });
  const overrides = tarballOverrides(tarballs);
  const manifestPath = join(target, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const tarball = overrides[name];
    if (tarball !== undefined && manifest.dependencies !== undefined) {
      manifest.dependencies[name] = tarball;
    }
  }
  manifest.pnpm = { ...manifest.pnpm, overrides: { ...manifest.pnpm?.overrides, ...overrides } };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

export async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited with ${String(server.exitCode)}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`server did not answer at ${url}`);
}
