import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyAssets, parseCliArguments } from './copy-assets';

const cleanup: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'viewer-assets-'));
  cleanup.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('copyAssets', () => {
  it('copies the worker and the WASM folder to the destination', async () => {
    const source = await scratch();
    await mkdir(join(source, 'wasm'));
    await writeFile(join(source, 'decode.worker.js'), 'worker');
    await writeFile(join(source, 'wasm', 'codec.wasm'), 'wasm');
    const destination = join(await scratch(), 'public', 'viewer-assets');

    const copied = await copyAssets(source, destination);

    expect(copied.sort()).toEqual(['decode.worker.js', 'wasm/codec.wasm']);
    expect(await readFile(join(destination, 'decode.worker.js'), 'utf8')).toBe('worker');
    expect(await readdir(join(destination, 'wasm'))).toEqual(['codec.wasm']);
  });

  it('fails clearly when the package ships no assets', async () => {
    const empty = await scratch();
    await expect(copyAssets(join(empty, 'missing'), join(empty, 'out'))).rejects.toThrow(
      /no assets/i,
    );
  });
});

describe('parseCliArguments', () => {
  it('accepts `copy <dir>`', () => {
    expect(parseCliArguments(['copy', 'public/viewer-assets'])).toEqual({
      command: 'copy',
      destination: 'public/viewer-assets',
    });
  });

  it('rejects anything else with a usage message', () => {
    expect(() => parseCliArguments([])).toThrow(/usage/i);
    expect(() => parseCliArguments(['copy'])).toThrow(/usage/i);
    expect(() => parseCliArguments(['sync', 'x'])).toThrow(/usage/i);
  });
});
