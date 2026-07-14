import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    root: '.',
    alias: {
      // Deep imports first: the barrel alias would otherwise swallow
      // `@cuks/shared/office/xlsx` (the Node-only office writers).
      '@cuks/shared/office/xlsx': new URL(
        '../../packages/shared/src/office/xlsx.ts',
        import.meta.url,
      ).pathname,
      '@cuks/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
      '@cuks/db': new URL('../../packages/db/src/index.ts', import.meta.url).pathname,
    },
  },
  // SWC compiles TS with decorator metadata so Nest DI works under Vitest.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
