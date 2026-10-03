import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'dicomweb-mock',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
