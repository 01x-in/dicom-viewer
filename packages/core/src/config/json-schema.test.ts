import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { viewerConfigJsonSchema } from './schema';

const FILE = new URL('../../schema/viewer-config.schema.json', import.meta.url);

/** What is written to the shipped file: the schema, with a title and where it lives. */
function schemaText(): string {
  const schema = {
    ...viewerConfigJsonSchema(),
    title: 'ViewerConfigV1',
    description:
      'Settings for @tushar-im/dicom-viewer-core and @tushar-im/dicom-viewer-elements (docs/adr/0011-config-layer.md).',
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}

describe('the JSON Schema of the config', () => {
  it('is the file that ships: run UPDATE_SCHEMA=1 pnpm test to write it again', () => {
    if (process.env['UPDATE_SCHEMA'] === '1') writeFileSync(FILE, schemaText());
    expect(readFileSync(FILE, 'utf8')).toBe(schemaText());
  });

  it('is an object that wants a version and allows no key the config does not have', () => {
    const schema = viewerConfigJsonSchema() as {
      type?: string;
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['version']);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
      [
        '$schema',
        'keybindings',
        'overlay',
        'palette',
        'panels',
        'theme',
        'toolbar',
        'tools',
        'version',
        'windowLevelPresets',
      ].sort(),
    );
  });

  it('lists the palettes, the themes, the tools, and the kinds of toolbar item', () => {
    const text = JSON.stringify(viewerConfigJsonSchema());
    for (const word of [
      'graphite',
      'navy',
      'light',
      'stack-scroll',
      'bidirectional',
      'separator',
      'command',
      'menu',
      'builtin',
      'tag',
      'remove',
    ]) {
      expect(text, word).toContain(`"${word}"`);
    }
  });

  it('can be written as JSON', () => {
    expect(() => JSON.stringify(viewerConfigJsonSchema())).not.toThrow();
  });
});
