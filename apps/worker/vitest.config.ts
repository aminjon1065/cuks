import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    root: '.',
    alias: {
      '@cuks/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
      '@cuks/db': new URL('../../packages/db/src/index.ts', import.meta.url).pathname,
    },
  },
  // SWC compiles TS with decorator metadata so Nest DI works under Vitest.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
