import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.ts on purpose: that file's `root:
 * 'src/renderer'` is for building the renderer bundle and would make
 * Vitest look for tests under src/renderer instead of ./test if Vitest
 * fell back to it. Vitest prefers a vitest.config.* over vite.config.* when
 * both exist, so this keeps the two build/test concerns from colliding.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
