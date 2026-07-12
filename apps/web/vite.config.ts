import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      {
        find: '@cuks/shared',
        replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
      // Specific subpath first so it isn't caught by the '@cuks/ui' prefix rule.
      {
        find: '@cuks/ui/styles.css',
        replacement: fileURLToPath(
          new URL('../../packages/ui/src/styles/index.css', import.meta.url),
        ),
      },
      {
        find: /^@cuks\/ui$/,
        replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // Socket.IO handshake + upgrade (namespace `/ws` still uses this path).
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
});
