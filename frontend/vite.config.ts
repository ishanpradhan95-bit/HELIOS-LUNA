import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the static bundle works from any sub-path (GitHub Pages, file server, etc.).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
