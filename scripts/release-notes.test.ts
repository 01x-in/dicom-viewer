import { describe, expect, it } from 'vitest';
import { releaseNotes } from './release-notes.ts';

const dependencies = (version: string): string =>
  `- Updated dependencies [abc1234]\n  - @01x/dicom-viewer-core@${version}\n`;

const log = (name: string, version: string, body: string): string =>
  `# @01x/dicom-viewer-${name}\n\n## ${version}\n\n${body}\n## 1.0.0\n\n### Major Changes\n\n- d21c400: First stable release.\n`;

describe('releaseNotes', () => {
  it('lists a change made to every package once, with no label', () => {
    const body = '### Patch Changes\n\n- e8d8406: Moved to the 01x organization.\n';
    const notes = releaseNotes(
      {
        core: log('core', '1.0.1', body),
        elements: log('elements', '1.0.1', body),
        react: log('react', '1.0.1', body),
        vue: log('vue', '1.0.1', body),
      },
      '1.0.1',
    );
    expect(notes.match(/Moved to the 01x organization/g)).toHaveLength(1);
    expect(notes).not.toMatch(/only\)/);
    expect(notes).toMatch(/### Patch Changes/);
    expect(notes).toMatch(/\[@01x\/dicom-viewer-vue@1\.0\.1\]/);
  });

  it('shows a change made only to an adapter, with its package, and not the dependency lines', () => {
    const coreBody = '';
    const reactBody = `### Patch Changes\n\n- 1111111: React hook cleans up on unmount.\n${dependencies('1.0.2')}`;
    const notes = releaseNotes(
      {
        core: log('core', '1.0.2', coreBody),
        elements: log('elements', '1.0.2', `### Patch Changes\n\n${dependencies('1.0.2')}`),
        react: log('react', '1.0.2', reactBody),
        vue: log('vue', '1.0.2', `### Patch Changes\n\n${dependencies('1.0.2')}`),
      },
      '1.0.2',
    );
    expect(notes).toMatch(/1111111: React hook cleans up on unmount\. \(`react` only\)/);
    expect(notes).not.toMatch(/Updated dependencies/);
  });

  it('orders major, minor, and patch changes, and keeps the lines under an entry', () => {
    const core = log(
      'core',
      '2.0.0',
      '### Patch Changes\n\n- aaaaaaa: A fix.\n\n### Major Changes\n\n- bbbbbbb: A break.\n\n  More about it.\n',
    );
    const notes = releaseNotes({ core }, '2.0.0');
    // Both headings must be there, in this order: a missing major heading fails the match.
    expect(notes).toMatch(/### Major Changes[\s\S]*### Patch Changes/);
    expect(notes).toMatch(/bbbbbbb: A break\. \(`core` only\)\n\n {2}More about it\./);
  });

  it('says so when a version has no entry, and ignores other versions', () => {
    const notes = releaseNotes({ core: log('core', '1.0.3', '') }, '1.0.3');
    expect(notes).toMatch(/No change is listed/);
    expect(notes).not.toMatch(/First stable release/);
  });
});
