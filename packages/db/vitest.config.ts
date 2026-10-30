import { defineProject } from 'vitest/config';
import { testEnv } from '../../vitest.shared.ts';

export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: testEnv(),
    globalSetup: ['./src/testing/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
