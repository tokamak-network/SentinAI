import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: [
        'src/lib/**/*.ts',
        'src/app/api/**/*.ts',
        'src/core/**/*.ts',
        'src/chains/**/*.ts',
        'src/middleware.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/lib/__tests__/**',
        'src/app/api/**/__tests__/**',
      ],
      reportOnFailure: true,
      thresholds: {
        lines: 5,
        functions: 35,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
