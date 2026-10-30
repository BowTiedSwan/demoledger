import { defineProject } from 'vitest/config';
import { testEnv } from '../vitest.shared.ts';

export default defineProject({
  test: {
    name: 'evals',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: testEnv(),
  },
});
