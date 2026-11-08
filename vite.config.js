import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    open: true,
    watch: {
      ignored: ['**/release/**', '**/*.mp4', '**/*.zip']
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    open: true
  },
  build: {
    target: 'es2022'
  }
});
