import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: uiRoot,
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  // Only Maps configuration belongs in public browser assets. Agent keys stay server-side.
  envPrefix: ['VITE_GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_MAPS_MAP_ID'],
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT ?? '8787'}`,
        changeOrigin: false,
      },
    },
  },
});
