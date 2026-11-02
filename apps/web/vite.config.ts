import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/web',
  base: './',
  server: {
    host: '127.0.0.1',
    port: 4311,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:4310' },
      '/health': { target: 'http://127.0.0.1:4310' },
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
