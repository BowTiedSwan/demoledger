import { defineProject } from 'vitest/config';
import { testEnv } from '../../vitest.shared.ts';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: testEnv(),
    globalSetup: ['../../packages/db/src/testing/global-setup.ts'],
    // Test files share one seeded database; they only read it (plus per-test sessions).
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
