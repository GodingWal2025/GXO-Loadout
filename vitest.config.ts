import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.claude/**'],
  },
});
