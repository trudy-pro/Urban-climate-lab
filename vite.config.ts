import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://trudy-pro.github.io/Urban-climate-lab/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Urban-climate-lab/' : '/',
  plugins: [react()],
  server: { port: 5173, open: false },
  build: { chunkSizeWarningLimit: 2000 },
}));
