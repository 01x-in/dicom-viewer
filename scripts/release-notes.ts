import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The four packages share one version (the changesets `fixed` group), in this order. */
export const PACKAGES: readonly string[] = ['core', 'elements', 'react', 'vue'];

const LEVELS: readonly string[] = ['Major Changes', 'Minor Changes', 'Patch Changes'];

interface Entry {
  readonly level: string;
  readonly text: string;
  readonly packages: Set<string>;
}

/** The lines of the `## <version>` section of a changelog, or none when the version has no section. */
function sectionOf(changelog: string, version: string): string[] {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line === `## ${version}`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The entries of a section: a `- ` line and the indented lines under it, under a `### ... Changes` heading.
 * The "Updated dependencies" entries are dropped: they only say that a package moved with the others.
 */
function entriesOf(section: readonly string[]): { level: string; text: string }[] {
  const found: { level: string; text: string }[] = [];
  let level = '';
  let current: string[] | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    const text = current.join('\n').trimEnd();
    if (!text.startsWith('- Updated dependencies')) found.push({ level, text });
    current = undefined;
  };
  for (const line of section) {
    if (line.startsWith('### ')) {
      flush();
      level = line.slice(4).trim();
    } else if (line.startsWith('- ')) {
      flush();
      current = [line];
    } else if (current !== undefined && (line.startsWith('  ') || line === '')) {
      current.push(line);
    }
  }
  flush();
  return found;
}

/**
 * The text of a GitHub Release for `version`, from the changelog of every package of the group. A change that was
 * made to one package (an adapter, for example) appears once with the packages it is in; a change in all of them
 * has no label. `changelogs` maps a package name (`core`, `elements`, ...) to the text of its CHANGELOG.md.
 */
export function releaseNotes(
  changelogs: Readonly<Record<string, string>>,
  version: string,
): string {
  const entries = new Map<string, Entry>();
  for (const name of PACKAGES) {
    const changelog = changelogs[name];
    if (changelog === undefined) continue;
    for (const { level, text } of entriesOf(sectionOf(changelog, version))) {
      const key = `${level}\n${text}`;
      const known = entries.get(key);
      if (known === undefined) entries.set(key, { level, text, packages: new Set([name]) });
      else known.packages.add(name);
    }
  }
  const parts: string[] = [];
  for (const level of LEVELS) {
    const ofLevel = [...entries.values()].filter((entry) => entry.level === level);
    if (ofLevel.length === 0) continue;
    parts.push(`### ${level}\n`);
    for (const entry of ofLevel) {
      const label =
        entry.packages.size === PACKAGES.length
          ? ''
          : ` (${[...entry.packages].map((name) => `\`${name}\``).join(', ')} only)`;
      const [first = '', ...more] = entry.text.split('\n');
      parts.push([`${first}${label}`, ...more].join('\n'));
    }
    parts.push('');
  }
  if (parts.length === 0)
    parts.push('The packages move to this version together. No change is listed for it.\n');
  parts.push('Packages on npm:');
  for (const name of PACKAGES) {
    parts.push(
      `- [@01x/dicom-viewer-${name}@${version}](https://www.npmjs.com/package/@01x/dicom-viewer-${name}/v/${version})`,
    );
  }
  return `${parts.join('\n')}\n`;
}

/** `node scripts/release-notes.ts <version>` prints the notes for the packages in this repository. */
async function main(): Promise<void> {
  const version = process.argv[2];
  if (version === undefined) throw new Error('Usage: node scripts/release-notes.ts <version>');
  const root = join(import.meta.dirname, '..');
  const changelogs: Record<string, string> = {};
  for (const name of PACKAGES) {
    changelogs[name] = await readFile(join(root, 'packages', name, 'CHANGELOG.md'), 'utf8');
  }
  process.stdout.write(releaseNotes(changelogs, version));
}

if (import.meta.main) await main();
