// Puts the TypeDoc output (`pnpm docs:api`) under site/dist/api, with the fonts its theme asks for
// (site/api-theme/custom.css). Run it after `vite build`.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SITE = resolve(import.meta.dirname, '..');
const SOURCE = resolve(SITE, '../.docs/api');
const TARGET = join(SITE, 'dist/api');

const FONTS: readonly string[] = [
  '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2',
  '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2',
  '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
];

if (!existsSync(SOURCE)) throw new Error('There is no .docs/api. Run `pnpm docs:api` first.');
if (!existsSync(join(SITE, 'dist')))
  throw new Error('There is no site/dist. Build the site first.');

rmSync(TARGET, { recursive: true, force: true });
cpSync(SOURCE, TARGET, { recursive: true });

const fontDir = join(TARGET, 'assets/fonts');
mkdirSync(fontDir, { recursive: true });
for (const font of FONTS) {
  const source = join(SITE, 'node_modules', font);
  if (!existsSync(source)) throw new Error(`The font ${font} is not installed`);
  cpSync(source, join(fontDir, font.slice(font.lastIndexOf('/') + 1)));
}
console.log('Put the API reference and its fonts under site/dist/api');
