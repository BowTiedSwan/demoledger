import path from 'node:path';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { name: 'web', environment: 'node', include: ['src/**/*.test.{ts,tsx}', 'csp.test.ts'] },
});
