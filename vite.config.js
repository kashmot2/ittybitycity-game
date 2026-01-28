import { defineConfig } from 'vite';

export default defineConfig({
  base: './',  // Use relative paths for GitHub Pages subdirectory deployment
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
