import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // The website is served from https://anvaka.github.io/mars/, so all urls
  // have to be relative.
  base: './',
  plugins: [vue()],
  server: {
    // The MapBox token is restricted to this origin. Tiles will not load from
    // any other port, so fail instead of silently picking the next free one.
    port: 8080,
    strictPort: true
  },
  build: {
    sourcemap: true
  }
});
