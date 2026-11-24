import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site from https://trudy-pro.github.io/Urban-climate-lab/,
// while Vercel (which sets VERCEL=1 during its builds) serves it from the domain root.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '');
  const pagesBase = env.VERCEL ? '/' : '/Urban-climate-lab/';
  return {
    base: command === 'build' ? pagesBase : '/',
    plugins: [react()],
    server: { port: 5173, open: false },
    build: { chunkSizeWarningLimit: 2000 },
  };
});
