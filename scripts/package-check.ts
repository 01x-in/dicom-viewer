import { execFile } from 'node:child_process';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { packTarballs } from './matrix/pack.ts';

const run = promisify(execFile);
const root = join(import.meta.dirname, '..');

/** Entry points that are assets, not code: there are no types or JavaScript for the checker to resolve. */
const ASSETS: Record<string, readonly string[]> = {
  elements: ['./styles.css'],
};

interface Outcome {
  readonly name: string;
  readonly ok: boolean;
  readonly output: string;
}

async function exec(name: string, command: string, args: readonly string[]): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(command, [...args], { cwd: root });
    return { name, ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return {
      name,
      ok: false,
      output: `${failure.stdout ?? ''}${failure.stderr ?? failure.message}`,
    };
  }
}

/**
 * `npm publish` of a folder rewrites a `bin` path that starts with `./` and drops one it does not accept,
 * so the published package silently has no command. The tarball from `pnpm pack` keeps the `./`, so
 * publint does not see it. A `bin` path must already be the form npm keeps, and its file must be in the package.
 */
async function binCheck(directory: string, tarball: string): Promise<Outcome> {
  const name = `bin ${directory}`;
  try {
    const { stdout: manifestText } = await run('tar', ['-xOzf', tarball, 'package/package.json']);
    const { stdout: listing } = await run('tar', ['-tzf', tarball]);
    const files = new Set(listing.split('\n').filter((line) => line !== ''));
    const manifest = JSON.parse(manifestText) as { bin?: string | Record<string, string> };
    const bins =
      typeof manifest.bin === 'string' ? { [directory]: manifest.bin } : (manifest.bin ?? {});
    const problems = Object.entries(bins).flatMap(([command, path]) => {
      if (path !== posix.normalize(path) || path.startsWith('/') || path.startsWith('../')) {
        return [
          `bin "${command}" is "${path}": write "${posix.normalize(path)}" (no leading "./"), or npm drops it when publishing`,
        ];
      }
      return files.has(`package/${path}`)
        ? []
        : [`bin "${command}" points at "${path}", which is not in the package`];
    });
    return { name, ok: problems.length === 0, output: problems.join('\n') };
  } catch (error) {
    return { name, ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * M8: what a consumer's tooling sees. publint checks the manifest and the files against the exports map,
 * and "are the types wrong" checks that every entry point resolves, with types, the way Node (ESM) and a
 * bundler resolve it. The packages are ESM only, so the CommonJS resolutions are not part of the contract.
 */
async function main(): Promise<void> {
  const tarballs = await packTarballs(root);
  const outcomes: Outcome[] = [];
  for (const [directory, tarball] of Object.entries(tarballs)) {
    outcomes.push(
      await exec(`publint ${directory}`, 'pnpm', ['exec', 'publint', 'run', '--strict', tarball]),
    );
    outcomes.push(await binCheck(directory, tarball));
    const excluded = ASSETS[directory] ?? [];
    outcomes.push(
      await exec(`attw ${directory}`, 'pnpm', [
        'exec',
        'attw',
        tarball,
        '--profile',
        'esm-only',
        '--format',
        'ascii',
        ...(excluded.length > 0 ? ['--exclude-entrypoints', ...excluded] : []),
      ]),
    );
  }
  let failed = false;
  for (const outcome of outcomes) {
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.name}`);
    if (!outcome.ok) {
      failed = true;
      console.log(outcome.output);
    }
  }
  if (failed) process.exitCode = 1;
}

await main();
