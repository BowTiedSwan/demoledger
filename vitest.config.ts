import { defineConfig } from 'vitest/config';
import { testEnv } from './vitest.shared.ts';

// Each workspace package owns its vitest.config.ts (defineProject + testEnv()).
export default defineConfig({
  test: {
    env: testEnv(),
    passWithNoTests: true,
    projects: ['packages/*', 'apps/*', 'evals'],
  },
});
