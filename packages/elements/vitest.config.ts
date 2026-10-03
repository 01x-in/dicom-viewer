import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'elements',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
