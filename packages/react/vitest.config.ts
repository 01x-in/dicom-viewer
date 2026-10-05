import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'react',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
