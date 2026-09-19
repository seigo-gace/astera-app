import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '/tmp/vitest-cache',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
