import { execFile } from 'node:child_process';
import { join } from 'node:path';
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
