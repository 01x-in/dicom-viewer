// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fakeSource } from './testing/fakes';
import { createViewer } from './viewer';

describe('createViewer', () => {
  it('registers the commands of the host, so a config can name them', () => {
    const viewer = createViewer({
      dataSource: fakeSource(),
      commands: { 'acme.export': () => undefined },
      config: {
        version: 1,
        toolbar: {
          items: [{ type: 'command', id: 'export', label: 'Export', command: 'acme.export' }],
        },
      },
    });
    try {
      expect(viewer.commands.has('acme.export')).toBe(true);
    } finally {
      viewer.destroy();
    }
  });
});
