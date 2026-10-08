import { defineConfig } from 'vite';

export default defineConfig({
  // Supports both a domain root and GitHub Pages' /repository/ path.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
});
