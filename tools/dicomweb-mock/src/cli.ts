#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type MockMode, startMockServer } from './server.ts';

const { values } = parseArgs({
  options: {
    fixtures: {
      type: 'string',
      default: fileURLToPath(new URL('../../../fixtures/phantom', import.meta.url)),
    },
    mode: { type: 'string', default: 'oncotrace-proxy' },
    port: { type: 'string', default: '8042' },
  },
});

function parseMode(raw: string): MockMode {
  if (raw === 'open' || raw === 'oncotrace-proxy') return raw;
  throw new Error(`--mode must be "open" or "oncotrace-proxy", got "${raw}"`);
}

const server = await startMockServer({
  fixturesDir: values.fixtures,
  mode: parseMode(values.mode),
  port: Number(values.port),
});

const [study] = server.fixtures.studyUids;
console.log(`dicomweb-mock (${server.mode}) listening on ${server.url}`);
console.log(`study: ${study ?? '(none)'}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
