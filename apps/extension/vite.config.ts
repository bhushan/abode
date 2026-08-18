import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss(), Icons({ compiler: 'jsx', jsx: 'react' }), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    // Chrome will not reuse a modulepreload emitted into an extension page: it
    // reports a "cross-world extension resource mismatch" and fetches the chunk
    // a second time. There is nothing to hide behind a preload here anyway, the
    // assets are on disk, so do not emit them.
    modulePreload: false,
    rollupOptions: {
      input: {
      },
    },
  },
});
