#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyAssets, parseCliArguments } from './copy-assets';

// dist/bin/viewer-assets.js -> <package>/assets
const assetsDir = fileURLToPath(new URL('../../assets', import.meta.url));

try {
  const { destination } = parseCliArguments(process.argv.slice(2));
  const target = resolve(destination);
  const copied = await copyAssets(assetsDir, target);
  console.log(`Copied ${copied.length.toString()} files to ${target}`);
  console.log('Use: createViewer({ assets: { mode: "url", baseUrl: "<where you serve them>" } })');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
