import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Bound concurrent Git/Node fixture processes on Windows.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['dist/**', 'prisma/**', 'src/__tests__/**'],
    },
  },
});
